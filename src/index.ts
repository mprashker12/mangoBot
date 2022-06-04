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
  MangoCache,
  PerpMarketConfig,
  PerpMarket,
} from '@blockworks-foundation/mango-client';
import ids from '../ids.json';

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

    perpMarketMaker.gogo(5);
 }

const symbol = "AVAX";
makePerp(symbol);