//Solana
import { 
    Connection, 
    Keypair, 
    PublicKey, 
} from '@solana/web3.js';

//serum
import {
    Market,
} from '@project-serum/serum'

export class serumSpotMarket {
    
    symbol : string;
    connection : Connection;
    marketPk : PublicKey;
    serumProgramId : PublicKey;
    market : Promise<Market>;
    
    constructor(symbol : string, connection : Connection, marketPk : PublicKey, serumProgramId : PublicKey ) {
        this.symbol = symbol;
        this.connection = connection;
        this.marketPk = marketPk;
        this.serumProgramId = serumProgramId;
        this.market = this.loadSerumSpotMarket();
    }

    async loadSerumSpotMarket() {
        const market = await Market.load(
            this.connection,
            this.marketPk,
            {},
            this.serumProgramId,
        );
        return market;
    }

    async getBids(depth : number) {
        const market = await this.market;
        const bids = await market.loadBids(this.connection);
        for(let [price, size] of bids.getL2(depth)) {
            console.log(price, size);
        }
    }

    async getAsks(depth : number) {
        const market = await this.market;
        const asks = await market.loadAsks(this.connection);
        for(let [price, size] of asks.getL2(depth)) {
            console.log(price, size);
        }
    }
}




