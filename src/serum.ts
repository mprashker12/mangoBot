import {
    connection, //Solana Connection
    groupConfig, //Mango Group Config
} from './index'

import {
    Market,
} from '@project-serum/serum'

async function getSerumSpotMarket(sym : string) {
    const marketInfo = groupConfig.spotMarkets.find((m) => {
        return m.name === sym;
    });
    
    return await Market.load(
        connection,
        marketInfo.publicKey,
        undefined,
        groupConfig.serumProgramId,
    );
}

async function getBids(market : Market) {
    const bids = await market.loadBids(connection);
    for(let [price, size] of bids.getL2(20)) {
        console.log(price, size);
    }
}

async function main() {
    const AVAXSpot = await getSerumSpotMarket('AVAX/USDC');
    await getBids(AVAXSpot);
}

main();


