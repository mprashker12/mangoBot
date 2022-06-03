//solana
import { 
    Connection, 
    Keypair, 
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

        //used to estimate spot price
        this.initPyth();

        //Order book stream of the perpMarket
        this.initOrderBookStream();
        this.orderBookFillSeqNum = new BN(0);

        this.mangoAccount.perpAccounts
    }

    
    initPyth() {
        this.pythConnection = new PythConnection(
            this.connection,
            getPythProgramKeyForCluster('mainnet-beta')
        );
        this.pythConnection.onPriceChange((product, price) => {
            if(product.symbol === this.pythSymbol) {
                console.log("Pyth Price update:", price.aggregate.price)
            }
        });
        this.pythConnection.start();
    }

    initOrderBookStream() {
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
    
    buildBuyInstruction(price : number, size : number) {
        const [nativeAskPrice, nativeAskQuantity] = 
            this.perpMarket.uiToNativePriceQuantity(price, size);
        return makePlacePerpOrder2Instruction(
            this.mangoGroupConfig.mangoProgramId,
            this.mangoGroup.publicKey,
            this.mangoAccount.publicKey,
            this.solAccount.publicKey,
            this.mangoGroup.publicKey,
            this.perpMarket.publicKey,
            this.perpMarket.bids,
            this.perpMarket.asks,
            this.perpMarket.eventQueue,
            this.mangoAccount.getOpenOrdersKeysInBasketPacked(),
            nativeAskPrice,
            nativeAskQuantity,
            I64_MAX_BN,
            new BN(0),
            'sell',
            new BN(20),
            'postOnly',
            false,
        );
    }

    gogo() {
        
    }
}