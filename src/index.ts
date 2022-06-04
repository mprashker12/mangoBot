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

//serum (only need to load spot markets. may remove if focus on perps)
import {
    Market
} from '@blockworks-foundation/mango-client/node_modules/@project-serum/serum';

//mango
import {
  Config,
  MangoClient,
  MangoGroup,
  MangoAccount,
  MangoCacheLayout,
  GroupConfig,
  getMarketByBaseSymbolAndKind,
  getMarketIndexBySymbol,
  getMultipleAccounts,
  makePlacePerpOrder2Instruction,
  MangoCache,
  PerpMarketConfig,
  PerpMarket,
} from '@blockworks-foundation/mango-client';
import ids from '../ids.json';

import {
    mangoSpotMarketMaker
 } from './mangoSpotMarketMaker';
import { 
  mangoPerpMarketMaker 
} from './mangoPerpMarketMaker';


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
  //general Mango Group Configuration
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
  const serumProgramPk = new PublicKey(clusterData.serumProgramId);
  
  //account configurations
  const mangoAccountPk = new PublicKey(mangoAccountAddress);
  const clusterUrl = ids.cluster_urls[cluster]; //Change to other RPC endpoint under congestion
  // const clusterUrl = 'https://solana-api.projectserum.com';
  connection = new Connection(clusterUrl, 'processed' as Commitment);
  client = new MangoClient(connection, mangoProgramPk);
  mangoGroup = await client.getMangoGroup(mangoGroupKey);
  mangoAccount = await client.getMangoAccount(mangoAccountPk, serumProgramPk);
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

async function loadMangoCache(
  connection : Connection,
  mangoGroup : MangoGroup
) : Promise<MangoCache> | undefined {
  const accounts = await getMultipleAccounts(
    connection,
    [mangoGroup.mangoCache]
  );
  if(accounts.length === 0) {
    throw Error("Failed to load Mango Cache Account");
  }
  const cacheAccount = accounts[0];
  const mangoCache = new MangoCache(
    cacheAccount.publicKey,
    MangoCacheLayout.decode(cacheAccount.accountInfo.data),
  );
  if(!mangoCache) {
    throw Error("Failed to load Mango Cache Account");
  }
  console.log("Successfully loaded Mango Cache");
  return mangoCache;
}
  
async function loadMangoPerpMarket(
  perpMarketConfig : PerpMarketConfig
) : Promise<PerpMarket> | undefined {
    const perpMarket = await mangoGroup.loadPerpMarket(
        connection, 
        perpMarketConfig.marketIndex,
        perpMarketConfig.baseDecimals,
        perpMarketConfig.quoteDecimals
    )
    if(perpMarket) {
      console.log("Successfully loaded perpMarket", symbol);
      return perpMarket;
    }
    throw Error("Failed to load Mango Perp Market" + symbol);
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

 function delay(ms : number) {
   return new Promise(resolve => setTimeout(resolve, ms));
 }

 async function makePerp(symbol : string) {
    await init();
    const perpMarketConfig = getMarketByBaseSymbolAndKind(
      mangoGroupConfig,
      symbol,
      'perp'
    );
    const mangoMarketIndex = getMarketIndexBySymbol( 
      mangoGroupConfig,
      symbol
    );
    let perpMarket : PerpMarket;
    let mangoCache : MangoCache;
    perpMarket = await loadMangoPerpMarket(perpMarketConfig);
    mangoCache = await loadMangoCache(
      connection,
      mangoGroup
    );
    const perpMarketMaker = new mangoPerpMarketMaker(
      symbol,
      connection,
      client,
      perpMarket,
      perpMarketConfig,
      solAccountKeyPair,
      mangoGroup,
      mangoGroupConfig,
      mangoAccount,
      mangoCache,
    );
    perpMarketMaker.gogo();
 }


async function makeSpot() {
    await init(); //initalize solana and mango accounts. 
    const onPerp = false; //are we market-making on a perp market?
    const symbol = "SRM";
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
        mangoGroupConfig,
    );
 
    for(let i = 1; i <= 2; i++) {
      console.log("ROUND NUMBER:", i)
      await marketMaker.gogo();
      await delay(10000);
    }

    //make sure orders are cleaned up
    await delay(5000);
    let clean = await marketMaker.cleanUp();
    if(clean) {
      console.log("Finished running successfully with no outstanding orders!");
    } else {
      console.log("Finished with outstanding orders");
      console.log("Looping until all orders have been cleaned...");
      while(!clean) {
          clean = await marketMaker.cleanUp();
      }
      console.log("All orders have now been cleared!")
    }
    console.log("Market Maker finished with net buys:", marketMaker.netBuys);
    console.log("Market Maker finished with net sells:", marketMaker.netSells);
    process.exit();
}

//makeSpot();
const symbol = "AVAX";
makePerp(symbol);