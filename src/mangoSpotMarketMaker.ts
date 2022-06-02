//solana
import { 
    Cluster,
    Commitment, 
    Connection, 
    Keypair, 
    PublicKey,
    Transaction, 
} from '@solana/web3.js';

//mango
import {
    MangoClient,
    MangoGroup,
    MangoAccount,
    MangoCache,
    getMarketIndexBySymbol,
    makePlaceSpotOrder2Instruction,
    makePlacePerpOrder2Instruction,
    makeCancelSpotOrderInstruction,
    GroupConfig,
    SpotMarketConfig,
} from '@blockworks-foundation/mango-client'

//serum
import {
    Market,

} from '@blockworks-foundation/mango-client/node_modules/@project-serum/serum';


//pyth
import {
    getPythProgramKeyForCluster,
    PriceData,
    PythHttpClient
} from '@pythnetwork/client/lib'
import { orderBy } from 'lodash';

export class mangoSpotMarketMaker {

    symbol : string;
    client : MangoClient;
    connection : Connection;
    spotMarket : Market;
    spotMarketTickSize : number;
    solanaOwner : Keypair;
    mangoGroup : MangoGroup;
    mangoAccount : MangoAccount;
    mangoMarketIndex : number;
    mangoGroupConfig : GroupConfig;
    marketConfig : SpotMarketConfig;
    pythOracle : PythHttpClient;

    //mainted state for market making
    netBuys : number;
    netSells : number;

    constructor(
        symbol : string,
        client : MangoClient, 
        connection : Connection, 
        spotMarket : Market,
        solanaOwner : Keypair,
        mangoGroup : MangoGroup,
        mangoAccount : MangoAccount,
        mangoGroupConfig : GroupConfig) 
    {
        this.symbol = symbol;
        this.client = client;
        this.connection = connection;
        this.spotMarket = spotMarket;
        this.spotMarketTickSize = this.spotMarket.tickSize;
        this.solanaOwner = solanaOwner
        this.mangoGroup = mangoGroup;
        this.mangoAccount = mangoAccount;
        this.mangoMarketIndex = this.mangoGroup.getSpotMarketIndex(
            this.spotMarket.publicKey
        );
        this.mangoGroupConfig = mangoGroupConfig;
        this.marketConfig = this.mangoGroupConfig.spotMarkets[this.mangoMarketIndex];
        this.pythOracle = new PythHttpClient(
            this.connection,
            getPythProgramKeyForCluster('mainnet-beta')
        );
        this.netBuys = 0;
        this.netSells = 0;
    }

    async getBids(depth : number) {
        let ret = [];
        let bids = await this.spotMarket.loadBids(this.connection);
        for(let [price, size] of bids.getL2(depth)) {
            ret.push([price, size]);
        }
        return ret;
    }

    async getAsks(depth : number) {
        let ret = [];
        let asks = await this.spotMarket.loadAsks(this.connection);
        for(let [price, size] of asks.getL2(depth)) {
            ret.push([price, size]);
        }
        return ret;
    }

    async buy(amount : number, price : number) {

        console.log("Buying", "amount:", amount, "price:", price,
        "mango Account:", this.mangoAccount.publicKey.toBase58());

        
        await this.client.placeSpotOrder2(
            this.mangoGroup,
            this.mangoAccount,
            this.spotMarket,
            this.solanaOwner,
            "buy",
            price,
            amount,
            "limit"
        ).then((receipt) => {
            console.log("placed order", receipt);
            this.netBuys += amount;
        }).catch((err) => {
            console.log("Failed to place transaction", err);
        });
    }

    async sell(amount : number, price : number) {
        console.log("Selling", "amount:", amount, "price:", price,
        "mango Account:", this.mangoAccount.publicKey.toBase58());

        
        await this.client.placeSpotOrder2(
            this.mangoGroup,
            this.mangoAccount,
            this.spotMarket,
            this.solanaOwner,
            "sell",
            price,
            amount,
            "limit"
        ).then((receipt) => {
            console.log("placed order", receipt);
            this.netSells += amount;
        }).catch((err) => {
            console.log("Failed to place transaction", err);
        });
    }

    //Return the Pyth Oracle data price
    async getPythPrice() : Promise<PriceData> {
        const data = await this.pythOracle.getData();
        const pythSymbol = "Crypto." + this.symbol + "/USD";
        return data.productPrice.get(pythSymbol);
    }

    processUnfilledOrder(side : string, price : number, size : number) {
        if(side === 'sell') {
           //should be more likely to buy in the future
           this.netSells -= size;
        
        }
        if(side === 'buy') {
            //should be more likely to sell in the future
            this.netBuys -= size;
        }
    }

    async cleanUp() {
        //retrieve all open spot orders
        //collect data on these orders
        //cancel all of these orders
        //returns true iff all sent local orders have been canceled. 
        const rootBanks = await this.mangoGroup.loadRootBanks(this.connection);
        
        //get root bank and node bank directly from ids.json

        const openOrders = await this.mangoAccount.loadSpotOrdersForMarket(
            this.connection,
            this.spotMarket,
            this.mangoMarketIndex,
        ).catch((err) => {
            console.log("Failed to load open orders", err);
        });
        if(!openOrders) {return false;}
        let failedToCancelSomeOrder = false;

        //const cancelTx = new Transaction();
        
        for(const openOrder of openOrders) {

            // const cancelInstruction= makeCancelSpotOrderInstruction(
            //     this.mangoGroupConfig.mangoProgramId,
            //     this.mangoGroup.publicKey,
            //     this.solanaOwner.publicKey,
            //     this.mangoAccount.publicKey,
            //     this.mangoGroup.dexProgramId,
            //     this.spotMarket.publicKey,
            //     this.marketConfig.bidsKey,
            //     this.marketConfig.asksKey,
            //     this.marketConfi,
            //     this.solanaOwner.publicKey,
            //     this.marketConfig.eventsKey,
            //     openOrder,
            // );

            //cancelTx.add(cancelInstruction);

            console.log("Cancelling Order", openOrder);
            await this.client.cancelSpotOrder(
                this.mangoGroup,
                this.mangoAccount,
                this.solanaOwner,
                this.spotMarket,
                openOrder
            ).then((res) => {
                this.processUnfilledOrder(
                    openOrder.side, 
                    openOrder.price, 
                    openOrder.size
                );
                console.log("Cancelled order", res);
            }).catch((err) => {
                console.log("Failed to cancel order", err);
                failedToCancelSomeOrder = true;
            });
        }

        // await this.client.sendTransaction(
        //     cancelTx,
        //     this.solanaOwner,
        //     []
        // );

        if(failedToCancelSomeOrder) {
            return false;
        }
        return true;
    }

    async gogo() {
        //run strategy
        const clean= await this.cleanUp();
        if(!clean) {
            console.log("Did not clear all open orders. Not placing any more orders");
            return;
        }


        //run market making logic here. 
        let depth = 4;
        let bids = await this.getBids(depth);
        let asks = await this.getAsks(depth);
        let best_bid = bids[0][0]; //take into account size
        let best_ask = asks[0][0];
        const pythPrice = await this.getPythPrice()
        const predictedTrue = pythPrice.aggregate.price;
        
        if(predictedTrue < best_bid) {
            await this.buy(.2, predictedTrue);
            return;
        }
        if(predictedTrue > best_ask) {
            await this.sell(.2, predictedTrue);
            return;
        }

        //get a better estimate for the spread here. 
        let totalAskSize = 0;
        let weightedAskPrice = 0;
        for(let i = 0; i < depth; i++) {
            weightedAskPrice += asks[i][0]*asks[i][1];
            totalAskSize += asks[i][1];
        }
        weightedAskPrice = weightedAskPrice/totalAskSize;

        let totalBidSize = 0;
        let weightedBidPrice = 0;
        for(let i = 0; i < depth; i++) {
            weightedBidPrice += bids[i][0]*bids[i][1];
            totalBidSize += bids[i][1];
        }
        weightedBidPrice = weightedBidPrice/totalBidSize;

        const spread = weightedAskPrice - weightedBidPrice;

        //note that we may trade up to 5x leverage
        await this.buy(4, predictedTrue - 1.3*spread);
        await this.sell(4, predictedTrue  + .2*spread);
        await this.sell(4, predictedTrue + .3*spread);
        await this.buy(4, predictedTrue - 2*spread);
    }

}