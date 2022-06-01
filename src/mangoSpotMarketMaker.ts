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
    MangoClient
} from '@blockworks-foundation/mango-client'

//serum
import {
    Market
} from '@blockworks-foundation/mango-client/node_modules/@project-serum/serum';

export class mangoSpotMarketMaker {

    client : MangoClient;
    connection : Connection;
    spotMarket : Market;

    constructor(client : MangoClient, connection : Connection, spotMarket : Market) {
        this.client = client;
        this.connection = connection;
        this.spotMarket = spotMarket;
    }

    async showBids(depth : number) {
        let bids = await this.spotMarket.loadBids(this.connection);
        for(let [price, size] of bids.getL2(depth)) {
            console.log(price, size);
        }
    }


}