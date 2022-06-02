//solana
import { 
    Cluster,
    Commitment, 
    Connection, 
    Keypair, 
    PublicKey, 
} from '@solana/web3.js';

//mango
import {
    MangoClient,
    MangoGroup,
    MangoAccount,
    MangoCache,
    getMarketIndexBySymbol,
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
    pythOracle : PythHttpClient;
    localOpenOrders : number;

    constructor(
        symbol : string,
        client : MangoClient, 
        connection : Connection, 
        spotMarket : Market,
        solanaOwner : Keypair,
        mangoGroup : MangoGroup,
        mangoAccount : MangoAccount) 
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
        this.pythOracle = new PythHttpClient(
            this.connection,
            getPythProgramKeyForCluster('mainnet-beta')
        ); 
        this.localOpenOrders = 0;
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
            console.log("place order", receipt);
            this.localOpenOrders++;
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
            this.localOpenOrders++;
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

    async cleanUp() {
        //retrieve all open spot orders
        //collect data on these orders
        //cancel all of these orders
        console.log("Cancelling open orders...");
        await this.mangoGroup.loadRootBanks(this.connection);
        let openOrders = await this.mangoAccount.loadSpotOrdersForMarket(
            this.connection,
            this.spotMarket,
            this.mangoMarketIndex,
        );
        for(const openOrder of openOrders) {
            console.log("Cancelling Order", openOrder);
            await this.client.cancelSpotOrder(
                this.mangoGroup,
                this.mangoAccount,
                this.solanaOwner,
                this.spotMarket,
                openOrder
            ).then((receipt) => {
                console.log("Cancelled order", receipt);
                this.localOpenOrders--;
                if(this.localOpenOrders == 0) {
                    return;
                }
            }).catch((err) => {
                console.log("Failed to cancel order", err);
            });
        }
    }

    async gogo() {
        //run strategy
        await this.cleanUp();
        let depth = 4;
        
        let bids = await this.getBids(depth);
        let asks = await this.getAsks(depth);
        let best_bid = bids[0][0]; //take into account size
        let best_ask = asks[0][0];
        const pythPrice = await this.getPythPrice()
        const predictedTrue = pythPrice.aggregate.price;
        if(predictedTrue < best_bid) {
            await this.buy(.5, predictedTrue);
            return;
        }
        if(predictedTrue > best_ask) {
            await this.sell(.5, predictedTrue);
        }

        const spread = (best_ask - best_bid)/2;

        //note that we may trade up to 5x leverage
        await this.buy(.5, predictedTrue - .33*spread);
        await this.sell(.5, predictedTrue  + .5*spread);
    }

}