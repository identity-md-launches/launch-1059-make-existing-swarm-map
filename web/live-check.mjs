// Bounded live RPC smoke check; run separately from deterministic interaction tests.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const {ethers}=createRequire(import.meta.url)('../ethers.umd.min.js');
const mc=new ethers.Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[]) payable returns((bool success,bytes returnData)[])']);
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'artifacts');await mkdir(out,{recursive:true});
const report={at:new Date().toISOString(),kind:'live public Ethereum RPC, no fixture',requests:[],errors:[],failures:[]};
const server=createServer(async(req,res)=>{
  const name=req.url.replace(/^\/preview\//,'')||'index.html';
  if(!['index.html','swarm.js','ethers.umd.min.js','favicon.svg','screenshot.png'].includes(name)){res.writeHead(404).end();return;}
  try {res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.html')?'text/html':name.endsWith('.svg')?'image/svg+xml':'image/png');res.end(await readFile(resolve(root,'dist',name)));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('requestfailed',r=>report.failures.push({url:r.url(),error:r.failure()?.errorText}));
  page.on('request',r=>{
    if(r.method()!=='POST')return;
    const b=r.postDataJSON(),item={method:b.method,url:r.url(),at:Date.now()};
    if(b.method==='eth_getLogs')Object.assign(item,{from:Number(b.params[0].fromBlock),to:Number(b.params[0].toBlock)});
    if(b.method==='eth_call') {item.block=b.params[1];item.calldataBytes=(b.params[0].data.length-2)/2;
      if(b.params[0].data.startsWith(mc.getFunction('aggregate3').selector))item.subcalls=mc.decodeFunctionData('aggregate3',b.params[0].data)[0].length;
    }
    report.requests.push(item);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/preview/`);
  await page.waitForFunction(()=>window.__swarm?.ready,null,{timeout:120000});
  const capture=()=>page.evaluate(()=>({block:document.querySelector('#blk').textContent,nodes:window.__swarm.nodes(),levels:window.__swarm.G().apl,weight:String(window.__swarm.G().tw),pending:String(window.__swarm.G().sumPend),backlog:String(window.__swarm.G().backlog),balance:String(window.__swarm.G().bal),usd:window.__swarm.G().usd}));
  report.initial=await capture();
  assert.equal(report.initial.nodes,report.initial.levels.reduce((a,b)=>a+b,0));
  assert.equal(Number(report.initial.weight),report.initial.levels.reduce((a,b,i)=>a+b*2**i,0));
  assert.equal(report.requests.filter(r=>r.method==='eth_getLogs').length,0);
  const block=Number(report.initial.block.replace(/\D/g,''));
  await page.waitForFunction(b=>Number(document.querySelector('#blk').textContent.replace(/\D/g,''))>b,block,{timeout:60000});
  report.next=await capture();
  assert.equal(report.next.nodes,report.next.levels.reduce((a,b)=>a+b,0));
  assert(report.requests.filter(r=>r.method==='eth_getLogs').every(r=>r.from>block && r.to-r.from<50));
  await page.screenshot({path:resolve(out,'live-desktop.png'),scale:'css'});
  await page.setViewportSize({width:375,height:812});await page.waitForTimeout(1200);
  await page.screenshot({path:resolve(out,'live-mobile.png'),scale:'css'});
  assert.deepEqual(report.errors,[]);report.result='passed';console.log(JSON.stringify({result:report.result,initial:report.initial,next:report.next,requests:report.requests.length,failures:report.failures},null,2));
} catch(error){report.result='failed';report.failure=error.stack;process.exitCode=1;console.error(error.message);}
finally {await browser?.close();await new Promise(r=>server.close(r));await writeFile(resolve(out,'live-results.json'),JSON.stringify(report,null,2)+'\n');}
