//solana
import { 
    Connection, 
    Keypair,
    Transaction, 
} from '@solana/web3.js';

//mango
import {
    MangoClient,
    MangoGroup,
    MangoAccount,
    GroupConfig,
    PerpMarketConfig,
    PerpMarket,
    PerpEventQueue,
    PerpEventQueueLayout,
    PerpAccount,
    makePlacePerpOrder2Instruction,
    getMarketIndexBySymbol,
    I64_MAX_BN,
    BN,
    MangoCache,
    makeCancelAllPerpOrdersInstruction,
} from '@blockworks-foundation/mango-client'

import {
    ParsedFillEvent,
} from '@blockworks-foundation/mango-client/lib/src/PerpMarket'

import {
    OpenOrders
} from '@project-serum/serum'

//pyth
import { 
    PythHttpClient,
    PythConnection,
    getPythProgramKeyForCluster
 } from '@pythnetwork/client';

import {
    delay,
    mean,
    std,
} from './utils';
import { NumericLiteral } from 'typescript';

 //improved design to batch together many buy and sell instructions into a single
 //solana transaction. 
export class mangoPerpMarketMaker {
    symbol : string;
    pythSymbol : string;
    connection : Connection;
    mangoClient : MangoClient;
    perpMarketConfig : PerpMarketConfig;
    perpMarket : PerpMarket;
    solAccount : Keypair;
    mangoGroup : MangoGroup;
    mangoGroupConfig : GroupConfig;
    mangoAccount : MangoAccount;
    mangoCache : MangoCache;
    pythOracle : PythHttpClient;
    pythConnection : PythConnection;
    mangoMarketIndex : number;
    perpAccount : PerpAccount;
    lastestPythPrice : number | undefined;
    bundleIdSeqNum : BN; //index of bundles we send 0,1,...
    orderBookFillSeqNum : BN //keep track of new fills to listen to...
    secondBetweenBundleSends : number; //how long should we wait between bundle sends
    fillsDuringCurrentRound : ParsedFillEvent[];
    pricesDuringCurrentRound : number[];
    fillHistory : ParsedFillEvent[][];
    ourFilledOrders : ParsedFillEvent[];
    priceHistory : number[][]; //map a round to list of prices seen during round
    priceAverages : number[];
    

    //state vars to market make well
    overallLongPosition : number;
    overallShortPosition : number;
    spread : number;
    stagger_size: number;
    buy_order_size: number;
    sell_order_size: number;
    order_size_increment: number;

    constructor(
        symbol : string,
        connection : Connection,
        mangoClient : MangoClient,
        perpMarket : PerpMarket,
        perpMarketConfig : PerpMarketConfig,
        solAccount : Keypair,
        mangoGroup : MangoGroup,
        mangoGroupConfig : GroupConfig,
        mangoAccount : MangoAccount,
        mangoCache : MangoCache,
    ) {
        this.symbol = symbol;
        this.pythSymbol = "Crypto." + this.symbol + "/USD";
        this.connection = connection;
        this.mangoClient = mangoClient;
        this.perpMarket = perpMarket;
        this.perpMarketConfig = perpMarketConfig;
        this.solAccount = solAccount;
        this.mangoGroup = mangoGroup;
        this.mangoGroupConfig = mangoGroupConfig;
        this.mangoAccount = mangoAccount;
        this.mangoCache = mangoCache;

        this.mangoMarketIndex = getMarketIndexBySymbol( 
            mangoGroupConfig,
            symbol
        );
        this.perpAccount = this.mangoAccount
                            .perpAccounts[this.mangoMarketIndex];
        
        this.listenPyth(); //to estimate spot price
        this.listenForFills();

        this.fillsDuringCurrentRound = [];
        this.fillHistory = [];
        this.pricesDuringCurrentRound = [];
        this.priceHistory = [];
        this.ourFilledOrders = [];
        this.priceAverages = [];
        this.bundleIdSeqNum = new BN(0); 
        this.orderBookFillSeqNum = new BN(0);
        this.secondBetweenBundleSends = 20;
        
        this.overallShortPosition = 0;
        this.overallLongPosition = 0;
        this.stagger_size = 5;
        this.buy_order_size = .2;
        this.sell_order_size = .2;
        this.order_size_increment = .01;
        this.spread = .05;
    }

    listenPyth() {
        this.pythConnection = new PythConnection(
            this.connection,
            getPythProgramKeyForCluster('mainnet-beta')
        );
        this.pythConnection.onPriceChange((product, price) => {
            if(product.symbol === this.pythSymbol) {
                this.lastestPythPrice = price.aggregate.price;
                this.pricesDuringCurrentRound.push(price.aggregate.price);
            }
        });
        this.pythConnection.start();
    }

    listenForFills() {
        this.connection.onAccountChange(this.perpMarketConfig.eventsKey, (accountInfo) => {
            const queue = new PerpEventQueue(
                PerpEventQueueLayout.decode(accountInfo.data),
            );
            const fills = queue
                .eventsSince(this.orderBookFillSeqNum)
                .map((e) => e.fill)
                .filter((e) => !!e)
                .map((e) => this.perpMarket.parseFillEvent(e) as ParsedFillEvent);
            
            for(const fill of fills) {
                if(fill.maker.toString() === this.mangoAccount.publicKey.toString()) {
                    console.log(
                        "OUR ORDER WAS FILLED", 
                        fill.price,
                        fill.quantity
                    )
                    if(fill.takerSide === 'sell') {
                        this.overallLongPosition += fill.price*fill.quantity;
                    }
                    if(fill.takerSide === 'buy') {
                        this.overallShortPosition += fill.price*fill.quantity;
                    }
                    this.ourFilledOrders.push(fill);
                }
                this.fillsDuringCurrentRound.push(fill);
                this.orderBookFillSeqNum = BN.max(this.orderBookFillSeqNum, fill.seqNum);
            }
        })
    }

    //elems of buyOrders, sellOrders === (price, size)
    async executeBundle(buyOrders : number[][], sellOrders : number[][]) {
        const bundleTx= new Transaction();

        const cancelTx = makeCancelAllPerpOrdersInstruction(
            this.mangoGroupConfig.mangoProgramId,
            this.mangoGroup.publicKey,
            this.mangoAccount.publicKey,
            this.solAccount.publicKey,
            this.perpMarket.publicKey,
            this.perpMarketConfig.bidsKey,
            this.perpMarketConfig.asksKey,
            new BN(15), //max number of orders to cancel in the instruction
        );

        bundleTx.add(cancelTx);

        for(const buyOrder of buyOrders) {
            console.log("Adding buy:", buyOrder , "to order bundle", this.bundleIdSeqNum.toString());
            bundleTx.add(this.buildOrderIx(buyOrder[0], buyOrder[1], 'buy'));
        }
        for(const sellOrder of sellOrders) {
            console.log("Adding sell:", sellOrder , "to order bundle", this.bundleIdSeqNum.toString());
            bundleTx.add(this.buildOrderIx(sellOrder[0], sellOrder[1], 'sell'));
        }
        console.log("Sending order bundle", this.bundleIdSeqNum.toString(), "...");
        await this.mangoClient.sendTransaction(
            bundleTx,
            this.solAccount,
            [] //other signers of the tx
        ).then((res) => {
            console.log("Order bundle",this.bundleIdSeqNum.toString(), "was successfully sent!");
        }).catch((err) => {
            console.log("Failed to send order bundle", this.bundleIdSeqNum.toString(), err);
        });
    }
    
    //builds bundle to batch cancel old and send new orders
    buildOrderIx(
        price : number, 
        size : number, 
        side : 'buy' | 'sell')
    {
        const [nativeAskPrice, nativeAskQuantity] = 
            this.perpMarket.uiToNativePriceQuantity(price, size);
        return makePlacePerpOrder2Instruction(
            this.mangoGroupConfig.mangoProgramId,
            this.mangoGroup.publicKey,
            this.mangoAccount.publicKey,
            this.solAccount.publicKey,
            this.mangoGroup.mangoCache,
            this.perpMarket.publicKey,
            this.perpMarket.bids,
            this.perpMarket.asks,
            this.perpMarket.eventQueue,
            this.mangoAccount.getOpenOrdersKeysInBasketPacked(),
            nativeAskPrice,
            nativeAskQuantity,
            I64_MAX_BN, //max base quantity
            new BN(0), //max quote quantity
            side,
            new BN(20),
            'postOnly',
            false,
        );
    }

    async cleanUp() {
        const cleanUpTx= new Transaction();

        const cancelIx = makeCancelAllPerpOrdersInstruction(
            this.mangoGroupConfig.mangoProgramId,
            this.mangoGroup.publicKey,
            this.mangoAccount.publicKey,
            this.solAccount.publicKey,
            this.perpMarket.publicKey,
            this.perpMarketConfig.bidsKey,
            this.perpMarketConfig.asksKey,
            new BN(255), //max number of orders to cancel 
        );
        cleanUpTx.add(cancelIx);
        
        let success = false;
        await this.mangoClient.sendTransaction(
            cleanUpTx,
            this.solAccount,
            []
        ).then((res) => {
            console.log("Successfully sent clean up Transaction");
            success = true;
        }).catch((err) => {
            console.log("Failed to send clean up Transaction");
            success = false;
        })
        return success;
    }

    updateMakerState() {
        //update spread and other maker vars
        for(var i = 0; i < this.fillsDuringCurrentRound.length; i++) {
            const fill : ParsedFillEvent = this.fillsDuringCurrentRound[i];
            if(fill.takerSide == "buy") {
                //we, the maker, sold
                this.overallShortPosition += fill.price*fill.quantity;
            } else {
                //we, the maker, bought
                this.overallLongPosition += fill.price*fill.quantity;
            }
        }

        if(this.overallLongPosition > this.overallShortPosition) {
            this.buy_order_size -= this.order_size_increment;
            if(this.buy_order_size < 0) {this.buy_order_size = 0;}
        }

        if(this.overallShortPosition > this.overallLongPosition) {
            this.sell_order_size -= this.order_size_increment;
            if(this.sell_order_size < 0) {this.sell_order_size = 0;}
        }

        const previousMean = this.priceAverages[this.bundleIdSeqNum.toNumber() - 1];
        const currentMean = mean(this.pricesDuringCurrentRound);
        const meanDiff = currentMean - previousMean;
        const currentStd = mean(this.pricesDuringCurrentRound);
        if(currentStd > 0 && meanDiff/currentStd < this.spread) {
            this.spread -= meanDiff/2*currentStd;
        }

        //start new round

        console.log("Starting Round", this.bundleIdSeqNum.toString());
        if(this.pricesDuringCurrentRound.length > 0) {
            console.log("Average price during previous round:", mean(this.pricesDuringCurrentRound));
            console.log("Standard Deviation of prices during previous round:", std(this.pricesDuringCurrentRound));
        } else {
            console.log("Did not see any prices previous during round");
        }
    }


    async calculateOrdersToMake() : Promise<number[][][]> {

        if(this.bundleIdSeqNum.toNumber() === 0 
            || this.priceHistory[this.bundleIdSeqNum.toNumber() - 1].length == 0) {
            //first orders to execute
            const buys = [[this.lastestPythPrice - .05, .2]];
            const sells = [[this.lastestPythPrice + .05, .2]];
            return [buys, sells];
        }

        //TODO: incorporate outstanding bids and ask into decision-making
        // const asks = await this.perpMarket.loadAsks(
        //     this.connection,
        // );
        // const bids = await this.perpMarket.loadBids(
        //     this.connection,
        // );
        
        let buys = []
        let sells = []

        //stagger buys and sells around predicted spot price by calculated spread amount
        for(var i = 0; i < this.stagger_size; i++) {
            buys.push([this.lastestPythPrice - this.spread*i, this.buy_order_size]);
            sells.push([this.lastestPythPrice + this.spread*i, this.sell_order_size]);
        }
        
        return [buys, sells];
    }

    showMangoAccountBalances() {
        console.log(
            this.mangoAccount.toPrettyString(
                this.mangoGroupConfig,
                this.mangoGroup,
                this.mangoCache
            )
        );
    }

    async gogo(numRounds : number) {
        
        //wait until we have at least one Pyth Price
        while(!this.lastestPythPrice) {
            await delay(100);
        }

        for(let i = 0; i < numRounds; i++) {
            //act on current state
            this.updateMakerState();
            const [buyOrders, sellOrders] = await this.calculateOrdersToMake();
            await this.executeBundle(buyOrders, sellOrders);
            
            //prepare for next state
            this.fillHistory.push(this.fillsDuringCurrentRound);
            this.priceHistory.push(this.pricesDuringCurrentRound);
            if(this.pricesDuringCurrentRound.length > 0) {
                this.priceAverages.push(mean(this.pricesDuringCurrentRound));
            }
            this.fillsDuringCurrentRound = [];
            this.pricesDuringCurrentRound = [];
            this.bundleIdSeqNum = this.bundleIdSeqNum.add(new BN(1));
            await delay(this.secondBetweenBundleSends*1000);
        }

        while(!(await this.cleanUp())) {
            await delay(100);
        }

        console.log("Done!")
        console.log("Overall Long Position:", this.overallLongPosition);
        console.log("Overall Short Position", this.overallShortPosition);
        process.exit(0);
    }
}