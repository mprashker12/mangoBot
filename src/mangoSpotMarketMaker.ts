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
} from '@blockworks-foundation/mango-client'

//serum
import {
    Market
} from '@blockworks-foundation/mango-client/node_modules/@project-serum/serum';

export class mangoSpotMarketMaker {

    client : MangoClient;
    connection : Connection;
    spotMarket : Market;
    solanaOwner : Keypair;
    mangoGroup : MangoGroup;
    mangoAccount : MangoAccount;

    constructor(
        client : MangoClient, 
        connection : Connection, 
        spotMarket : Market,
        solanaOwner : Keypair,
        mangoGroup : MangoGroup,
        mangoAccount : MangoAccount) {
        this.client = client;
        this.connection = connection;
        this.spotMarket = spotMarket;
        this.solanaOwner = solanaOwner
        this.mangoGroup = mangoGroup;
        this.mangoAccount = mangoAccount;
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
        "mango Account:", this.mangoAccount.publicKey);
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
        console.log("Buying", "amount:", amount, "price:", price,
        "mango Account:", this.mangoAccount.publicKey);
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

    gogo() {
        //run strategy
    }

}