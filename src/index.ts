import * as os from 'os';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config();

//solana
import { 
    Cluster,
    Commitment, 
    Connection, 
    Keypair, 
    PublicKey, 
} from '@solana/web3.js';

import {
    serumSpotMarket
} from './serum';

//mango
import {
  Config,
  MangoClient,
  MangoGroup,
  MangoAccount,
  GroupConfig,
  getMarketByBaseSymbolAndKind,
} from '@blockworks-foundation/mango-client';
import ids from '../ids.json';

//solana globals
let connection : Connection; //Solana RPC Connection
let solAccountKeyPair : Keypair; //Solana Account (owns Mango Account)

//mango globals
const cluster = 'mainnet';
const group = process.env.group;
const mangoAccountAddress = process.env.mangoAccountAddress;
let mangoGroup : MangoGroup;
let mangoAccount : MangoAccount;
let client : MangoClient;
let groupConfig : GroupConfig | undefined; 

async function init() {
  const config = new Config(ids);
  groupConfig = config.getGroup(cluster, group);
  if (!groupConfig) {
      throw new Error('unable to read Mango group config file');
  }
  const clusterData = ids.groups.find((g) => {
    return g.name == group && g.cluster == cluster;
  });
  if(!clusterData) {
    throw new Error('unable to get cluster data for Group ${group}');
  }
  const mangoGroupKey = groupConfig.publicKey;
  const mangoProgramPk = new PublicKey(clusterData.mangoProgramId);
  const myMangoAccountPk = new PublicKey(mangoAccountAddress);
  const serumProgramPk = new PublicKey(clusterData.serumProgramId);
  const clusterUrl = ids.cluster_urls[cluster]; //Change to other RPC endpoint under congestion
  
  connection = new Connection(clusterUrl, 'processed' as Commitment);
  client = new MangoClient(connection, mangoProgramPk);
  mangoAccount = await client.getMangoAccount(myMangoAccountPk, serumProgramPk);
  mangoGroup = await client.getMangoGroup(mangoGroupKey);
  solAccountKeyPair = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        process.env.PRIVATE_KEY ||
          fs.readFileSync(
            process.env.KEYPAIR || os.homedir() + '/.config/solana/id.json',
            'utf-8',
          ),
      ),
    ),
  )
}

async function getPerpMarket(sym : string) {
    const perpMarketConfig = getMarketByBaseSymbolAndKind(
        groupConfig,
        sym,
        'perp'
    );

    return (await mangoGroup.loadPerpMarket(
        connection, 
        perpMarketConfig.marketIndex,
        perpMarketConfig.baseDecimals,
        perpMarketConfig.quoteDecimals
    ));
}

async function getSpotMarket(sym : string) {
    const marketInfo = groupConfig.spotMarkets.find((m) => {
        return m.name === sym;
    });

    return new serumSpotMarket(
        sym,
        connection,
        marketInfo.publicKey,
        groupConfig.serumProgramId
    );
 }


async function main() {
    await init();
    const market = await getSpotMarket('AVAX/USDC');
    market.getAsks(10);
    
    // const spotAVAX = await getSpotMarket('AVAX/USDC');
    // client.placeSpotOrder(
    //     mangoGroup,
    //     mangoAccount,
    //     mangoGroup.mangoCache,
    //     spotAVAX,
    //     solAccountKeyPair,
    //     'buy',
    //     26,
    //     .2,
    //     'limit'
    // );

    // const perpBTC = await getPerpMarket('BTC');
    // client.placePerpOrder2(
    //     mangoGroup,
    //     mangoAccount,
    //     perpBTC,
    //     solAccountKeyPair,
    //     'buy',
    //     10,
    //     .1
    // );
}

main();