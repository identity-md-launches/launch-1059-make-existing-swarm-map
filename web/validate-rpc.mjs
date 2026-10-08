import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fixture, BASE, DIST, NFT } from './rpc-fixture.mjs';

export async function validateRPC(browser, url, check, out) {
  const context = await browser.newContext({viewport:{width:375,height:812}});
  const chain=fixture(); await context.route('https://**/*',chain.route);
  const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install(); await page.clock.pauseAt(new Date());
  // Headless visibility is made explicit to test the actual production handler.
  await page.addInitScript(() => {
    window.testVisibility='visible';
    Object.defineProperty(document,'visibilityState',{get:()=>window.testVisibility,configurable:true});
  });
  const settle = async (predicate, label) => {
    for(let i=0;i<50;i++) {await page.clock.runFor(400); await page.waitForTimeout(15); if(await predicate()) return;}
    throw new Error('Timed out: '+label);
  };
  const focus=async()=>page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  const ready=async()=>page.evaluate(()=>window.__swarm?.ready);
  const snapshotCalls=()=>chain.calls.filter(c=>c.names.includes('pending'));
  const images=()=>chain.calls.filter(c=>c.names.includes('tokenURI'));
  const status=()=>page.locator('#rpcMessage').textContent();
  try {
    // Startup 429s: 15s, 30s, 60s, 60s, rotating the entire existing list.
    let remaining=4;
    chain.fail=()=>remaining-->0?{status:429}:null;
    await page.goto(url);
    await settle(async()=>(await status()).includes("Can't reach Ethereum RPC"),'busy note');
    const gaps=[15000,30000,60000,60000];
    for(let i=0;i<4;i++) {
      const count=chain.calls.length;
      await page.waitForTimeout(150);
      const elapsed=await page.evaluate(()=>Date.now())-chain.calls.at(-1).at;
      await page.clock.fastForward(Math.max(0,gaps[i]-elapsed-100)); await page.waitForTimeout(30);
      assert.equal(chain.calls.length,count,'must wait for exponential cooldown');
      await page.clock.runFor(500);
      await settle(()=>Promise.resolve(chain.calls.length>count),'next retry');
      await page.waitForTimeout(150);
    }
    await settle(ready,'recovered startup');
    assert.equal(new Set(chain.calls.slice(0,5).map(c=>c.url)).size,5);
    assert.equal(await status(),'');
    check('startup HTTP 429 recovers, rotates five endpoints, waits 15/30/60/60 seconds');
    assert.equal(chain.calls.filter(c=>c.method==='eth_getLogs').length,0);
    assert.equal(snapshotCalls().length,1);
    assert.equal(snapshotCalls()[0].params[1],'0x'+BASE.toString(16));
    assert.equal(snapshotCalls()[0].names.filter(n=>n==='pending').length,30);
    assert.equal(chain.calls.filter(c=>c.names.length && c.names.every(n=>n==='level')).length,1);
    check('startup: bounded level discovery, one atomic active-state Multicall, zero historical logs');
    assert.equal(await page.locator('#btnReplay,#rpSpeed,#rpBar,#rpLbl').count(),0);

    // Let any visible art settle, then prove an unchanged block is just one read.
    await page.clock.runFor(8000); await page.waitForTimeout(100);
    let start=chain.calls.length; await focus();
    await settle(()=>Promise.resolve(chain.calls.length>start),'same head');
    await page.clock.runFor(2000);
    assert(chain.calls.slice(start).every(c=>c.method==='eth_blockNumber'));
    check('unchanged head skips logs, state and price');

    // Range boundaries, initial cursor, changes, owners, and snapshot values.
    chain.head=BASE+121;
    chain.population[0].owner=NFT.toLowerCase(); chain.population[1].level=3;chain.population[1].last++;
    chain.population.push({id:31,owner:DIST.toLowerCase(),level:2,pending:123n,last:1800000001});
    chain.population=chain.population.filter(n=>n.id!==3);
    chain.log('Activated',[31,DIST,2,1],BASE+1,0);
    chain.log('Upgraded',[2,DIST,2,3,1],BASE+1,1);
    chain.log('Exited',[3,DIST,1],BASE+1,2);
    start=chain.calls.length; await focus();
    await settle(async()=> (await page.locator('#blk').textContent()).includes((BASE+50).toLocaleString('en-US')),'first range');
    const ranges=chain.calls.slice(start).filter(c=>c.method==='eth_getLogs');
    assert.equal(ranges.length,2);
    assert(ranges.every(c=>Number(c.params[0].fromBlock)===BASE+1 && Number(c.params[0].toBlock)===BASE+50));
    let nodes=await page.evaluate(()=>window.__swarm.view().nodes);
    assert.equal(nodes.length,30);assert(!nodes.some(n=>n.id===3));assert(nodes.some(n=>n.id===31));
    assert.equal(nodes.find(n=>n.id===1).owner,NFT.toLowerCase());assert.equal(nodes.find(n=>n.id===2).level,3);
    await page.clock.runFor(13000);
    nodes=await page.evaluate(()=>window.__swarm.view().nodes);
    assert.equal(nodes.find(n=>n.id===2).level,3);assert(!nodes.some(n=>n.id===3));
    await settle(async()=> (await page.locator('#blk').textContent()).includes((BASE+100).toLocaleString('en-US')),'second range');
    await page.clock.fastForward(15000);
    await settle(async()=> (await page.locator('#blk').textContent()).includes((BASE+121).toLocaleString('en-US')),'last range');
    const logs=chain.calls.filter(c=>c.method==='eth_getLogs');
    assert(logs.every(c=>Number(c.params[0].toBlock)-Number(c.params[0].fromBlock)<50 && Number(c.params[0].fromBlock)>BASE));
    check('50-block catch-up, gap-free cursor, activation/upgrade/exit and transferred owner; delayed effects preserve snapshot');

    // JSON RPC rate-limit on the second filter must not advance the cursor.
    chain.head++;start=chain.calls.length;
    let failed=false;
    chain.fail=e=>!failed && e.method==='eth_getLogs' && !Array.isArray(e.params[0].address) ? (failed=true,{error:{code:-32005,message:'rate limit exceeded'}}):null;
    await focus();await settle(async()=>(await status()).includes("Can't reach Ethereum RPC"),'JSON rate limit');
    assert((await page.locator('#blk').textContent()).includes((BASE+121).toLocaleString('en-US')));
    await page.screenshot({path:resolve(out,'rpc-busy-mobile.png'),scale:'css'});
    const contrast=await page.locator('#rpcStatus').evaluate(el=>{
      const css=getComputedStyle(el),rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number);
      const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
      const a=lum(rgb(css.color)),b=lum(rgb(css.backgroundColor));
      return {fg:css.color,bg:css.backgroundColor,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),font:css.fontSize};
    });
    assert(contrast.ratio>=4.5);assert.equal(contrast.font,'12px');
    check('rendered retry note contrast',contrast);
    for(const [width,height] of [[320,640],[812,375]]) {
      await page.setViewportSize({width,height});await page.clock.runFor(100);
      await page.locator('#btnMenu').click();
      const geometry=await page.evaluate(()=>({note:document.querySelector('#rpcStatus').getBoundingClientRect().toJSON(),menu:document.querySelector('#controls').getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth>innerWidth}));
      assert(geometry.note.bottom<=geometry.menu.top-4);assert(!geometry.overflow);
      await page.screenshot({path:resolve(out,`rpc-busy-menu-${width}.png`),scale:'css'});
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({width:375,height:812});
    check('retry note clears menu at 320px and in landscape');
    const requestsAtFailure=chain.calls.length; await page.clock.runFor(5000);
    assert.equal(chain.calls.length,requestsAtFailure);
    await page.clock.fastForward(15000);
    await settle(async()=> (await page.locator('#blk').textContent()).includes((BASE+122).toLocaleString('en-US')),'retried cursor');
    const retries=chain.calls.slice(start).filter(c=>c.method==='eth_getLogs' && Array.isArray(c.params[0].address));
    assert.equal(retries.length,2);assert.deepEqual(retries[0].params,retries[1].params);assert.notEqual(retries[0].url,retries[1].url);
    check('JSON rate-limit cooldown covers all work; second-filter failure retries range without losing cursor');

    // Failed required subcall retains state and cursor until an intact snapshot.
    chain.head++;chain.partial=true;await focus();
    await settle(async()=>(await status()).includes("Can't reach Ethereum RPC"),'partial multicall');
    assert((await page.locator('#blk').textContent()).includes((BASE+122).toLocaleString('en-US')));
    chain.partial=false;await page.clock.fastForward(15000);
    await settle(async()=> (await page.locator('#blk').textContent()).includes((BASE+123).toLocaleString('en-US')),'partial recovery');
    check('partial Multicall preserves previous state, totals and cursor');

    // Visibility halts every RPC producer; resume catches up with blockNumber first.
    await page.evaluate(()=>{window.testVisibility='hidden';document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForTimeout(50);start=chain.calls.length;
    await page.clock.fastForward(600000);await page.waitForTimeout(100);
    assert.equal(chain.calls.length,start);
    chain.head++;
    await page.evaluate(()=>{window.testVisibility='visible';document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));});
    await settle(async()=> (await page.locator('#blk').textContent()).includes((BASE+124).toLocaleString('en-US')),'visibility resume');
    assert.equal(chain.calls[start].method,'eth_blockNumber');
    check('hidden tab makes no RPC calls for ten simulated minutes; focus resumes once');

    // Price read was last made on resume. A fresh block before five minutes excludes it.
    const priceCalls=()=>chain.calls.filter(c=>c.names.includes('latestRoundData'));
    const prices=priceCalls().length; chain.head++;await focus();
    await settle(async()=> (await page.locator('#blk').textContent()).includes((BASE+125).toLocaleString('en-US')),'under five minutes');
    assert.equal(priceCalls().length,prices);
    await page.clock.fastForward(300000);chain.head++;await focus();
    await settle(async()=> (await page.locator('#blk').textContent()).includes((BASE+126).toLocaleString('en-US')),'five minutes');
    assert.equal(priceCalls().length,prices+1);
    check('Chainlink refresh gated to five minutes and a new block');

    // Zoom out: no eager tokenURI fetch. Selecting a node lazily requests art.
    await page.evaluate(()=>{localStorage.clear();});
    await page.reload();await settle(ready,'fresh page');
    await page.locator('#c').focus();for(let i=0;i<12;i++)await page.keyboard.press('-');
    await page.clock.runFor(5000);start=images().length;
    await page.clock.runFor(5000);assert.equal(images().length,start);
    await page.keyboard.press('n');await settle(async()=>await page.locator('#tip img').count()>0,'lazy details art');
    assert(chain.maxImages<=4);assert.equal(chain.maxHttp,1);
    const stored=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes(':image:')));
    assert(stored.length>0);
    const token=(await page.evaluate(()=>window.__swarm.view())).selected;
    const before=chain.imageIds.filter(id=>id===token).length;
    await page.reload();await settle(ready,'cache reload');
    await page.locator('#c').focus();await page.keyboard.press('n');
    await settle(async()=>await page.locator('#tip img').count()>0,'cached art');
    assert.equal(chain.imageIds.filter(id=>id===token).length,before);
    check('art is lazy, globally ≤4 tokenURI subcalls / one HTTP in flight, persistent per-ID cache reused');

    // A tokenURI 429 uses the same shared cooldown; storage denial must be harmless.
    await page.evaluate(()=>localStorage.clear());
    await page.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('Quota exceeded','QuotaExceededError');};});
    await page.reload();await settle(ready,'storage-denied reload');
    let imageFailed=false;
    chain.fail=e=>!imageFailed && e.ids.length ? (imageFailed=true,{status:429}):null;
    await page.locator('#c').focus();await page.keyboard.press('n');
    await settle(async()=>(await status()).includes("Can't reach Ethereum RPC"),'image rate limit');
    start=chain.calls.length;await page.clock.runFor(5000);assert.equal(chain.calls.length,start);
    await page.clock.fastForward(15000);
    await settle(async()=>await page.locator('#tip img').count()>0,'image retry');
    assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes(':image:')).length),0);
    check('image 429 retries without poisoning cache; localStorage quota denial falls back to memory');

    chain.fail=null;chain.population=[];chain.minted=2001;
    await page.reload();await settle(ready,'empty population and large discovery');
    assert.equal(await page.evaluate(()=>window.__swarm.nodes()),0);
    assert.equal(await page.locator('#mActive').textContent(),'0');
    assert.equal(await page.locator('#lbList').textContent(),'No Pepes active yet.');
    const discovery=chain.calls.filter(c=>c.names.length&&c.names.every(n=>n==='level'));
    assert(discovery.every(c=>c.names.length<=2000));
    assert(discovery.some(c=>c.names.length===2000));
    check('empty active population renders correctly; discovery batches bounded to 2000 IDs');
    assert.deepEqual(errors,[]);check('RPC failure/recovery scenarios have no uncaught JS errors');
  } finally { await context.close(); }
}
