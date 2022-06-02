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
  getMarketIndexBySymbol,
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
let mangoGroupConfig : GroupConfig | undefined; 

async function init() {
  const config = new Config(ids);
  mangoGroupConfig = config.getGroup(cluster, group);
  if (!mangoGroupConfig) {
      throw new Error('unable to read Mango group config file');
  }
  const clusterData = ids.groups.find((g) => {
    return g.name == group && g.cluster == cluster;
  });
  if(!clusterData) {
    throw new Error('unable to get cluster data for Group ${group}');
  }
  const mangoGroupKey = mangoGroupConfig.publicKey;
  const mangoProgramPk = new PublicKey(clusterData.mangoProgramId);
  const myMangoAccountPk = new PublicKey(mangoAccountAddress);
  const serumProgramPk = new PublicKey(clusterData.serumProgramId);
  const clusterUrl = ids.cluster_urls[cluster]; //Change to other RPC endpoint under congestion
  //const clusterUrl = 'https://solana-api.projectserum.com';

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
        mangoGroupConfig,
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
  
  const symAppended = sym + '/USDC';
  
  const marketInfo = mangoGroupConfig.spotMarkets.find((m) => {
        return m.name === symAppended;
    });

    return Market.load(
        connection,
        marketInfo.publicKey,
        {},
        mangoGroupConfig.serumProgramId
    );
 }


async function main() {
    await init(); //initalize solana and mango accounts. 
    const onPerp = false; //are we market-making on a perp market?
    const symbol = "AVAX";
    const mangoMarketIndex = getMarketIndexBySymbol(
      mangoGroupConfig,
      symbol
    );
    const market = await loadMangoSpotMarket(symbol);
    const marketMaker = new mangoSpotMarketMaker(
        symbol,
        client,
        connection,
        market,
        solAccountKeyPair,
        mangoGroup,
        mangoAccount,
    );
    await marketMaker.gogo();
    await marketMaker.cleanUp();
}

main();