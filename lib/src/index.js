var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import * as os from 'os';
import * as fs from 'fs';
import { Config, MangoClient, } from '@blockworks-foundation/mango-client';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import ids from '../ids.json';
//globals
const cluster = 'mainnet';
const group = 'mainnet.1';
const myMangoAccountAddress = 'EsZWvt5hYSVYDp81374HkQpVvG7NctiTzzVpmkA17YXf';
let payer;
let client;
let mangoGroup;
let mangoAccount;
let connection;
let groupConfig;
function init() {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const config = new Config(ids);
        const groupIds = (_a = config.getGroup(cluster, group)) !== null && _a !== void 0 ? _a : (() => {
            throw new Error(`Group ${group} not found`);
        })();
        groupConfig = config.getGroup(cluster, group);
        if (!groupConfig) {
            throw new Error("unable to get mango group config");
        }
        const clusterData = ids.groups.find((g) => {
            return g.name == group && g.cluster == cluster;
        });
        if (!clusterData) {
            throw new Error('unable to get cluster data for Group ${group}');
        }
        const mangoGroupKey = groupConfig.publicKey;
        const mangoProgramIdPk = new PublicKey(clusterData.mangoProgramId);
        const serumProgramIdPk = new PublicKey(clusterData.serumProgramId);
        const clusterUrl = ids.cluster_urls[cluster];
        const myMangoAccountPubKey = new PublicKey(myMangoAccountAddress);
        connection = new Connection(clusterUrl, 'processed');
        client = new MangoClient(connection, mangoProgramIdPk);
        mangoAccount = yield client.getMangoAccount(myMangoAccountPubKey, serumProgramIdPk);
        mangoGroup = yield client.getMangoGroup(mangoGroupKey);
        payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY ||
            fs.readFileSync(process.env.KEYPAIR || os.homedir() + '/.config/solana/id.json', 'utf-8'))));
    });
}
function buyPerp() {
    return __awaiter(this, void 0, void 0, function* () {
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        yield init();
        console.log(mangoGroup);
    });
}
main();
//# sourceMappingURL=index.js.map