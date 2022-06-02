import { Connection, Keypair } from '@solana/web3.js';

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
} from '@blockworks-foundation/mango-client'

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

    constructor(
        symbol : string,
        connection : Connection,
        mangoClient : MangoClient,
        perpMarketConfig : PerpMarketConfig,
        solAccount : Keypair,
        mangoGroup : MangoGroup,
        mangoGroupConfig : GroupConfig,
        mangoAccount : MangoAccount,
    ) {
        this.symbol = symbol;
        this.connection = connection;
        this.mangoClient = mangoClient;
        this.perpMarketConfig = perpMarketConfig;
        this.solAccount = solAccount;
        this.mangoGroup = mangoGroup;
        this.mangoGroupConfig = mangoGroupConfig;
        this.mangoAccount = mangoAccount;
        this.loadMarket();
    }

    async loadMarket() {
        const perpMarket = await this.mangoGroup.loadPerpMarket(
            this.connection, 
            this.perpMarketConfig.marketIndex,
            this.perpMarketConfig.baseDecimals,
            this.perpMarketConfig.quoteDecimals
        );
        this.perpMarket = perpMarket;
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