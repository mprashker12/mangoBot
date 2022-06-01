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

//serum
import {
    Market
} from '@blockworks-foundation/mango-client/node_modules/@project-serum/serum';

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

import {
    mangoSpotMarketMaker
 } from './mangoSpotMarketMaker';

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
  //const clusterUrl = ids.cluster_urls[cluster]; //Change to other RPC endpoint under congestion
  const clusterUrl = 'https://solana-api.projectserum.com';

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

async function loadMangoPerpMarket(sym : string) {
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

async function loadMangoSpotMarket(sym : string) {
    const marketInfo = groupConfig.spotMarkets.find((m) => {
        return m.name === sym;
    });

    return Market.load(
        connection,
        marketInfo.publicKey,
        {},
        groupConfig.serumProgramId
    );
 }


async function main() {
    await init();
    const spotAVAX = await loadMangoSpotMarket('AVAX/USDC');
    const AVAXSpotMarketMaker = new mangoSpotMarketMaker(
        client,
        connection,
        spotAVAX,
        solAccountKeyPair,
        mangoGroup,
        mangoAccount,
    );
    let asks = await AVAXSpotMarketMaker.getAsks(20);
    for(let i = 0; i < asks.length; i++) {
        console.log(asks[i][0], asks[i][1]);
    }
}

main();