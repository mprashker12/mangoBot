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
    makePlacePerpOrder2Instruction,
    I64_MAX_BN,
    BN,
    MangoCache,
} from '@blockworks-foundation/mango-client'

//pyth
import { 
    PythHttpClient,
    getPythProgramKeyForCluster
 } from '@pythnetwork/client';

export class mangoPerpMarketMaker {

    symbol : string;
    connection : Connection;
    mangoClient : MangoClient;
    perpMarketConfig : PerpMarketConfig;
    perpMarket : PerpMarket;
    solAccount : Keypair;
    mangoGroup : MangoGroup;
    mangoGroupConfig : GroupConfig;
    mangoAccount : MangoAccount;
    mangoCache : MangoCache;
    pythOracle : PythHttpClient
    currOrderId : number;

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
        this.connection = connection;
        this.mangoClient = mangoClient;
        this.perpMarket = perpMarket;
        this.perpMarketConfig = perpMarketConfig;
        this.solAccount = solAccount;
        this.mangoGroup = mangoGroup;
        this.mangoGroupConfig = mangoGroupConfig;
        this.mangoAccount = mangoAccount;
        this.mangoCache = mangoCache;

        //used to estimate spot price
        this.pythOracle = new PythHttpClient(
            this.connection,
            getPythProgramKeyForCluster('mainnet-beta')
        );
        
        //state related to market making
        this.currOrderId = 0;
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
}