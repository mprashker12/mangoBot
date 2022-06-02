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
    getMarketIndexBySymbol
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

export class mangoSpotMarketMaker {

    symbol : string;
    client : MangoClient;
    connection : Connection;
    spotMarket : Market;
    solanaOwner : Keypair;
    mangoGroup : MangoGroup;
    mangoAccount : MangoAccount;
    mangoMarketIndex : number;
    pythOracle : PythHttpClient;

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
        let asks = await this.spotMarket.loadBids(this.connection);
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
        );
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
        );
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
        
        await this.mangoGroup.loadRootBanks(this.connection);
        let openOrders = await this.mangoAccount.loadSpotOrdersForMarket(
            this.connection,
            this.spotMarket,
            this.mangoMarketIndex,
        );

        if(openOrders.length === 0) {
            console.log("Do not have any open orders");
            return;
        }
    
        for(const openOrder of openOrders) {
            console.log("Cancelling Order", openOrder);
            await this.client.cancelSpotOrder(
                this.mangoGroup,
                this.mangoAccount,
                this.solanaOwner,
                this.spotMarket,
                openOrder
            );
        }
    }

    async gogo() {
        //run strategy
        await this.cleanUp();
        let depth = 20;
        
        let bids = await this.getBids(depth);
        let asks = await this.getAsks(depth);
        depth = Math.min(bids.length, asks.length);
        
        const predictedTrue = (await this.getPythPrice()).aggregate.price;
        this.buy(.5, predictedTrue - .3);
        this.sell(.5, predictedTrue + .5)
    }

}