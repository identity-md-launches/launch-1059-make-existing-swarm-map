import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

// All automation is development-only. Serve the committed export at a subpath.
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'artifacts');
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const baseline = url.pathname.startsWith('/baseline/');
    const name = url.pathname.replace(/^\/(preview|baseline)\//, '') || 'index.html';
    if (!['index.html', 'swarm.js', 'ethers.umd.min.js', 'favicon.svg', 'screenshot.png'].includes(name)) { res.writeHead(404).end(); return; }
    const file = baseline && ['index.html', 'swarm.js'].includes(name) ? resolve(root, 'test/scratch/baseline', name) : resolve(root, 'dist', name);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' }[extname(name)];
    res.writeHead(200, { 'Content-Type': mime }); res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const executablePath = process.env.CHROMIUM_PATH || undefined;
const report = { at: new Date().toISOString(), production: 'dist/ served under /preview/', checks: [], live: [], errors: [], networkFailures: [], desktop: [] };
let browser;
const check = (name, detail = 'passed') => { report.checks.push({ name, detail }); console.log(`PASS ${name}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); };
try {
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('requestfailed', r => report.networkFailures.push({ url: r.url(), error: r.failure()?.errorText }));
  await page.goto(url);
  await page.waitForFunction(() => window.__swarm?.ready, null, { timeout: 90000 });
  const view = () => page.evaluate(() => window.__swarm.view());
  const contract = async label => {
    const state = await page.evaluate(() => ({ nodes: window.__swarm.nodes(), activePerLevel: window.__swarm.G().apl, weight: String(window.__swarm.G().tw), block: document.querySelector('#blk').textContent, summary: document.querySelector('#mActive').textContent }));
    assert.equal(state.nodes, state.activePerLevel.reduce((a, b) => a + b, 0));
    assert.equal(state.nodes, Number(state.summary.replaceAll(',', '')));
    report.live.push({ label, ...state }); check(`contract node count ${label}`, state);
  };
  await contract('initial');
  assert.equal(await page.locator('#sheetToggle').getAttribute('aria-expanded'), 'false');
  check('sheet collapsed on entry');

  async function geometry(label) {
    const result = await page.evaluate(() => {
      const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
      const rect = id => document.getElementById(id).getBoundingClientRect().toJSON();
      const targets = [...document.querySelectorAll('button, input, select, .lbr, .ev a')].filter(visible).map(e => ({ id: e.id || e.className || e.textContent, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })).filter(e => e.w < 43.9 || e.h < 43.9);
      const smallText = [...document.querySelectorAll('body *')].filter(e => visible(e) && [...e.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 12).map(e => ({ id: e.id, text: e.textContent.slice(0, 60), size: getComputedStyle(e).fontSize }));
      return { width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, top: rect('top'), sheet: rect('sheet'), canvas: rect('c'), targets, smallText, backing: [document.querySelector('#c').width, document.querySelector('#c').height], dpr: window.__swarm.view().dpr };
    });
    assert.equal(result.scroll, result.client, `${label}: horizontal overflow`);
    assert.equal(result.dpr, 2);
    assert.deepEqual(result.backing, [Math.round(result.canvas.width * 2), Math.round(result.canvas.height * 2)]);
    assert(result.top.bottom <= result.sheet.top, `${label}: top/sheet overlap`);
    assert(result.sheet.bottom <= result.height + 1);
    assert.deepEqual(result.targets, [], `${label}: small tap targets`);
    assert.deepEqual(result.smallText, [], `${label}: small text`);
    check(label, { width: result.width, height: result.height, dpr: result.dpr, overflow: 0 });
  }
  for (const [width, height] of [[375,812],[812,375],[412,915],[915,412],[360,780],[430,932],[320,640]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(180);
    await page.locator('#sheetToggle').evaluate(e => { if (e.getAttribute('aria-expanded') === 'true') e.click(); });
    await geometry(`${width}x${height} collapsed`);
    await page.locator('#sheetToggle').click();
    for (const [tab, panel] of [['tabStats','stats'],['tabHolders','lb'],['tabEvents','tick']]) {
      await page.locator('#'+tab).click();
      assert(await page.locator('#'+panel).isVisible());
      for (const other of ['stats','lb','tick'].filter(p => p !== panel)) assert(!(await page.locator('#'+other).isVisible()));
      await geometry(`${width}x${height} ${panel}`);
      await page.locator('#sheetPanels').evaluate(e => { e.scrollTop = e.scrollHeight; });
      const endVisible = await page.evaluate(panel => {
        const container = document.querySelector('#sheetPanels').getBoundingClientRect();
        const el = panel === 'stats' ? document.querySelector('#legend') : panel === 'lb' ? document.querySelector('#lbList').lastElementChild : document.querySelector('#tickList').lastElementChild;
        if (!el) return true;
        return el.getBoundingClientRect().bottom <= container.bottom + 1;
      }, panel);
      assert(endVisible, `${width}x${height}: ${panel} end unreachable`);
    }
    if ([375,412,812,915].includes(width)) await page.screenshot({ path: resolve(out, `mobile-${width}x${height}-events.png`), scale: 'css' });
    await page.locator('#btnMenu').click();
    assert.equal(await page.locator('#sheetToggle').getAttribute('aria-expanded'), 'false');
    const menuBounds = await page.evaluate(() => ({ menu: document.querySelector('#controls').getBoundingClientRect().toJSON(), sheet: document.querySelector('#sheet').getBoundingClientRect().toJSON() }));
    assert(menuBounds.menu.bottom <= menuBounds.sheet.top - 7, `${width}x${height}: menu overlaps summary`);
    await page.locator('#btnFit').scrollIntoViewIfNeeded();
    await page.locator('#btnFit').click();
    assert.equal(await page.locator('#btnMenu').getAttribute('aria-expanded'), 'false');
    await geometry(`${width}x${height} menu Fit`);
  }

  await page.setViewportSize({ width:375, height:812 });
  await page.waitForTimeout(1000);
  const cdp = await context.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x,y], id) => ({ x, y, id, radiusX: 1, radiusY: 1 })) });
  const tap = async (x,y) => { await touch('touchStart', [[x,y]]); await touch('touchEnd', []); };
  const initial = await view();
  await touch('touchStart', [[100,180]]); await touch('touchMove', [[150,210]]); await touch('touchEnd', []);
  let next = await view();
  assert(next.camera.user); assert(Math.abs(next.camera.x - initial.camera.x) > 10);
  check('real touch drag pans');
  const scale = next.camera.s;
  await touch('touchStart', [[130,350],[210,350]]); await touch('touchMove', [[100,350],[250,350]]); await touch('touchEnd', []);
  next = await view(); assert(Math.abs(next.camera.s / scale - 1.875) < 0.03);
  check('real two-finger pinch zooms at midpoint', { before: scale, after: next.camera.s });
  await tap(40,180); await tap(40,180); assert.equal((await view()).camera.user, false);
  check('real double-tap restores Fit');
  await page.waitForTimeout(1500);
  const node = (await view()).nodes.find(n => n.screen[0] > 30 && n.screen[0] < 330 && n.screen[1] > 100 && n.screen[1] < 660);
  assert(node); await tap(...node.screen); await page.waitForTimeout(80);
  assert((await view()).selected !== null); assert(await page.locator('#tip').isVisible());
  const bounds = await page.evaluate(() => ({ tip: document.querySelector('#tip').getBoundingClientRect().toJSON(), sheet: document.querySelector('#sheet').getBoundingClientRect().toJSON(), top: document.querySelector('#top').getBoundingClientRect().toJSON() }));
  assert(bounds.tip.bottom <= bounds.sheet.top - 7); assert(bounds.tip.top > bounds.top.bottom);
  await page.screenshot({ path: resolve(out, 'mobile-375x812-node.png'), scale:'css' });
  check('tap selects node; card clears both sheet and top bar');
  await tap(25,110); await page.waitForTimeout(60); assert(!(await page.locator('#tip').isVisible()));
  check('empty-space tap dismisses card');
  for (const [width,height] of [[812,375],[915,412]]) {
    await page.setViewportSize({width,height}); await page.waitForTimeout(1000);
    await page.locator('#c').focus(); await page.keyboard.press('n'); await page.waitForTimeout(100);
    const b = await page.evaluate(() => ({tip:document.querySelector('#tip').getBoundingClientRect().toJSON(), sheet:document.querySelector('#sheet').getBoundingClientRect().toJSON(), top:document.querySelector('#top').getBoundingClientRect().toJSON()}));
    assert(b.tip.bottom <= b.sheet.top - 7); assert(b.tip.top >= b.top.bottom + 7);
    await page.locator('#tip').evaluate(e=>{e.scrollTop=e.scrollHeight;});
    await page.keyboard.press('Escape');
    check(`${width}x${height} scrollable node card clears chrome`);
  }
  await page.setViewportSize({width:375,height:812}); await page.waitForTimeout(200);
  await touch('touchStart', [[90,180],[180,180]]); await touch('touchCancel', []);
  await tap(25,120); assert.equal(await page.locator('#c').getAttribute('class'), '');
  check('touch cancellation releases gesture');

  await page.locator('#btnMenu').click();
  await page.locator('#rpSpeed').selectOption('45');
  assert.equal(await page.locator('#rpSpeed').inputValue(), '45');
  await page.locator('#hlAddr').fill('invalid'); await page.locator('#hlAddr').press('Tab');
  assert.equal(await page.locator('#hlAddr').getAttribute('aria-invalid'), 'true');
  assert(await page.locator('#walletError').isVisible());
  await page.locator('#hlAddr').fill(''); await page.locator('#hlAddr').press('Tab');
  assert(!(await page.locator('#walletError').isVisible()));
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#btnMenu').evaluate(e => e === document.activeElement), true);
  check('menu speed, wallet validation/clear, Escape focus return');
  await page.locator('#sheetToggle').click();
  await page.locator('#tabStats').focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#tabHolders').getAttribute('aria-selected'), 'true');
  const holder = page.locator('.lbr').first(); await holder.focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('.lbr').first().getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.lbr').first().evaluate(e => e === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#sheetToggle').evaluate(e => e === document.activeElement), true);
  check('keyboard tabs, holder selection, focus survives HUD rebuild, Escape');
  await page.locator('#c').focus(); await page.keyboard.press('n'); await page.waitForTimeout(100);
  assert(await page.locator('#tip').isVisible()); await page.keyboard.press('Escape');
  await page.keyboard.press('+'); assert((await view()).camera.user); await page.keyboard.press('Enter'); assert(!(await view()).camera.user);
  check('keyboard node details, zoom and Fit');
  await page.locator('#btnReplay').click(); assert.equal((await view()).mode, 'replay');
  await page.waitForTimeout(500); assert(await page.locator('#rpLbl').isVisible());
  await page.locator('#btnReplay').click(); assert.equal((await view()).mode, 'live');
  await page.waitForTimeout(1200); await contract('after replay stop');
  check('Replay starts, progresses, stops and rebuilds live nodes');

  await page.emulateMedia({ reducedMotion:'reduce' });
  await page.evaluate(() => window.__swarm.demo());
  await page.waitForTimeout(200); assert.equal((await view()).particles, 0);
  assert.equal(await page.locator('.dot').evaluate(e => getComputedStyle(e).animationName), 'none');
  check('mobile reduced motion stops particles and status blink');
  await page.emulateMedia({ reducedMotion:'no-preference' });
  await page.evaluate(() => { for (let i=0;i<12;i++) window.__swarm.demo(); });
  assert((await view()).particles <= 120); check('burst rendering capped at 120 particles');
  const timing = await page.evaluate(() => new Promise(resolve => {
    const intervals=[]; let last=performance.now();
    function sample(now) { intervals.push(now-last); last=now; if(intervals.length < 180) requestAnimationFrame(sample); else { const sorted=intervals.slice(1).sort((a,b)=>a-b); resolve({ medianMs:sorted[Math.floor(sorted.length*.5)], p95Ms:sorted[Math.floor(sorted.length*.95)], frames:sorted.length, environment:'headless Chromium, desktop host; no phone performance claim' }); } }
    requestAnimationFrame(sample);
  }));
  check('frame timing sample', timing);
  await page.locator('#btnMenu').click(); await page.locator('#hlAddr').fill(''); await page.locator('#hlAddr').press('Tab'); await page.keyboard.press('Escape');
  await page.locator('#c').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(1600);
  await page.screenshot({ path: resolve(out, 'mobile-375x812.png'), scale:'css' });
  await page.setViewportSize({ width:412,height:915 }); await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(out, 'mobile-412x915.png'), scale:'css' });
  await page.setViewportSize({ width:915,height:412 }); await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(out, 'mobile-915x412.png'), scale:'css' });
  await page.setViewportSize({ width:1440,height:900 }); await page.waitForTimeout(1000);
  assert(!(await view()).mobile); assert(await page.locator('#stats').isVisible()); assert(await page.locator('#lb').isVisible()); assert(await page.locator('#tick').isVisible());
  assert.equal(await page.locator('#legend').evaluate(e => e.parentElement.tagName), 'BODY');
  await page.screenshot({ path: resolve(out, 'desktop-1440x900.png'), scale:'css' });
  check('rotate through desktop breakpoint restores every original panel and control');
  await context.close();

  // Optional original-source comparison on this worker. Both pages render identical
  // loading data with the animated canvas hidden; compare the original desktop HUD.
  try { await access(resolve(root, 'test/scratch/baseline/index.html')); }
  catch { check('original desktop comparison', 'not rerun: original files unavailable in test/scratch/baseline'); }
  if (await access(resolve(root, 'test/scratch/baseline/index.html')).then(()=>true,()=>false)) {
    for (const [width,height] of [[1024,768],[1280,720],[1440,900]]) {
      const desktop = await browser.newContext({ viewport:{width,height} });
      await desktop.route('https://**/*', route=>route.abort());
      const shots=[], measures=[];
      for(const route of ['baseline','preview']) {
        const p=await desktop.newPage(); await p.goto(url.replace('preview', route));
        await p.addStyleTag({content:'#c, #loading { visibility:hidden !important; } .dot { animation:none !important; }'});
        await p.waitForTimeout(100);
        measures.push(await p.evaluate(()=>Object.fromEntries(['top','stats','lb','tick','legend','btnReplay','rpSpeed','hlAddr','btnFit'].map(id=>[id,document.getElementById(id).getBoundingClientRect().toJSON()]))));
        shots.push(await p.screenshot({scale:'css'})); await p.close();
      }
      assert.deepEqual(measures[0],measures[1],`desktop ${width} geometry changed`);
      assert(shots[0].equals(shots[1]),`desktop ${width} HUD pixels changed`);
      report.desktop.push({width,height,geometry:'identical',staticHudPixels:'identical'});
      check(`desktop ${width} original geometry and HUD pixels identical`); await desktop.close();
    }
  }
  assert.deepEqual(report.errors, [], 'uncaught application errors');
  assert(!report.networkFailures.some(r=>r.url.startsWith(url)), 'local export resource failures');
  check('no uncaught application errors or local asset failures');
  report.result='passed';
} catch(error) {
  report.result='failed'; report.failure=error.stack; console.error(error); process.exitCode=1;
} finally {
  await writeFile(resolve(out, 'interaction-results.json'), JSON.stringify(report,null,2)+'\n');
  await browser?.close(); await new Promise(r=>server.close(r));
}
