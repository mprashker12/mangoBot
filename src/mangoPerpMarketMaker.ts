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
import { text } from 'stream/consumers';

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
    currOrderId : number;
    orderBookFillSeqNum : BN;
    mangoMarketIndex : number;
    perpAccount : PerpAccount;
    lastestPythPrice : number | undefined;
    bundleIdSeqNum : number;

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
        this.bundleIdSeqNum = 1;


        this.mangoMarketIndex = getMarketIndexBySymbol( 
            mangoGroupConfig,
            symbol
        );
        this.perpAccount = this.mangoAccount
                            .perpAccounts[this.mangoMarketIndex];

        //used to estimate spot price
        this.listenPyth();

        //Order book stream of the perpMarket
        this.listenOrderBook();
        this.orderBookFillSeqNum = new BN(0);

        this.mangoAccount.perpAccounts
    }

    
    listenPyth() {
        this.pythConnection = new PythConnection(
            this.connection,
            getPythProgramKeyForCluster('mainnet-beta')
        );
        this.pythConnection.onPriceChange((product, price) => {
            if(product.symbol === this.pythSymbol) {
                this.lastestPythPrice = price.aggregate.price;
            }
        });
        this.pythConnection.start();
    }

    listenOrderBook() {
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
                console.log("fill for ", fill.price, fill.quantity, fill.seqNum.toNumber());
                this.orderBookFillSeqNum = BN.max(this.orderBookFillSeqNum, fill.seqNum);
            }
        })
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

    //elems of buyOrders, sellOrders === (price, size)
    async executeOrders(buyOrders : number[][], sellOrders : number[][]) {
        const orderTx= new Transaction();
        for(const buyOrder of buyOrders) {
            console.log("Adding buy:", buyOrder , "to order bundle");
            orderTx.add(this.buildOrderInstruction(buyOrder[0], buyOrder[1], 'buy'));
        }
        for(const sellOrder of sellOrders) {
            console.log("Adding sell:", sellOrder , "to order bundle");
            orderTx.add(this.buildOrderInstruction(sellOrder[0], sellOrder[1], 'sell'));
        }
        console.log("Sending order bundle", this.bundleIdSeqNum, "...");
        await this.mangoClient.sendTransaction(
            orderTx,
            this.solAccount,
            [] //other signers of the tx
        ).then((res) => {
            console.log("Order bundle",this.bundleIdSeqNum, "was successfully sent!");
            this.bundleIdSeqNum += 1;
        }).catch((err) => {
            console.log("Failed to send order bundle", this.bundleIdSeqNum, err);
        });
    }
    
    buildOrderInstruction(
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
            new BN(this.bundleIdSeqNum),
            'postOnly',
            false,
        );
    }


    async gogo() {
        const buyOrders = [];
        const sellOrders = [[21.50, .1], [21.50, .1]];
        await this.executeOrders(buyOrders, sellOrders);
    }
}