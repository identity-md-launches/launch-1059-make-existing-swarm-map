// Development-only, deterministic chain responses; never imported by the site.
import { createRequire } from 'node:module';
const { ethers } = createRequire(import.meta.url)('../ethers.umd.min.js');
export const DIST = '0xd450ea80aeC46B8bFfdf0C4F44d3964489B613f2';
export const NFT = '0x999ce0CE8C5f7661e0c74a568FfE27CEB9177bDB';
export const PM = '0x000000000004444c5dc75cB358380D2e3dE08A90';
export const POOL = '0x5f95e64cf8e8f4e4376c1d97b5959dc479abf7b191ba0b286faeb2ec4180a2f9';
const abi = new ethers.Interface([
  'function totalMinted() view returns(uint256)', 'function ownerOf(uint256) view returns(address)',
  'function level(uint256) view returns(uint8)', 'function pending(uint256) view returns(uint256)', 'function lastActivation(uint256) view returns(uint256)',
  'function totalWeight() view returns(uint256)', 'function activePerLevel(uint8) view returns(uint256)', 'function backlogLeft() view returns(uint256)',
  'function streamEnd() view returns(uint256)', 'function unfundedFees() view returns(uint256)', 'function getEthBalance(address) view returns(uint256)',
  'function getCurrentBlockTimestamp() view returns(uint256)', 'function getSlot0(bytes32) view returns(uint160,int24,uint24,uint24)',
  'function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)', 'function tokenURI(uint256) view returns(string)',
]);
const mc = new ethers.Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[]) payable returns((bool success,bytes returnData)[])']);
const events = new ethers.Interface([
  'event Activated(uint256 indexed tokenId,address indexed owner,uint8 level,uint256 burned)',
  'event Upgraded(uint256 indexed tokenId,address indexed owner,uint8 oldLevel,uint8 newLevel,uint256 burned)',
  'event Exited(uint256 indexed tokenId,address indexed owner,uint256 ethPaid)',
  'event RewardsReceived(uint256 normal,uint256 surplus)',
  'event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)',
]);
export const BASE = 30000000;
export function fixture() {
  const owners = [DIST.toLowerCase(), NFT.toLowerCase(), PM.toLowerCase()];
  const state = { head:BASE, calls:[], fail: null, delay:0, activeImages:0, maxImages:0, maxHttp:0, activeHttp:0, imageIds:[], partial:false, variant:0, logs:[], minted:36 };
  state.population = Array.from({length:30},(_,i)=>({id:i+1, owner:owners[i%3], level:i%3+1, pending:BigInt(i+1)*10n**13n, last:1800000000}));
  state.log = (name, args, block, index=0) => {
    const encoded = events.encodeEventLog(events.getEvent(name),args);
    const log = { address:name==='Swap'?PM:DIST, topics:encoded.topics,data:encoded.data,blockNumber:ethers.toQuantity(block),logIndex:ethers.toQuantity(index),transactionHash:ethers.keccak256(ethers.toUtf8Bytes(`fixture-${block}`)) };
    state.logs.push(log); return log;
  };
  state.burst = () => {
    state.head++;
    state.log('Swap',[POOL,owners[0],-(10n**17n),10n**22n,2n**96n,1000,0,3000],state.head,0);
    state.log('RewardsReceived',[10n**15n,10n**14n],state.head,1);
  };
  const uri = id => 'data:application/json;base64,'+Buffer.from(JSON.stringify({name:`Test Pepe ${id}`,attributes:[{value:'Test art'}],image:'data:image/svg+xml;base64,'+Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#39ff9f"/><path d="M12 18h12v12H12zm28 0h12v12H40zM16 44h32v6H16z" fill="#03040a"/></svg>`).toString('base64')})).toString('base64');
  function result(call) {
    const {name,args} = abi.parseTransaction({data:call.callData});
    if (state.partial && name==='pending') return { success:false,returnData:'0x' };
    const p=state.population.find(n=>n.id===Number(args.length ? args[0] : -1));
    const value = ({totalMinted:()=>state.minted, ownerOf:()=>p?.owner||owners[0],level:()=>p?.level||0,pending:()=>p?.pending||0n,lastActivation:()=>p?.last||0,
      totalWeight:()=>state.population.reduce((s,n)=>s+2**(n.level-1),0),activePerLevel:()=>state.population.filter(n=>n.level===Number(args.length ? args[0] : -1)).length,
      backlogLeft:()=>10n**18n,streamEnd:()=>1802592000,unfundedFees:()=>0,getEthBalance:()=>2n*10n**18n,getCurrentBlockTimestamp:()=>1800000000,
      getSlot0:()=>[2n**110n,0,0,3000],latestRoundData:()=>[1,2500n*10n**8n,1800000000,1800000000,1],tokenURI:()=>uri(Number(args.length ? args[0] : -1))})[name]();
    return {success:true,returnData:abi.encodeFunctionResult(name,Array.isArray(value)?value:[value])};
  }
  state.route = async route => {
    const body = route.request().postDataJSON();
    const entry={url:route.request().url(), method:body.method, params:body.params, names:[], ids:[], at:await route.request().frame().evaluate(()=>Date.now())};
    if(body.method==='eth_call' && body.params[0].data.startsWith(mc.getFunction('aggregate3').selector)) {
      entry.batch=mc.decodeFunctionData('aggregate3',body.params[0].data)[0];
      entry.names=entry.batch.map(c=>abi.parseTransaction({data:c.callData}).name);
      entry.ids=entry.batch.filter(c=>abi.parseTransaction({data:c.callData}).name==='tokenURI').map(c=>Number(abi.parseTransaction({data:c.callData}).args[0]));
    }
    state.calls.push(entry); state.activeImages+=entry.ids.length; state.maxImages=Math.max(state.maxImages,state.activeImages); state.activeHttp++; state.maxHttp=Math.max(state.maxHttp,state.activeHttp);
    try {
      if(state.delay) await new Promise(r=>setTimeout(r,state.delay));
      const fail=state.fail?.(entry);
      if(fail) { await route.fulfill({status:fail.status||200,contentType:'application/json',body:JSON.stringify(fail.status===429?{}:{jsonrpc:'2.0',id:body.id,error:fail.error})});return; }
      let value;
      if(body.method==='eth_blockNumber') value=ethers.toQuantity(state.head);
      else if(body.method==='eth_getLogs') {const f=body.params[0];value=state.logs.filter(l=>l.address.toLowerCase()===f.address.toLowerCase() && Number(l.blockNumber)>=Number(f.fromBlock) && Number(l.blockNumber)<=Number(f.toBlock));}
      else if(body.method==='eth_call') {
        if(entry.batch) value=mc.encodeFunctionResult('aggregate3',[entry.batch.map(result)]);
        else value=result({callData:body.params[0].data}).returnData;
      } else throw new Error('Unexpected RPC method '+body.method);
      state.imageIds.push(...entry.ids);
      await route.fulfill({contentType:'application/json',body:JSON.stringify({jsonrpc:'2.0',id:body.id,result:value})});
    } finally {state.activeImages-=entry.ids.length;state.activeHttp--;}
  };
  return state;
}
