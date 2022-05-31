import * as os from 'os';
import * as fs from 'fs';
import {
  Config,
  MangoClient,
  getMarketByBaseSymbolAndKind,
  MangoGroup,
  MangoAccount,
  GroupConfig,
} from '@blockworks-foundation/mango-client';

import { Commitment, Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Market, OpenOrders } from '@project-serum/serum';

import ids from '../ids.json';

//globals
const cluster = 'mainnet';
const group = 'mainnet.1';
const myMangoAccountAddress = 'EsZWvt5hYSVYDp81374HkQpVvG7NctiTzzVpmkA17YXf';

let payer : Keypair
let client : MangoClient;
let mangoGroup : MangoGroup;
let mangoAccount : MangoAccount;
let connection : Connection;
let groupConfig : GroupConfig | undefined;


async function init() {

  
  const config = new Config(ids);
  const groupIds =
  config.getGroup(cluster, group) ??
  (() => {
    throw new Error(`Group ${group} not found`);
  })();
  
  groupConfig = config.getGroup(cluster, group);
  if (!groupConfig) {
      throw new Error("unable to get mango group config");
  }
  const clusterData = ids.groups.find((g) => {
    return g.name == group && g.cluster == cluster;
  });
  if(!clusterData) {
    throw new Error('unable to get cluster data for Group ${group}');
  }


  const mangoGroupKey = groupConfig.publicKey;
  const mangoProgramIdPk = new PublicKey(clusterData.mangoProgramId);
  const serumProgramIdPk = new PublicKey(clusterData.serumProgramId);
  const clusterUrl = ids.cluster_urls[cluster];
  const myMangoAccountPubKey = new PublicKey(myMangoAccountAddress);
  
 
  connection = new Connection(clusterUrl, 'processed' as Commitment);
  client = new MangoClient(connection, mangoProgramIdPk);
  mangoAccount = await client.getMangoAccount(myMangoAccountPubKey, serumProgramIdPk);
  mangoGroup = await client.getMangoGroup(mangoGroupKey);

  payer = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        process.env.PRIVATE_KEY ||
          fs.readFileSync(
            process.env.KEYPAIR || os.homedir() + '/.config/solana/id.json',
            'utf-8',
          ),
      ),
    ),
  );


  // const spotMarketConfig = getMarketByBaseSymbolAndKind(
  //   groupConfig,
  //   'SOL',
  //   'perp',
  // );

  // const perpMarket = await mangoGroup.loadPerpMarket(
  //   connection,
  //   spotMarketConfig.marketIndex,
  //   spotMarketConfig.baseDecimals,
  //   spotMarketConfig.quoteDecimals,
  // );

  // const bids = await perpMarket.loadBids(connection);
  // console.log(bids);


  // await client.placePerpOrder2(
  //   mangoGroup,
  //   mangoAccount,
  //   perpMarket,
  //   payer,
  //   'buy',
  //   47,
  //   .2,
  // );

}

async function buyPerp() {

}

async function main() {
  await init();
  console.log(mangoGroup);

}

main();