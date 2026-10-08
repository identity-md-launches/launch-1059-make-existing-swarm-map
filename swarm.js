/* OG · Swarm map. Read-only visualizer: public RPC + Multicall3, 2D canvas with additive glow. No wallet. */
(() => {
const { ethers } = window;
const A = {
  SPEPE: '0x999ce0CE8C5f7661e0c74a568FfE27CEB9177bDB', OG: '0xce7eb1ad9e2e1c784ea05f7ea4a0fe625923d10a',
  HOOK: '0x22fded8abce0d93979ebb2a04cfc37c110abe0cc', DIST: '0xd450ea80aeC46B8bFfdf0C4F44d3964489B613f2',
  AUCTION: '0xb0d2d2Cfe7A1b14d1f34135C3C7a8d152c4262e9', PM: '0x000000000004444c5dc75cB358380D2e3dE08A90',
  MULTICALL: '0xcA11bde05977b3631167028862bE2a173976CA11', STATEVIEW: '0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227',
  CL: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
};
const POOL_ID = '0x5f95e64cf8e8f4e4376c1d97b5959dc479abf7b191ba0b286faeb2ec4180a2f9';
const LOG_CHUNK = 50, POLL_MS = 15000, PRICE_MS = 300000, EXIT_LOCK = 86400;
const WEIGHT = [0, 1, 2, 4];
const params = new URLSearchParams(location.search);
// highlighted wallet: ?addr=0x… wins, else the last one picked on this browser, else none
const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const lsSet = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} };
let HL = (params.get('addr') && ethers.isAddress(params.get('addr')) ? params.get('addr') : (ethers.isAddress(lsGet('swarmHL')) ? lsGet('swarmHL') : '')).toLowerCase();
const RPCS = params.get('rpc') ? [params.get('rpc')] : ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com', 'https://rpc.ankr.com/eth', 'https://eth.drpc.org', 'https://cloudflare-eth.com'];

const iDist = new ethers.Interface([
  'function level(uint256) view returns (uint8)', 'function pending(uint256) view returns (uint256)', 'function lastActivation(uint256) view returns (uint256)',
  'function totalWeight() view returns (uint256)', 'function activePerLevel(uint8) view returns (uint256)', 'function backlogLeft() view returns (uint256)',
  'function streamEnd() view returns (uint256)', 'function unfundedFees() view returns (uint256)',
  'event Activated(uint256 indexed tokenId, address indexed owner, uint8 level, uint256 burned)',
  'event Upgraded(uint256 indexed tokenId, address indexed owner, uint8 oldLevel, uint8 newLevel, uint256 burned)',
  'event Exited(uint256 indexed tokenId, address indexed owner, uint256 ethPaid)',
  'event RewardsReceived(uint256 normal, uint256 surplus)',
]);
const iAuction = new ethers.Interface(['event AuctionListed(uint256 indexed tokenId, uint256 startPrice, uint256 startedAt)']);
const iPM = new ethers.Interface(['event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)']);
const iSpepe = new ethers.Interface(['function totalMinted() view returns (uint256)', 'function ownerOf(uint256) view returns (address)', 'function tokenURI(uint256) view returns (string)']);
const iMC = new ethers.Interface([
  'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[])',
  'function getEthBalance(address) view returns (uint256)', 'function getCurrentBlockTimestamp() view returns (uint256)',
]);
const iSV = new ethers.Interface(['function getSlot0(bytes32) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)']);
const iCL = new ethers.Interface(['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)']);
const DIST_TOPICS = ['Activated', 'Upgraded', 'Exited', 'RewardsReceived'].map((n) => iDist.getEvent(n).topicHash);
const AUCTION_TOPIC = iAuction.getEvent('AuctionListed').topicHash;
const SWAP_TOPIC = iPM.getEvent('Swap').topicHash;

// ---------- rpc ----------
// One transport for state, logs and art: no provider background retries or probes.
let rpcIndex = 0, rpcId = 0, failures = 0, retryAt = 0, nextRequestAt = 0;
let rpcTail = Promise.resolve(), activeRequest = null;
const isHidden = () => document.visibilityState === 'hidden';
const pauseError = () => new Error('RPC paused');
const rpcNote = (message) => { $('rpcStatus').hidden = !message; $('rpcMessage').textContent = message; };
function showRetry() {
  if (retryAt > 0) rpcNote(`Can't reach Ethereum RPC, retrying in ${Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))}s. ${firstLoaded ? 'Showing last available data.' : 'Waiting for data.'}`);
}
function deferRPC(error) {
  failures++;
  retryAt = Date.now() + Math.min(60000, POLL_MS * 2 ** Math.min(failures - 1, 2));
  rpcIndex = (rpcIndex + 1) % RPCS.length;
  showRetry();
}
async function requestRPC(method, args) {
  // Serialize and pace HTTP requests, including separate image batches.
  const run = rpcTail.then(async () => {
    if (isHidden() || Date.now() < retryAt) throw pauseError();
    const delay = nextRequestAt - Date.now();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (isHidden() || Date.now() < retryAt) throw pauseError();
    const controller = new AbortController(); activeRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(RPCS[rpcIndex], {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params: args }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.error) throw new Error(`${payload.error.code}: ${payload.error.message}`);
      if (payload.result == null) throw new Error('Missing RPC result');
      failures = 0; retryAt = 0; rpcNote('');
      return payload.result;
    } catch (error) {
      if (!isHidden()) deferRPC(error);
      throw error;
    } finally {
      clearTimeout(timeout); activeRequest = null; nextRequestAt = Date.now() + 350;
    }
  });
  rpcTail = run.then(() => undefined, () => undefined);
  return run;
}
async function multicall(calls, block = 'latest') {
  const data = iMC.encodeFunctionData('aggregate3', [calls.map(([target, iface, fn, args]) => ({ target, allowFailure: true, callData: iface.encodeFunctionData(fn, args) }))]);
  const raw = await requestRPC('eth_call', [{ to: A.MULTICALL, data }, block]);
  const [results] = iMC.decodeFunctionResult('aggregate3', raw);
  if (results.length !== calls.length) throw new Error('Incomplete Multicall result');
  return results.map((r, index) => {
    if (!r.success) return null;
    const [, iface, fn] = calls[index];
    try { const d = iface.decodeFunctionResult(fn, r.returnData); return d.length === 1 ? d[0] : d; }
    catch { return null; }
  });
}
async function getLogsChunked(filter, from, to) {
  const all = [];
  for (let a = from; a <= to; a += LOG_CHUNK) {
    const logs = await requestRPC('eth_getLogs', [{ ...filter, fromBlock: ethers.toQuantity(a), toBlock: ethers.toQuantity(Math.min(to, a + LOG_CHUNK - 1)) }]);
    all.push(...logs.map((l) => ({ ...l, blockNumber: Number(l.blockNumber), index: Number(l.logIndex) })));
  }
  return all;
}

// ---------- helpers ----------
/** @template {string} K @param {K} id @returns {SwarmElements[K]} */
const $ = (id) => /** @type {SwarmElements[K]} */ (document.getElementById(id));
const short = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fE = (w, d = 4) => Number(ethers.formatEther(w)).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: Math.min(d, 2) });
const nE = (w) => Number(ethers.formatEther(w));
const fmtUsd = (x) => '$' + x.toLocaleString('en-US', { maximumFractionDigits: x < 10 ? 2 : 0 });
const tsLocal = (t) => new Date(Number(t) * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const txLink = (h, txt) => `<a target="_blank" href="https://etherscan.io/tx/${h}">${txt}</a>`;
const fmtOG = (x) => x >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : x >= 1e3 ? (x / 1e3).toFixed(1) + 'k' : x.toFixed(0);
const COL = { 1: [57, 255, 159], 2: [76, 195, 255], 3: [255, 92, 240], gold: [255, 209, 102], eth: [150, 220, 255], sell: [255, 107, 107], core: [255, 170, 60] };
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const RAD = [0, 5, 7.5, 10.5];

// ---------- state ----------
const nodes = new Map();   // id -> node
const hubs = new Map();    // owner -> hub
const parts = [];          // particles
const rings = [];          // expanding flash rings
const floats = [];         // floating texts
let G = {}, head = 0, scanned = 0, mode = 'loading', firstLoaded = false;
let lastPriceAt = -Infinity, resnapshot = false;
let extrasReady = false;
let pendMax = 1e-9;
const imgCache = new Map(); // id -> {img, sprite, url}
const meta = new Map();     // id -> attributes

// ---------- canvas ----------
const cv = $('c'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
const mobileQuery = matchMedia('(max-width:767px), (max-width:1023px) and (max-height:500px)');
const motionQuery = matchMedia('(prefers-reduced-motion:reduce)');
let mobile = mobileQuery.matches, selectedId = null;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  const v = window.visualViewport;
  W = mobile && v ? v.width : innerWidth; H = mobile && v ? v.height : innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  if (mobile) {
    const style = document.documentElement.style;
    style.setProperty('--view-height', H + 'px'); style.setProperty('--view-width', W + 'px');
    style.setProperty('--view-top', (v?.offsetTop || 0) + 'px'); style.setProperty('--view-left', (v?.offsetLeft || 0) + 'px');
    requestAnimationFrame(measureChrome);
  }
}
addEventListener('resize', resize); addEventListener('orientationchange', () => requestAnimationFrame(resize));
window.visualViewport?.addEventListener('resize', resize);
window.visualViewport?.addEventListener('scroll', resize);
resize();
const cam = { s: 1, x: 0, y: 0, ts: 1, tx: 0, ty: 0, user: false };
const toScreen = (x, y) => [W / 2 + (x - cam.x) * cam.s, H / 2 + (y - cam.y) * cam.s];
const toWorld = (sx, sy) => [(sx - W / 2) / cam.s + cam.x, (sy - H / 2) / cam.s + cam.y];

// One set of panels and controls: their data remains identical in both layouts.
const panelIds = ['stats', 'lb', 'tick', 'calculator', 'how', 'alerts', 'contracts'], tabIds = ['tabStats', 'tabHolders', 'tabEvents', 'tabCalculator', 'tabHow', 'tabAlerts', 'tabContracts'];
let desktopPanel = '', panelTrigger = null;
let sheetOpen = false, activeTab = 0, menuOpen = false;
const legendHome = document.createComment('legend home');
$('legend').before(legendHome);
const mobileInsets = { left: 20, right: 20, top: 76, bottom: 76 };
function measureChrome() {
  if (!mobile) return;
  const canvasBox = cv.getBoundingClientRect(), top = $('top').getBoundingClientRect(), sheet = $('sheet').getBoundingClientRect();
  document.documentElement.style.setProperty('--sheet-height', sheet.height + 'px');
  mobileInsets.left = top.left - canvasBox.left + 12; mobileInsets.right = canvasBox.right - top.right + 12;
  mobileInsets.top = top.bottom - canvasBox.top + 20; mobileInsets.bottom = canvasBox.bottom - sheet.top + 12;
}
function setMenu(open, restoreFocus = false) {
  menuOpen = mobile && open;
  $('controls').classList.toggle('open', menuOpen);
  $('btnMenu').setAttribute('aria-expanded', String(menuOpen));
  if (menuOpen) { selectedId = null; setSheet(false); }
  if (restoreFocus) $('btnMenu').focus();
}
function setSheet(open, focusTab = false) {
  sheetOpen = mobile && open;
  $('sheet').classList.toggle('expanded', sheetOpen);
  $('sheetToggle').setAttribute('aria-expanded', String(sheetOpen));
  $('sheetToggle').setAttribute('aria-label', (sheetOpen ? 'Collapse' : 'Expand') + ' Swarm details');
  $('sheetChevron').textContent = sheetOpen ? '⌄' : '⌃';
  $('sheetBody').hidden = mobile && !sheetOpen;
  if (sheetOpen) { selectedId = null; setMenu(false); }
  panelIds.forEach((id, i) => {
    $(id).hidden = mobile ? i !== activeTab : i > 2 && id !== desktopPanel;
    if (mobile) { $(id).setAttribute('role', 'tabpanel'); $(id).setAttribute('aria-labelledby', tabIds[i]); $(id).tabIndex = 0; }
    else { $(id).removeAttribute('role'); if (i > 2) $(id).setAttribute('aria-labelledby', id + 'Title'); else $(id).removeAttribute('aria-labelledby'); $(id).removeAttribute('tabindex'); }
  });
  document.querySelectorAll('[data-open]').forEach((b) => b.setAttribute('aria-expanded', String(mobile ? sheetOpen && panelIds[activeTab] === b.getAttribute('data-open') : desktopPanel === b.getAttribute('data-open'))));
  if (extrasReady && calculatorVisible()) startFeeHistory();
  if (focusTab && sheetOpen) $(tabIds[activeTab]).focus();
  measureChrome();
}
function selectTab(i) {
  activeTab = i;
  tabIds.forEach((id, j) => { $(id).setAttribute('aria-selected', String(i === j)); $(id).tabIndex = i === j ? 0 : -1; });
  $('sheetPanels').scrollTop = 0;
  setSheet(true);
}
function applyResponsiveLayout() {
  mobile = mobileQuery.matches; desktopPanel = '';
  if (mobile) $('stats').append($('legend')); else legendHome.after($('legend'));
  selectedId = null; $('tip').style.display = 'none';
  setMenu(false); setSheet(false); resize(); measureChrome(); renderHud();
}
$('btnMenu').addEventListener('click', () => setMenu(!menuOpen));
$('sheetToggle').addEventListener('click', () => setSheet(!sheetOpen));
tabIds.forEach((id, i) => {
  $(id).addEventListener('click', () => selectTab(i));
  $(id).addEventListener('keydown', (e) => {
    const next = e.key === 'ArrowRight' ? (i + 1) % tabIds.length : e.key === 'ArrowLeft' ? (i + tabIds.length - 1) % tabIds.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabIds.length - 1 : -1;
    if (next < 0) return; e.preventDefault(); selectTab(next); $(tabIds[next]).focus(); $(tabIds[next]).scrollIntoView({ block:'nearest', inline:'nearest' });
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!mobile) { if (desktopPanel) closePanel(); return; }
  if (menuOpen) setMenu(false, true);
  else if (selectedId !== null) { selectedId = null; cv.focus(); }
  else if (sheetOpen) { setSheet(false); $('sheetToggle').focus(); }
});
document.addEventListener('pointerdown', (e) => { if (mobile && menuOpen && e.target instanceof Node && !$('top').contains(e.target)) setMenu(false); });
new ResizeObserver(measureChrome).observe($('sheet'));
new ResizeObserver(measureChrome).observe($('top'));
mobileQuery.addEventListener('change', applyResponsiveLayout);
applyResponsiveLayout();

// glow sprites
const spriteCache = new Map();
function glowSprite(c, size = 128) {
  const k = c.join(',') + size; if (spriteCache.has(k)) return spriteCache.get(k);
  const s = document.createElement('canvas'); s.width = s.height = size; const g = s.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, rgba(c, 1)); gr.addColorStop(0.12, rgba(c, 0.85)); gr.addColorStop(0.3, rgba(c, 0.32)); gr.addColorStop(0.6, rgba(c, 0.08)); gr.addColorStop(1, rgba(c, 0));
  g.fillStyle = gr; g.fillRect(0, 0, size, size); spriteCache.set(k, s); return s;
}
function glow(x, y, r, c, a = 1) { ctx.globalAlpha = a; const s = glowSprite(c, mobile ? 64 : 128); ctx.drawImage(s, x - r, y - r, r * 2, r * 2); ctx.globalAlpha = 1; }

// background stars
const stars = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() * 0.8 + 0.2, p: Math.random() * 6.28 }));

// ---------- layout ----------
function hubFor(owner) {
  owner = owner.toLowerCase();
  let h = hubs.get(owner);
  if (!h) {
    const a = Math.random() * Math.PI * 2, r = 120 + Math.random() * 60;
    h = { addr: owner, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, n: 0, w: 0, rot: Math.random() * 6.28, spin: (Math.random() < 0.5 ? -1 : 1) * (0.02 + Math.random() * 0.03), alpha: 0, members: [] };
    hubs.set(owner, h);
  }
  return h;
}
function clusterR(h) { return 18 + 11.5 * Math.sqrt(Math.max(1, h.n)) + (h.w > h.n ? 6 : 0); }
function relayout() {
  for (const h of hubs.values()) { h.n = 0; h.w = 0; h.members = []; }
  for (const n of nodes.values()) { if (n.exiting) continue; const h = hubFor(n.owner); h.n++; h.w += WEIGHT[n.level]; h.members.push(n); }
  for (const [k, h] of hubs) if (!h.n && h.alpha < 0.02) hubs.delete(k);
  for (const h of hubs.values()) {
    h.members.sort((a, b) => b.level - a.level || a.id - b.id);
    h.members.forEach((n, i) => { n.slot = i; });
  }
}
function stepLayout(dt) {
  const hs = [...hubs.values()];
  // packed golden-angle spiral by weight: biggest wallets nearest the core, each slot sized by its cluster's area
  const order = hs.filter((h) => h.n).sort((a, b) => b.w - a.w || b.n - a.n || (a.addr < b.addr ? -1 : 1));
  let area = 0; const R0 = 92;
  order.forEach((h, i) => {
    const cr = clusterR(h), a = (2 * cr + 22) ** 2 * 0.95;
    const r = Math.sqrt(R0 * R0 + (area + a / 2) / Math.PI) + cr * 0.35; area += a;
    const ang = i * 2.399963 + 0.6;
    h.gx = Math.cos(ang) * r; h.gy = Math.sin(ang) * r;
  });
  for (const h of hs) {
    h.alpha += ((h.n ? 1 : 0) - h.alpha) * Math.min(1, dt * 3);
    const cr = clusterR(h);
    let fx = h.gx != null ? (h.gx - h.x) * 2.2 : 0, fy = h.gy != null ? (h.gy - h.y) * 2.2 : 0;
    for (const o of hs) {
      if (o === h || !o.n) continue;
      const dx = h.x - o.x, dy = h.y - o.y, dd = Math.hypot(dx, dy) || 0.1, min = cr + clusterR(o) + 14;
      if (dd < min) { const f = (min - dd) * 14; fx += (dx / dd) * f; fy += (dy / dd) * f; }
    }
    const dc = Math.hypot(h.x, h.y) || 0.1, minC = cr + 80; // keep clear of the core
    if (dc < minC) { fx += (h.x / dc) * (minC - dc) * 14; fy += (h.y / dc) * (minC - dc) * 14; }
    h.vx = (h.vx + fx * dt) * 0.82; h.vy = (h.vy + fy * dt) * 0.82;
    h.x += h.vx * dt * 3; h.y += h.vy * dt * 3;
    if (!(mobile && motionQuery.matches)) h.rot += h.spin * dt;
  }
  // nodes: golden-angle phyllotaxis around their hub, slowly spinning
  const GA = 2.399963;
  for (const n of nodes.values()) {
    if (n.exiting) continue;
    const h = hubs.get(n.owner); if (!h) continue;
    const r = 15 + 10.5 * Math.sqrt(n.slot + 0.6), a = n.slot * GA + h.rot;
    const tx = h.x + Math.cos(a) * r, ty = h.y + Math.sin(a) * r;
    const k = Math.min(1, dt * (n.age < 1.5 ? 2.2 : 4));
    n.x += (tx - n.x) * k; n.y += (ty - n.y) * k;
  }
}
function fitCamera(dt) {
  if (cam.user) return;
  let minX = -120, maxX = 120, minY = -120, maxY = 120;
  for (const h of hubs.values()) { const r = clusterR(h) + 30; minX = Math.min(minX, h.x - r); maxX = Math.max(maxX, h.x + r); minY = Math.min(minY, h.y - r); maxY = Math.max(maxY, h.y + r); }
  const padL = mobile ? mobileInsets.left : W > 900 ? 270 : 20, padR = mobile ? mobileInsets.right : W > 900 ? 310 : 20, padT = mobile ? mobileInsets.top : 70, padB = mobile ? mobileInsets.bottom : 60;
  const availW = Math.max(mobile ? 60 : 200, W - padL - padR), availH = Math.max(mobile ? 60 : 200, H - padT - padB);
  const s = Math.min(availW / (maxX - minX), availH / (maxY - minY), 1.5);
  const offX = (padL - padR) / 2 / s, offY = (padT - padB) / 2 / s;
  cam.ts = s; cam.tx = (minX + maxX) / 2 - offX; cam.ty = (minY + maxY) / 2 - offY;
  const k = Math.min(1, dt * 1.8);
  cam.s += (cam.ts - cam.s) * k; cam.x += (cam.tx - cam.x) * k; cam.y += (cam.ty - cam.y) * k;
}

// ---------- node lifecycle ----------
function addNode(id, owner, level, opts = {}) {
  let n = nodes.get(id);
  if (n && !n.exiting) { n.level = level; n.owner = owner.toLowerCase(); relayout(); return n; }
  const h = hubFor(owner);
  n = { id, owner: owner.toLowerCase(), level, pending: 0, last: 0, x: opts.fromCore ? 0 : h.x, y: opts.fromCore ? 0 : h.y, r: 0, flash: opts.quiet ? 0 : 1, age: 0, slot: 0, hit: 0 };
  nodes.set(id, n); relayout();
  if (!opts.quiet) { rings.push({ node: n, t: 0, dur: 1.2, c: COL[level], max: 46 }); }
  return n;
}
function upgradeNode(id, level, owner) {
  const n = nodes.get(id); if (!n) return addNode(id, owner || HL, level);
  n.level = level; n.flash = 1; rings.push({ node: n, t: 0, dur: 1.3, c: COL[level], max: 60 }); rings.push({ node: n, t: -0.25, dur: 1.3, c: COL[level], max: 40 }); relayout();
}
function exitNode(id) {
  const n = nodes.get(id); if (!n || n.exiting) return;
  n.exiting = { t: 0, dur: 2.4, sx: n.x, sy: n.y }; n.flash = 1; relayout();
}

// ---------- particles / pulses ----------
const portal = () => toWorld(W - (!mobile && W > 900 ? 330 : 50), H * 0.5);
function addFloat(f) { floats.push(f); while (floats.length > 4) floats.shift(); }
function corePulse(ethAmt, buy) {
  const c = buy ? COL.eth : COL.sell;
  rings.push({ x: 0, y: 0, t: 0, dur: 1.0, c, max: 70 + Math.min(80, ethAmt * 260) });
  coreFlash = Math.min(1.6, coreFlash + 0.5 + Math.min(1, ethAmt * 4));
  addFloat({ x: 0, y: -46, t: 0, dur: 2.6, txt: `${buy ? '▲ BUY' : '▼ SELL'} ${ethAmt.toFixed(ethAmt < 0.01 ? 4 : 3)} ETH`, c });
}
function streamToNodes(ethAmt) {
  if (mobile && motionQuery.matches) return;
  const list = [...nodes.values()].filter((n) => !n.exiting);
  if (!list.length) return;
  const totalW = list.reduce((s, n) => s + WEIGHT[n.level], 0) || 1;
  const N = Math.round(Math.min(220, Math.max(28, 30 + Math.sqrt(ethAmt * 1e4) * 14)));
  if (parts.length > 1600) return;
  // weighted pick by node weight
  const cum = []; let acc = 0; for (const n of list) { acc += WEIGHT[n.level] / totalW; cum.push(acc); }
  for (let i = 0; i < (mobile ? Math.min(N, 32) : N) && parts.length < (mobile ? 120 : 2200); i++) {
    const u = Math.random(); let j = cum.findIndex((c) => c >= u); if (j < 0) j = list.length - 1;
    const tgt = list[j], a = Math.random() * 6.283, r0 = 62;
    parts.push({ sx: Math.cos(a) * r0, sy: Math.sin(a) * r0, tgt, t: -Math.random() * 0.9, dur: 0.9 + Math.random() * 0.7, bend: (Math.random() - 0.5) * 0.9, c: tgt.owner === HL ? COL.gold : COL.eth, size: 9 + Math.random() * 6 });
  }
  if (ethAmt > 0) addFloat({ x: 0, y: 52, t: 0, dur: 2.6, txt: `→ ${ethAmt < 0.001 ? ethAmt.toExponential(1) : ethAmt.toFixed(5)} ETH to Pepes`, c: COL.gold, small: true });
}
// inbound sparks from the screen edge into the core on a buy
function inbound(ethAmt) {
  if (mobile && motionQuery.matches) return;
  if (parts.length > 1600) return;
  const n = Math.min(mobile ? Math.min(10, 120 - parts.length) : 40, 6 + Math.round(ethAmt * 60));
  const R = Math.max(W, H) / cam.s * 0.7;
  for (let i = 0; i < n; i++) { const a = Math.random() * 6.283; parts.push({ sx: Math.cos(a) * R, sy: Math.sin(a) * R, tx: 0, ty: 0, t: -Math.random() * 0.4, dur: 0.6 + Math.random() * 0.35, bend: (Math.random() - 0.5) * 0.5, c: COL.core, size: 8 + Math.random() * 5, inb: true }); }
}

// ---------- event processing ----------
function decodeLog(l) {
  try {
    if (l.address.toLowerCase() === A.PM.toLowerCase()) {
      const ev = iPM.parseLog(l); const a0 = ev.args.amount0, a1 = ev.args.amount1;
      return { type: 'swap', buy: a0 < 0n, eth: nE(a0 < 0n ? -a0 : a0), og: nE(a1 < 0n ? -a1 : a1), sqrtP: ev.args.sqrtPriceX96, sender: ev.args.sender, block: l.blockNumber, idx: l.index, tx: l.transactionHash };
    }
    if (l.address.toLowerCase() === A.AUCTION.toLowerCase()) {
      const ev = iAuction.parseLog(l);
      return { type:'auction', id:Number(ev.args.tokenId), price:nE(ev.args.startPrice), block:l.blockNumber, idx:l.index, tx:l.transactionHash, owner:'' };
    }
    const ev = iDist.parseLog(l); if (!ev) return null;
    const base = { block: l.blockNumber, idx: l.index, tx: l.transactionHash };
    if (ev.name === 'Activated') return { ...base, type: 'act', id: Number(ev.args.tokenId), owner: ev.args.owner.toLowerCase(), level: Number(ev.args.level) };
    if (ev.name === 'Upgraded') return { ...base, type: 'up', id: Number(ev.args.tokenId), owner: ev.args.owner.toLowerCase(), from: Number(ev.args.oldLevel), level: Number(ev.args.newLevel) };
    if (ev.name === 'Exited') return { ...base, type: 'exit', id: Number(ev.args.tokenId), owner: ev.args.owner.toLowerCase(), eth: nE(ev.args.ethPaid) };
    if (ev.name === 'RewardsReceived') return { ...base, type: 'rew', eth: nE(ev.args.normal + ev.args.surplus), normal: nE(ev.args.normal), surplus: nE(ev.args.surplus) };
  } catch (e) { console.warn('decode', e?.message); }
  return null;
}
async function fetchEvents(from, to) {
  if (to < from) return [];
  const d = await getLogsChunked({ address: [A.DIST, A.AUCTION], topics: [[...DIST_TOPICS, AUCTION_TOPIC]] }, from, to);
  const s = await getLogsChunked({ address: A.PM, topics: [SWAP_TOPIC, POOL_ID] }, from, to);
  const events = [...d, ...s].map(decodeLog).filter(Boolean).sort((a, b) => a.block - b.block || a.idx - b.idx);
  for (const e of events) if (e.type === 'auction') e.owner = events.find((x) => x.type === 'exit' && x.id === e.id && x.tx === e.tx)?.owner || '';
  return events;
}
// Snapshot owns node data; queued effects must never overwrite current levels/owners.
function applyEvent(e) {
  if (e.type === 'swap') { corePulse(e.eth, e.buy); if (e.buy) inbound(e.eth); }
  else if (e.type === 'rew') setTimeout(() => streamToNodes(e.eth), 380);
  pushTicker(e);
}
// ---------- ticker ----------
const tickRows = [];
function pushTicker(e) {
  if (e.type === 'rew') { // merge into the swap row of the same tx
    const row = tickRows.find((r) => r.tx === e.tx && r.el);
    if (row) { const s = row.el.querySelector('.rw'); if (s) s.textContent = ` · ${e.eth < 0.0001 ? e.eth.toExponential(1) : e.eth.toFixed(5)} → Pepes`; }
    return;
  }
  const el = document.createElement('div'); el.className = 'ev';
  const t = `<span class="t">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>`;
  let body = '';
  if (e.type === 'swap') body = `<span class="tag ${e.buy ? 'buy' : 'sell'}">${e.buy ? 'BUY' : 'SELL'}</span>${txLink(e.tx, `${e.eth.toFixed(4)} ETH ${e.buy ? '→' : '←'} ${fmtOG(e.og)} OG`)}<span class="rw" style="color:var(--gold)"></span>`;
  else if (e.type === 'act') body = `<span class="tag act">ACTIVATE</span>${txLink(e.tx, `#${e.id} → L${e.level}`)} <span style="color:var(--mut)">${e.owner === HL ? '<b class="gold">you</b>' : short(e.owner)}</span>`;
  else if (e.type === 'up') body = `<span class="tag up">UPGRADE</span>${txLink(e.tx, `#${e.id} L${e.from}→L${e.level}`)} <span style="color:var(--mut)">${e.owner === HL ? '<b class="gold">you</b>' : short(e.owner)}</span>`;
  else if (e.type === 'exit') body = `<span class="tag exit">EXIT</span>${txLink(e.tx, `#${e.id} paid ${e.eth.toFixed(5)} ETH`)} <span style="color:var(--mut)">→ auction</span>`;
  else if (e.type === 'auction') body = `<span class="tag exit">AUCTION</span>${txLink(e.tx, `#${e.id} listed · ${fmtOG(e.price)} OG` )}`;
  el.innerHTML = t + body;
  const list = $('tickList'); $('eventEmpty')?.remove(); list.prepend(el); tickRows.unshift({ tx: e.tx, el });
  while (list.children.length > 14) list.lastChild.remove();
  if (tickRows.length > 40) tickRows.length = 40;
}

// ---------- chain state ----------
// The verified collection mints sequential IDs starting at 1 (MAX_SUPPLY 5000).
// The distributor has no enumerable active-ID view. A supply preflight bounds one
// active-ID discovery pass, then one atomic state Multicall. No event history.
async function snapshotIds(block) {
  const raw = await requestRPC('eth_call', [{ to: A.SPEPE, data: iSpepe.encodeFunctionData('totalMinted') }, block]);
  const count = Number(iSpepe.decodeFunctionResult('totalMinted', raw)[0]);
  if (!Number.isSafeInteger(count) || count < 0 || count > 5000) throw new Error('Invalid collection supply');
  const active = [];
  // Keep discovery calldata below common 1 MiB public-RPC body limits.
  for (let first = 1; first <= count; first += 2000) {
    const ids = Array.from({ length: Math.min(2000, count - first + 1) }, (_, i) => first + i);
    const levels = await multicall(ids.map((id) => [A.DIST, iDist, 'level', [id]]), block);
    levels.forEach((level, i) => {
      if (level == null || Number(level) > 3) throw new Error('Incomplete active-ID discovery');
      if (Number(level)) active.push(ids[i]);
    });
  }
  return active;
}
async function readState(ids, block) {
  const priceDue = Date.now() - lastPriceAt >= PRICE_MS;
  // Set before sending, so even failed Chainlink reads cannot repeat within 5m.
  if (priceDue) lastPriceAt = Date.now();
  const r = await multicall([
    ...ids.map((id) => [A.SPEPE, iSpepe, 'ownerOf', [id]]), ...ids.map((id) => [A.DIST, iDist, 'pending', [id]]),
    ...ids.map((id) => [A.DIST, iDist, 'lastActivation', [id]]), ...ids.map((id) => [A.DIST, iDist, 'level', [id]]),
    [A.DIST, iDist, 'totalWeight', []], [A.DIST, iDist, 'activePerLevel', [1]], [A.DIST, iDist, 'activePerLevel', [2]], [A.DIST, iDist, 'activePerLevel', [3]],
    [A.DIST, iDist, 'backlogLeft', []], [A.DIST, iDist, 'streamEnd', []], [A.DIST, iDist, 'unfundedFees', []], [A.MULTICALL, iMC, 'getEthBalance', [A.DIST]],
    [A.STATEVIEW, iSV, 'getSlot0', [POOL_ID]], [A.MULTICALL, iMC, 'getCurrentBlockTimestamp', []],
    ...(priceDue ? [[A.CL, iCL, 'latestRoundData', []]] : []),
  ], block);
  const n = ids.length, t = r.slice(4 * n), population = [];
  if (t.slice(0, 8).some((v) => v == null) || t[9] == null) throw new Error('Incomplete distributor totals');
  let sumPend = 0n, totalWeight = 0; const perLevel = [0, 0, 0];
  ids.forEach((id, i) => {
    const lv = r[3 * n + i];
    if (lv == null) throw new Error('Incomplete Pepe level');
    const level = Number(lv);
    if (!level) return;
    if (level > 3 || !r[i] || r[n + i] == null || r[2 * n + i] == null) throw new Error('Incomplete active Pepe');
    const pending = r[n + i]; sumPend += pending; totalWeight += WEIGHT[level]; perLevel[level - 1]++;
    population.push({ id, owner: r[i].toLowerCase(), level, pending: nE(pending), last: Number(r[2 * n + i]) });
  });
  if (BigInt(totalWeight) !== t[0] || perLevel.some((v, i) => BigInt(v) !== t[i + 1])) {
    resnapshot = true; throw new Error('Population changed; refreshing snapshot');
  }
  const globals = { ogPerEth: G.ogPerEth, usd: G.usd, ...G, tw: t[0], apl: perLevel, backlog: t[4], streamEnd: Number(t[5]), unfunded: t[6], bal: t[7], sumPend, ts: Number(t[9]), tsAt: Date.now() };
  if (t[8]) { const s = Number(t[8][0]) / 2 ** 96; globals.ogPerEth = s * s; }
  if (priceDue && t[10]?.[1] > 0n) globals.usd = Number(t[10][1]) / 1e8;
  return { population, globals };
}
function commitState(state) {
  const active = new Set(state.population.map((n) => n.id));
  for (const n of nodes.values()) if (!active.has(n.id)) exitNode(n.id);
  pendMax = 1e-9;
  for (const data of state.population) {
    const existing = nodes.get(data.id);
    if (existing && !existing.exiting && existing.level !== data.level) upgradeNode(data.id, data.level, data.owner);
    const n = existing && !existing.exiting ? existing : addNode(data.id, data.owner, data.level, { quiet: !firstLoaded });
    Object.assign(n, data); pendMax = Math.max(pendMax, data.pending);
  }
  G = state.globals; relayout(); renderHud();
}
// ---------- lazy images (on-chain SVG in tokenURI) ----------
const imgQueue = new Set(), imgInFlight = new Set(), imgRetryAt = new Map();
let imgBusy = false, imgTimer = 0;
const imageKey = (id) => `swarm:1:${A.SPEPE.toLowerCase()}:image:${id}`;
function acceptImage(id, uri) {
  let j;
  if (uri.startsWith('data:application/json;base64,')) j = JSON.parse(atob(uri.slice(29)));
  else if (uri.startsWith('data:application/json')) j = JSON.parse(decodeURIComponent(uri.slice(uri.indexOf(',') + 1)));
  else throw new Error('Unsupported metadata');
  if (typeof j.image !== 'string' || !/^data:image\/(svg\+xml|png|gif|webp|jpeg)[;,]/i.test(j.image)) throw new Error('Inline images only');
  meta.set(id, Array.isArray(j.attributes) ? j.attributes : []);
  const img = new Image(); const ent = { img, url: j.image, sprite: null }; imgCache.set(id, ent);
  img.onload = () => { const s = document.createElement('canvas'); s.width = s.height = 64; const g = s.getContext('2d'); g.imageSmoothingEnabled = false; g.beginPath(); g.arc(32, 32, 32, 0, 6.283); g.clip(); g.drawImage(img, 0, 0, 64, 64); ent.sprite = s; };
  img.src = j.image;
}
function loadImages(ids) {
  for (const id of ids) {
    if (imgCache.has(id) || imgInFlight.has(id) || imgQueue.has(id) || Date.now() < (imgRetryAt.get(id) || 0)) continue;
    const cached = lsGet(imageKey(id));
    if (cached) { try { acceptImage(id, cached); continue; } catch { lsSet(imageKey(id), ''); } }
    imgQueue.add(id);
  }
  scheduleImages();
}
function scheduleImages() {
  if (imgBusy || imgTimer || !imgQueue.size || !firstLoaded || isHidden()) return;
  imgTimer = window.setTimeout(() => { imgTimer = 0; pumpImages(); }, Math.max(350, retryAt - Date.now()));
}
async function pumpImages() {
  if (imgBusy || isHidden()) return;
  // At most four tokenURI subcalls, in one HTTP request, globally.
  const batch = [...imgQueue].filter((id) => nodes.has(id) && !nodes.get(id).exiting).slice(0, 4);
  if (!batch.length) { imgQueue.clear(); return; }
  batch.forEach((id) => { imgQueue.delete(id); imgInFlight.add(id); }); imgBusy = true;
  try {
    const r = await multicall(batch.map((id) => [A.SPEPE, iSpepe, 'tokenURI', [id]]));
    batch.forEach((id, i) => {
      try { acceptImage(id, r[i]); lsSet(imageKey(id), r[i]); }
      catch { imgRetryAt.set(id, Date.now() + 60000); }
    });
  } catch { batch.forEach((id) => imgQueue.add(id)); }
  finally { batch.forEach((id) => imgInFlight.delete(id)); imgBusy = false; scheduleImages(); }
}

// ---------- HUD ----------
function renderHud() {
  if (extrasReady) { renderCalculator(); renderLookup(); renderAlertWallet(); }
  if (G.tw == null) return;
  const tw = Number(G.tw), active = G.apl.reduce((a, b) => a + b, 0);
  const nodeCount = [...nodes.values()].filter((n) => !n.exiting).length;
  const back = G.sumPend + G.backlog;
  $('mActive').textContent = active.toLocaleString('en-US') + (nodeCount !== active && mode === 'live' ? ' · syncing' : '');
  $('mWeight').textContent = tw.toLocaleString('en-US');
  $('mBack').textContent = fE(back, 4);
  $('hActive').innerHTML = `${active} <small>${nodeCount !== active && mode === 'live' ? '(syncing)' : ''}</small>`;
  $('hLevels').innerHTML = `<span class="l1">${G.apl[0]}</span> / <span class="l2">${G.apl[1]}</span> / <span class="l3">${G.apl[2]}</span>`;
  $('hWeight').textContent = tw.toLocaleString('en-US');
  const epw = tw ? nE(back) / tw : 0;
  $('hEpw').innerHTML = `${epw.toFixed(5)} <small>ETH${G.usd ? ' · ' + fmtUsd(epw * G.usd) : ''}</small>`;
  $('hBack').innerHTML = `${fE(back, 4)} <small>ETH = ${fE(G.sumPend, 3)} + ${fE(G.backlog, 3)}${G.usd ? '<br>≈ ' + fmtUsd(nE(back) * G.usd) : ''}</small>`;
  if (G.ogPerEth) $('hPrice').innerHTML = `${Math.round(G.ogPerEth).toLocaleString('en-US')} <small>OG / ETH${G.usd ? '<br>1M OG ≈ ' + fmtUsd(1e6 / G.ogPerEth * G.usd) : ''}</small>`;
  else $('hPrice').textContent = 'Price unavailable; retrying with new blocks.';
  if (G.usd) $('hUsd').textContent = fmtUsd(G.usd);
  else $('hUsd').textContent = 'Feed unavailable; retrying within 5 minutes.';
  // highlighted wallet
  const mine = HL ? [...nodes.values()].filter((n) => !n.exiting && n.owner === HL) : [];
  const mw = mine.reduce((s, n) => s + WEIGHT[n.level], 0), mp = mine.reduce((s, n) => s + n.pending, 0);
  $('hHlAddr').innerHTML = HL ? `<a target="_blank" href="https://etherscan.io/address/${HL}">${short(HL)}</a>` : '';
  if (!HL) $('hMe').innerHTML = mobile ? '<small>None. Use Highlight wallet in Menu or select a holder.</small>' : '<small>none. Type a wallet in the box at the top, click a holder, or open with ?addr=0x…</small>'; else $('hMe').innerHTML = mine.length ? `w${mw} · ${tw ? (mw / tw * 100).toFixed(1) : 0}% <small>${mine.length} Pepes<br>${mp.toFixed(4)} ETH pending + ${(nE(G.backlog) * mw / (tw || 1)).toFixed(4)} backlog share</small>` : '<small>no active Pepes</small>';
  // leaderboard
  const hs = [...hubs.values()].filter((h) => h.n).sort((a, b) => b.w - a.w).slice(0, 10);
  const maxW = hs[0]?.w || 1;
  const focusedHolder = document.activeElement?.closest('.lbr')?.getAttribute('data-addr');
  $('lbList').innerHTML = hs.map((h, i) => `<div class="lbr ${h.addr === HL ? 'me' : ''}" role="button" tabindex="0" aria-pressed="${h.addr === HL}" aria-label="Highlight wallet ${h.addr}, ${h.n} Pepes" data-addr="${h.addr}"><span style="color:var(--mut)">${i + 1}</span><span>${h.addr === HL ? '<b class="gold">' + short(h.addr) + '</b>' : short(h.addr)}</span><span style="color:var(--mut);text-align:right">${h.n}🐸</span><span style="text-align:right">${tw ? (h.w / tw * 100).toFixed(1) : 0}%</span><div class="bar"><i style="width:${(h.w / maxW * 100).toFixed(1)}%"></i></div></div>`).join('') || '<div style="color:var(--mut)">No Pepes active yet.</div>';
  if (focusedHolder) /** @type {HTMLElement} */ ($('lbList').querySelector(`[data-addr="${focusedHolder}"]`))?.focus({ preventScroll: true });
  $('blk').textContent = head ? `block ${head.toLocaleString('en-US')}` : '';
}
$('lbList').addEventListener('click', (e) => { const r = e.target instanceof Element ? e.target.closest('.lbr') : null; if (r instanceof HTMLElement) { HL = r.dataset.addr; lsSet('swarmHL', HL); $('hlAddr').value = HL; $('walletError').hidden = true; $('hlAddr').setAttribute('aria-invalid', 'false'); renderHud(); } });
$('lbList').addEventListener('keydown', (e) => { const r = e.target instanceof Element ? e.target.closest('.lbr') : null; if ((e.key === 'Enter' || e.key === ' ') && r instanceof HTMLElement) { e.preventDefault(); r.click(); } });
setInterval(() => { // countdown
  if (G.tw == null) return;
  if (!G.streamEnd) { $('hCount').innerHTML = '<small>no stream running</small>'; return; }
  const now = G.ts + (Date.now() - G.tsAt) / 1000; let s = Math.max(0, Math.floor(G.streamEnd - now));
  const d = Math.floor(s / 86400); s %= 86400; const h = Math.floor(s / 3600); s %= 3600; const m = Math.floor(s / 60); s %= 60;
  $('hCount').innerHTML = `${d}d ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} <small>${tsLocal(G.streamEnd)}</small>`;
}, 1000);

// ---------- render loop ----------
let coreFlash = 0, last = performance.now(), T = 0, fps = 60, tipNode = null, tipUpdated = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; if (!(mobile && motionQuery.matches)) T += dt; fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  if (mobile) { parts.length = Math.min(parts.length, motionQuery.matches ? 0 : 120); rings.length = Math.min(rings.length, motionQuery.matches ? 0 : 24); if (motionQuery.matches) floats.length = 0; }
  stepLayout(dt); fitCamera(dt);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // background
  const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
  bg.addColorStop(0, '#0a0f24'); bg.addColorStop(0.55, '#05070f'); bg.addColorStop(1, '#020208');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < (mobile ? 80 : stars.length); i++) { const s = stars[i]; const a = 0.25 + 0.35 * Math.sin(T * 0.8 + s.p) * s.z; ctx.fillStyle = `rgba(170,200,255,${Math.max(0, a) * s.z})`; const px = ((s.x * W - cam.x * cam.s * 0.05 * s.z) % W + W) % W, py = ((s.y * H - cam.y * cam.s * 0.05 * s.z) % H + H) % H; ctx.fillRect(px, py, s.z * 1.6, s.z * 1.6); }
  ctx.globalCompositeOperation = 'lighter';
  const s = cam.s;
  // hub links
  for (const h of hubs.values()) {
    const [hx, hy] = toScreen(h.x, h.y); const me = h.addr === HL;
    ctx.strokeStyle = me ? 'rgba(255,209,102,0.11)' : 'rgba(110,160,255,0.06)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W / 2 + (0 - cam.x) * s, H / 2 + (0 - cam.y) * s); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.beginPath();
    for (const n of h.members || []) { const [x, y] = toScreen(n.x, n.y); ctx.moveTo(hx, hy); ctx.lineTo(x, y); }
    ctx.strokeStyle = me ? `rgba(255,209,102,${0.10 * h.alpha})` : `rgba(120,170,255,${0.07 * h.alpha})`; ctx.stroke();
  }
  // core + distributor ring
  const [cx, cy] = toScreen(0, 0);
  coreFlash = Math.max(0, coreFlash - dt * 1.4);
  glow(cx, cy, (90 + 30 * Math.sin(T * 2)) * s + coreFlash * 60 * s, COL.core, 0.55 + coreFlash * 0.3);
  glow(cx, cy, 34 * s, [255, 235, 180], 0.9);
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(150,220,255,0.35)'; ctx.lineWidth = 1.2; ctx.setLineDash([4 * s, 7 * s]); ctx.lineDashOffset = -T * 20;
  ctx.beginPath(); ctx.arc(cx, cy, 62 * s, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
  ctx.globalCompositeOperation = 'lighter';
  // portal
  const [pwx, pwy] = portal(); const [px, py] = toScreen(pwx, pwy);
  portalFlash = Math.max(0, portalFlash - dt);
  for (let i = 0; i < 3; i++) { ctx.strokeStyle = `rgba(255,209,102,${0.25 + portalFlash * 0.4 - i * 0.06})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(px, py, 16 + i * 7 + portalFlash * 10, 34 + i * 9 + portalFlash * 14, 0, T * (1.5 + i * 0.4), T * (1.5 + i * 0.4) + 4.4); ctx.stroke(); }
  glow(px, py, 46 + portalFlash * 50, [255, 160, 60], 0.35 + portalFlash * 0.5);
  // nodes
  let hover = null; const [mx, my] = mouse;
  const nodeList = [...nodes.values()];
  for (const n of nodeList) {
    n.age += dt; n.flash = Math.max(0, n.flash - dt * 0.9); n.hit = Math.max(0, n.hit - dt * 2.5);
    const tr = RAD[n.level] * (n.exiting ? Math.max(0, 1 - n.exiting.t / n.exiting.dur) : 1);
    n.r += (tr - n.r) * Math.min(1, dt * 5);
    if (n.exiting) {
      const e = n.exiting; e.t += dt; const k = Math.min(1, e.t / e.dur), ease = k * k * (3 - 2 * k);
      const mxw = (e.sx + pwx) / 2, myw = (e.sy + pwy) / 2 - 140;
      n.x = (1 - ease) ** 2 * e.sx + 2 * (1 - ease) * ease * mxw + ease ** 2 * pwx; n.y = (1 - ease) ** 2 * e.sy + 2 * (1 - ease) * ease * myw + ease ** 2 * pwy;
      if (k >= 1) { nodes.delete(n.id); portalFlash = 1; continue; }
    }
    const [x, y] = toScreen(n.x, n.y); const r = Math.max(1.2, n.r * s);
    // Cull drawing only; every node still participates in state and layout.
    if (mobile && (x < -r * 4 || x > W + r * 4 || y < -r * 4 || y > H + r * 4)) continue;
    const c = COL[n.level] || COL[1]; const me = n.owner === HL;
    const bright = 0.45 + 0.55 * Math.min(1, Math.sqrt(n.pending / pendMax));
    glow(x, y, r * (mobile ? 2.4 + n.flash + n.hit : 3.4 + n.flash * 3 + n.hit * 1.2), c, Math.min(1, bright * 0.75 + n.flash * 0.6 + n.hit * 0.3));
    if (me) glow(x, y, r * 2.3, COL.gold, 0.35 + 0.15 * Math.sin(T * 3 + n.id));
    if (!n.exiting && x >= 0 && x <= W && y >= 0 && y <= H && r >= (mobile ? 10 : 5)) loadImages([n.id]);
    const im = imgCache.get(n.id);
    ctx.globalCompositeOperation = 'source-over';
    if (im?.sprite && r >= (mobile ? 10 : 5)) {
      ctx.drawImage(im.sprite, x - r, y - r, r * 2, r * 2);
      ctx.strokeStyle = rgba(me ? COL.gold : c, 0.9); ctx.lineWidth = Math.max(1, r * 0.16); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.stroke();
    } else { ctx.fillStyle = rgba(c, 0.95); ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, 6.283); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(x, y, r * 0.35, 0, 6.283); ctx.fill(); }
    ctx.globalCompositeOperation = 'lighter';
    if (!mobile && !dragging && Math.hypot(mx - x, my - y) < r + 4) hover = n;
  }
  // rings
  for (let i = rings.length - 1; i >= 0; i--) {
    const g = rings[i]; g.t += dt; if (g.t < 0) continue; const k = g.t / g.dur; if (k >= 1) { rings.splice(i, 1); continue; }
    const [x, y] = g.node ? toScreen(g.node.x, g.node.y) : toScreen(g.x, g.y);
    ctx.strokeStyle = rgba(g.c, (1 - k) * 0.85); ctx.lineWidth = 2.5 * (1 - k) + 0.5; ctx.beginPath(); ctx.arc(x, y, (8 + g.max * (1 - (1 - k) ** 3)) * s, 0, 6.283); ctx.stroke();
  }
  // particles
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.t += dt; if (p.t < 0) continue; const k = p.t / p.dur;
    if (k >= 1) { if (p.tgt) { p.tgt.hit = Math.min(0.8, p.tgt.hit + 0.2); } parts.splice(i, 1); continue; }
    const tx = p.tgt ? p.tgt.x : p.tx, ty = p.tgt ? p.tgt.y : p.ty;
    const e = 1 - (1 - k) ** 2.2;
    const mxw = (p.sx + tx) / 2 - (ty - p.sy) * p.bend, myw = (p.sy + ty) / 2 + (tx - p.sx) * p.bend;
    const wx = (1 - e) ** 2 * p.sx + 2 * (1 - e) * e * mxw + e * e * tx, wy = (1 - e) ** 2 * p.sy + 2 * (1 - e) * e * myw + e * e * ty;
    const [x, y] = toScreen(wx, wy);
    if (p.px != null) { ctx.strokeStyle = rgba(p.c, 0.55 * (1 - k * 0.5)); ctx.lineWidth = Math.max(1.2, 2.2 * Math.min(1.4, s)); ctx.beginPath(); const length = Math.hypot(x - p.px, y - p.py), f = mobile && length > 18 ? 18 / length : 1; ctx.moveTo(x + (p.px - x) * f, y + (p.py - y) * f); ctx.lineTo(x, y); ctx.stroke(); }
    p.px = x; p.py = y;
    glow(x, y, p.size * Math.min(1.25, Math.max(1, s)) * (1 - k * 0.35), p.c, parts.length > 500 ? 0.7 : 1);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(x - 1, y - 1, 2, 2);
  }
  // labels: hubs
  ctx.globalCompositeOperation = 'source-over';
  ctx.textAlign = 'center'; ctx.font = `600 ${mobile ? 12 : 11}px ui-monospace,Consolas,monospace`;
  for (const h of hubs.values()) {
    if (mobile && s < 1.1) continue; // Wallet labels become readable after zooming in.
    if (h.alpha < 0.05) continue; const me = h.addr === HL; if (!me && h.n < 3 && s < 1.1) continue; const [hx, hy] = toScreen(h.x, h.y);
    const ly = hy + (clusterR(h) + 14) * s;
    ctx.globalAlpha = h.alpha * (me ? 1 : 0.75);
    ctx.fillStyle = me ? '#ffd166' : '#9fb4e0'; ctx.fillText(me ? `★ ${short(h.addr)} · ${h.n} · w${h.w}` : `${short(h.addr)} · ${h.n} · w${h.w}`, hx, ly);
    ctx.globalAlpha = 1;
  }
  ctx.font = `700 ${mobile ? 12 : 10}px system-ui`; ctx.fillStyle = 'rgba(255,240,210,0.9)'; ctx.fillText('OG POOL', cx, cy + 3);
  ctx.fillStyle = 'rgba(150,220,255,0.55)'; ctx.font = `600 ${mobile ? 12 : 9}px system-ui`; ctx.fillText('DISTRIBUTOR', cx, cy - 66 * s - 4);
  ctx.fillStyle = 'rgba(255,209,102,0.75)'; ctx.fillText('AUCTION', px, py + 58);
  // floats
  ctx.font = '700 13px ui-monospace,Consolas,monospace';
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i]; f.t += dt; const k = f.t / f.dur; if (k >= 1) { floats.splice(i, 1); continue; }
    if (mobile && s < 0.8) continue; // Full event details remain in the Events tab.
    const [x, y] = toScreen(f.x, f.y); ctx.globalAlpha = 1 - k * k; ctx.fillStyle = rgba(f.c, 1); ctx.shadowColor = rgba(f.c, 0.8); ctx.shadowBlur = mobile ? 0 : 10;
    ctx.font = f.small ? `600 ${mobile ? 12 : 11}px ui-monospace,Consolas,monospace` : '700 13px ui-monospace,Consolas,monospace';
    ctx.fillText(f.txt, x, y - k * 34 * (f.y < 0 ? 1 : -1)); ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
  // tooltip
  const tip = $('tip');
  if (mobile) { hover = nodes.get(selectedId); if (hover?.exiting) { selectedId = null; hover = null; } }
  if (hover) {
    loadImages([hover.id]);
    if (!mobile || tipNode !== hover || now - tipUpdated > 250) {
    tipNode = hover; tipUpdated = now;
    const n = hover, im = imgCache.get(n.id), chainNow = G.ts ? G.ts + (Date.now() - G.tsAt) / 1000 : Date.now() / 1000, unl = n.last ? n.last + EXIT_LOCK : 0;
    const attrs = esc((meta.get(n.id) || []).map((a) => a?.value ?? '').join(' · '));
    const content = `${im?.url ? `<img alt="" src="${esc(im.url)}">` : ''}<b style="font-size:14px">Swarm Pepe #${n.id}</b><br>
      <span class="l${n.level}">L${n.level}</span> · weight ${WEIGHT[n.level]}<br>
      owner ${n.owner === HL ? '<b class="gold">' + short(n.owner) + '</b>' : short(n.owner)}<br>
      pending <b>${n.pending.toFixed(6)}</b> ETH${G.usd ? ` <span style="color:var(--mut)">${fmtUsd(n.pending * G.usd)}</span>` : ''}<br>
      + backlog share ${G.tw ? (nE(G.backlog) * WEIGHT[n.level] / Number(G.tw)).toFixed(6) : '–'}<br>
      exit ${unl ? (unl > chainNow ? 'unlocks ' + tsLocal(unl) : '<span class="l1">unlocked</span>') : '–'}
      ${attrs ? `<div class="traits" style="color:var(--mut);font-size:11px;margin-top:4px;clear:both">${attrs}</div>` : ''}`;
    if (mobile) {
      if (!tip.querySelector('#tipContent')) tip.innerHTML = '<button id="tipClose" aria-label="Close Pepe details">×</button><div id="tipContent"></div>';
      $('tipContent').innerHTML = content;
    } else tip.innerHTML = content;
    }
    tip.style.display = 'block';
    if (mobile) { tip.style.removeProperty('left'); tip.style.removeProperty('top'); }
    else {
    const tw2 = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(W - tw2 - 10, mx + 16) + 'px'; tip.style.top = Math.min(H - th - 10, my + 16) + 'px';
    cv.style.cursor = 'pointer';
    }
  } else { tip.style.display = 'none'; cv.style.cursor = ''; tipNode = null; }
  requestAnimationFrame(frame);
}
let portalFlash = 0;

// ---------- input (zoom / pan) ----------
let mouse = [-999, -999], dragging = false, dragStart = null;
cv.addEventListener('mousemove', (e) => {
  if (mobile) return;
  mouse = [e.clientX, e.clientY];
  if (dragStart) { const dx = e.clientX - dragStart[0], dy = e.clientY - dragStart[1]; if (Math.hypot(dx, dy) > 3) { dragging = true; cam.user = true; cv.classList.add('drag'); } if (dragging) { cam.x = dragStart[2] - dx / cam.s; cam.y = dragStart[3] - dy / cam.s; } }
});
cv.addEventListener('mouseleave', () => { mouse = [-999, -999]; });
cv.addEventListener('mousedown', (e) => { if (!mobile) dragStart = [e.clientX, e.clientY, cam.x, cam.y]; });
addEventListener('mouseup', () => { dragStart = null; dragging = false; cv.classList.remove('drag'); });
cv.addEventListener('wheel', (e) => {
  e.preventDefault(); cam.user = true;
  const [wx, wy] = toWorld(e.clientX, e.clientY); const f = Math.exp(-e.deltaY * 0.0015);
  cam.s = Math.min(8, Math.max(0.15, cam.s * f)); const [wx2, wy2] = toWorld(e.clientX, e.clientY); cam.x += wx - wx2; cam.y += wy - wy2;
}, { passive: false });
const fit = () => { cam.user = false; selectedId = null; };
cv.addEventListener('dblclick', () => { if (!mobile) fit(); });
$('btnFit').onclick = () => { fit(); if (mobile) setMenu(false, true); };

// Pointer capture keeps drags continuous; a pinch anchors the world under its midpoint.
const pointers = new Map();
let gesture = null, lastTap = null;
const canvasPoint = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
function startGesture(tappable = false) {
  const p = [...pointers.values()];
  if (!p.length) { gesture = null; dragging = false; cv.classList.remove('drag'); return; }
  const mid = p.length > 1 ? [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2] : p[0];
  gesture = { mid, world: toWorld(...mid), scale: cam.s, distance: p.length > 1 ? Math.max(1, Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1])) : 0, tap: tappable && p.length === 1, at: performance.now() };
  if (p.length > 1) { gesture.tap = false; lastTap = null; selectedId = null; cam.user = true; }
}
cv.addEventListener('pointerdown', (e) => {
  if (!mobile || e.button !== 0) return;
  e.preventDefault(); cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, canvasPoint(e)); startGesture(pointers.size === 1);
});
cv.addEventListener('pointermove', (e) => {
  if (!mobile || !pointers.has(e.pointerId) || !gesture) return;
  pointers.set(e.pointerId, canvasPoint(e));
  const p = [...pointers.values()], two = p.length > 1;
  const mid = two ? [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2] : p[0];
  if (two || Math.hypot(mid[0] - gesture.mid[0], mid[1] - gesture.mid[1]) > 6) gesture.tap = false;
  if (gesture.tap) return;
  selectedId = null; lastTap = null; dragging = true; cam.user = true; cv.classList.add('drag');
  if (two) cam.s = Math.min(8, Math.max(0.15, gesture.scale * Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) / gesture.distance));
  cam.x = gesture.world[0] - (mid[0] - W / 2) / cam.s; cam.y = gesture.world[1] - (mid[1] - H / 2) / cam.s;
});
function tapNode(point) {
  let nearest = null, distance = Infinity;
  for (const n of nodes.values()) {
    if (n.exiting) continue;
    const [x, y] = toScreen(n.x, n.y), d = Math.hypot(x - point[0], y - point[1]);
    if (d <= Math.max(22, n.r * cam.s + 4) && d < distance) { nearest = n; distance = d; }
  }
  selectedId = nearest?.id ?? null;
  if (nearest) { setSheet(false); setMenu(false); }
}
function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  const point = canvasPoint(e), now = performance.now();
  if (e.type === 'pointerup' && gesture?.tap && now - gesture.at < 500) {
    if (lastTap && now - lastTap.at < 300 && Math.hypot(point[0] - lastTap.point[0], point[1] - lastTap.point[1]) < 28) { fit(); lastTap = null; }
    else { tapNode(point); lastTap = { at: now, point }; }
  }
  pointers.delete(e.pointerId); startGesture(false);
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('lostpointercapture', endPointer);
function resetPointers() { pointers.clear(); gesture = null; lastTap = null; dragStart = null; dragging = false; cv.classList.remove('drag'); }
addEventListener('blur', resetPointers); addEventListener('resize', resetPointers); mobileQuery.addEventListener('change', resetPointers);
$('tip').addEventListener('click', (e) => { if (e.target instanceof Element && e.target.closest('#tipClose')) { selectedId = null; cv.focus(); } });
cv.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === '0') { e.preventDefault(); fit(); return; }
  const pan = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (pan) { e.preventDefault(); cam.user = true; cam.x += pan[0] * 40 / cam.s; cam.y += pan[1] * 40 / cam.s; }
  if (['+', '=', '-'].includes(e.key)) { e.preventDefault(); cam.user = true; cam.s = Math.min(8, Math.max(0.15, cam.s * (e.key === '-' ? 0.8 : 1.25))); }
  if (mobile && e.key.toLowerCase() === 'n') {
    e.preventDefault(); const ids = [...nodes.values()].filter((n) => !n.exiting).map((n) => n.id);
    selectedId = ids[(ids.indexOf(selectedId) + 1) % ids.length] ?? null;
    setSheet(false); setMenu(false);
  }
});
if (HL) $('hlAddr').value = HL;
$('hlAddr').addEventListener('change', () => { const v = $('hlAddr').value.trim(); const invalid = !!v && !ethers.isAddress(v); $('hlAddr').setAttribute('aria-invalid', String(invalid)); $('walletError').hidden = !invalid; $('walletError').textContent = invalid ? 'Enter a valid Ethereum wallet address, or clear the field.' : ''; if (!v) { HL = ''; lsSet('swarmHL', ''); renderHud(); } else if (!invalid) { HL = v.toLowerCase(); lsSet('swarmHL', HL); renderHud(); } });

// ---------- read-only tools ----------
const BURN = [0, 50000, 150000, 400000];
const FEE_KEY = `swarm:1:${A.DIST.toLowerCase()}:fees24:v1`;
let feeCache = { from:0, through:0, records:[] }, feeResult = null;
let feeBusy = false, feeTimer = 0, feeProgress = '', feeError = false;
let lookup = '', lookupExtra = null, lookupVersion = 0;
const ALERT_KEY = 'swarm:alerts:v1';
let alertPrefs = { enabled:false, scope:'all', ids:[], auction:true, activation:true, exit:true, swap:false, threshold:1, sound:false, notifications:false };
const alertSeen = new Set();
let audioContext = null;
function calculatorVisible() { return extrasReady && (mobile ? sheetOpen && activeTab === 3 : desktopPanel === 'calculator'); }
function openPanel(id, trigger) {
  panelTrigger = trigger;
  if (mobile) { selectTab(panelIds.indexOf(id)); $(tabIds[activeTab]).focus(); $(tabIds[activeTab]).scrollIntoView({block:'nearest',inline:'nearest'}); }
  else {
    desktopPanel = desktopPanel === id ? '' : id; setSheet(false);
    if (desktopPanel) { $(id).tabIndex = -1; $(id).focus(); }
  }
}
function closePanel() { desktopPanel = ''; setSheet(false); panelTrigger?.focus(); }
const est = (n) => !Number.isFinite(n) ? 'Unavailable' : n !== 0 && Math.abs(n) < 0.000001 ? n.toExponential(2) : n.toLocaleString('en-US', {maximumFractionDigits:6});
function priced(og) {
  if (!og) return '0 ETH · $0';
  if (!G.ogPerEth) return G.tw == null ? 'Loading...' : 'Spot price unavailable';
  const eth = og / G.ogPerEth;
  return `${est(eth)} ETH · ${G.usd ? fmtUsd(eth * G.usd) : 'USD feed unavailable'}`;
}
function renderCalculator() {
  const level = Number($('calcLevel').value), from = Number($('calcFrom').value), weight = WEIGHT[level], burn = BURN[level];
  $('calcWeight').textContent = String(weight);
  $('calcBurn').textContent = `${burn.toLocaleString('en-US')} OG`;
  $('calcCost').textContent = priced(burn);
  $('calcUpgrade').textContent = from > level ? 'Choose an equal or higher target level.' : `${(burn - BURN[from]).toLocaleString('en-US')} OG · ${priced(burn - BURN[from])}`;
  $('calcCaption').textContent = `Estimated ETH for L${level} · weight ${weight}`;
  if (G.tw == null) return;
  const tw = Number(G.tw), now = G.ts + (Date.now() - G.tsAt) / 1000;
  // Advance the known linear stream locally between the existing snapshots.
  const durationAtRead = Math.max(0, G.streamEnd - G.ts), secondsLeft = Math.max(0, G.streamEnd - now);
  const backlogLeft = durationAtRead ? nE(G.backlog) * Math.min(1, secondsLeft / durationAtRead) : 0;
  const streamHour = tw && secondsLeft ? backlogLeft / secondsLeft / tw * 3600 : 0;
  const feeHour = feeResult ? (tw ? feeResult.eth / tw / 24 : 0) : null;
  const periods = [1, 24, 720];
  const streams = periods.map(h => streamHour * weight * Math.min(h, secondsLeft / 3600));
  const fees = periods.map(h => feeHour == null ? null : feeHour * weight * h);
  const row = (id, label, values) => { $(id).innerHTML = `<th scope="row">${label}</th>` + values.map(v => `<td>${v == null ? (feeError ? 'Retrying...' : 'Loading...') : est(v)}</td>`).join(''); };
  row('calcStream','Backlog',streams); row('calcFees','Fees · 24h',fees);
  row('calcTotal','Total',streams.map((v,i) => fees[i] == null ? null : v + fees[i]));
  $('calcPerWeight').textContent = `ETH/hour per weight: backlog ${est(streamHour)} + ordinary fees ${feeHour == null ? 'still loading' : est(feeHour)}${feeHour == null ? '' : ` = ${est(streamHour + feeHour)}`}.${tw ? '' : ' No active weight; no rewards are allocated.'}`;
  const daily = feeHour == null ? null : streams[1] + fees[1];
  $('calcPayback').textContent = !G.ogPerEth ? 'Spot price unavailable.' : daily == null ? 'Loading the complete 24h fee window...' : daily > 0 ? `${est(burn / G.ogPerEth / daily)} days at the current daily rate. The backlog stream ends, so this rate may not last until payback.` : 'No finite payback at the current zero reward rate.';
  const result = feeResult ? `24h ordinary fees: ${est(feeResult.eth)} ETH. Window ending ${tsLocal(feeResult.asOf)} (UTC offset follows your browser). ` : '';
  $('feeStatus').textContent = result + (feeError ? "Can't load the complete fee window. Retrying through the shared RPC queue; use Retry above." : feeProgress || (feeResult ? 'Cached; refreshed every 5 minutes while Calculator is open.' : 'Loading... fee history is read in batches of at most 50 blocks.'));
}
async function blockTime(block) {
  const value = await requestRPC('eth_getBlockByNumber', [ethers.toQuantity(block), false]);
  const ts = Number(value?.timestamp);
  if (!Number.isSafeInteger(ts) || ts <= 0) throw new Error('Block timestamp unavailable');
  return ts;
}
function historyGuard() { if (!calculatorVisible() || isHidden() || Date.now() < retryAt) throw pauseError(); }
async function startFeeHistory() {
  if (!calculatorVisible() || isHidden() || !firstLoaded || feeBusy) return;
  clearTimeout(feeTimer);
  const wait = Math.max(retryAt - Date.now(), feeResult ? PRICE_MS - (Date.now() - feeResult.loadedAt) : 0);
  if (wait > 0) { feeTimer = window.setTimeout(startFeeHistory, wait); return; }
  feeBusy = true; feeError = false;
  try {
    const target = scanned, asOf = G.ts, cutoff = asOf - 86400;
    feeProgress = 'Loading... locating the start of the last 24 hours.'; renderCalculator();
    // Find the exact timestamp boundary. The estimate only brackets a search;
    // all boundaries are confirmed against block headers, never block-time guesses.
    let hi = target, span = 8000, lo = Math.max(0, hi - span);
    historyGuard();
    while (lo > 0 && await blockTime(lo) >= cutoff) { historyGuard(); span *= 2; lo = Math.max(0, target - span); }
    while (lo < hi) {
      historyGuard(); const mid = Math.floor((lo + hi) / 2);
      if (await blockTime(mid) < cutoff) lo = mid + 1; else hi = mid;
    }
    const start = lo;
    if (!feeCache.from || feeCache.from > start || feeCache.through < start - 1 || feeCache.through > target) feeCache = { from:start, through:start - 1, records:[] };
    feeCache.records = feeCache.records.filter(r => r.block >= start);
    feeCache.from = start;
    while (feeCache.through < target) {
      historyGuard();
      const from = feeCache.through + 1, to = Math.min(target, from + LOG_CHUNK - 1);
      const logs = await getLogsChunked({address:A.DIST,topics:[iDist.getEvent('RewardsReceived').topicHash]},from,to);
      const records = logs.map(l => ({block:l.blockNumber,idx:l.index,normal:iDist.parseLog(l).args.normal.toString()}));
      // Commit each successful chunk atomically so interruption can resume.
      feeCache.records.push(...records); feeCache.through = to;
      lsSet(FEE_KEY, JSON.stringify(feeCache));
      feeProgress = `Loading... ${Math.round((to - start + 1) / Math.max(1,target - start + 1) * 100)}% of the 24h fee window. You can keep using the map.`;
      renderCalculator();
    }
    const total = feeCache.records.reduce((sum,r) => sum + BigInt(r.normal),0n);
    feeResult = {eth:nE(total),asOf,loadedAt:Date.now()}; feeProgress = '';
  } catch (error) {
    if (String(error.message) !== 'RPC paused') { feeError = true; if (Date.now() >= retryAt) deferRPC(error); }
  } finally {
    feeBusy = false; renderCalculator();
    if (calculatorVisible() && !isHidden()) feeTimer = window.setTimeout(startFeeHistory, Math.max(1000,retryAt - Date.now(),feeResult ? PRICE_MS - (Date.now() - feeResult.loadedAt) : 0));
  }
}
function renderLookup() {
  if (!lookup) return;
  if (G.tw == null) { $('calcLookupResult').textContent = 'Loading... waiting for the current snapshot.'; return; }
  const wallet = ethers.isAddress(lookup), tw = Number(G.tw);
  const items = [...nodes.values()].filter(n => !n.exiting && (wallet ? n.owner === lookup.toLowerCase() : n.id === Number(lookup)));
  if (!wallet && !items.length && lookupExtra?.id === Number(lookup)) items.push(lookupExtra);
  if (!items.length) { $('calcLookupResult').textContent = wallet ? 'No active Pepes in this wallet. Inactive NFTs carry no active weight.' : 'No active Pepe with this ID in the current snapshot. Look up the ID to check inactive ownership.'; return; }
  const w = items.reduce((s,n) => s + WEIGHT[n.level],0), pending = items.reduce((s,n) => s + n.pending,0);
  const levels = [1,2,3].map(l => `L${l}: ${items.filter(n => n.level === l).length}`).join(' · ');
  $('calcLookupResult').textContent = `${wallet ? `${items.length} active Pepes · ${levels}` : `Pepe #${items[0].id} · ${items[0].level ? `L${items[0].level}` : 'Inactive (level 0)'} · owner ${items[0].owner}`} · Pending ${est(pending)} ETH · Weight ${w} / ${tw} (${tw ? est(w / tw * 100) : '0'}%).`;
}
async function lookupAccount(event) {
  event.preventDefault(); const v = $('calcAccount').value.trim().replace(/^#/,''), version = ++lookupVersion;
  $('calcAccount').setAttribute('aria-invalid','false'); lookupExtra = null;
  if (!v) { lookup = ''; $('calcLookupResult').textContent = 'Enter a Pepe ID or wallet to see its level, pending ETH and weight share.'; return; }
  if (!ethers.isAddress(v) && !(/^[1-9]\d*$/.test(v) && Number.isSafeInteger(Number(v)))) {
    lookup = ''; $('calcAccount').setAttribute('aria-invalid','true'); $('calcLookupResult').textContent = 'Enter a positive Pepe ID or a complete Ethereum address.'; $('calcAccount').focus(); return;
  }
  lookup = v; renderLookup();
  if (ethers.isAddress(v) || !firstLoaded) return;
  const id = Number(v), active = nodes.get(id);
  let found = active && !active.exiting ? active : null;
  if (!found) {
    $('calcLookupResult').textContent = 'Loading... checking this Pepe on Ethereum.';
    try {
      const r = await multicall([[A.SPEPE,iSpepe,'ownerOf',[id]],[A.DIST,iDist,'level',[id]],[A.DIST,iDist,'pending',[id]]],ethers.toQuantity(scanned));
      if (version !== lookupVersion) return;
      if (!r[0]) { lookup = ''; $('calcLookupResult').textContent = 'No minted Pepe found for this ID. Check the ID and try again.'; return; }
      if (r[1] == null || r[2] == null || Number(r[1]) > 3) throw new Error('Incomplete Pepe read');
      found = lookupExtra = {id,owner:r[0],level:Number(r[1]),pending:nE(r[2])};
    } catch {
      if (version === lookupVersion) { lookup = ''; $('calcLookupResult').textContent = "Can't read this Pepe. Wait for RPC recovery, then choose Look up again."; }
      return;
    }
  }
  $('calcFrom').value = String(found.level);
  if (Number($('calcLevel').value) < found.level) $('calcLevel').value = String(found.level);
  renderLookup(); renderCalculator();
}
function renderAlertWallet() {
  $('alertWallet').textContent = HL ? `Highlighted wallet: ${HL}` : 'No wallet highlighted. Use the wallet field or choose a holder.';
  $('alertIdsField').hidden = $('alertScope').value !== 'ids';
}
function notificationStatus() {
  const available = 'Notification' in window && window.isSecureContext;
  $('enableNotifications').disabled = !available;
  $('enableNotifications').textContent = alertPrefs.notifications ? 'Disable browser notifications' : 'Enable browser notifications';
  $('notificationStatus').textContent = !available ? 'Browser notifications are unavailable here. In-page alerts still work.' : Notification.permission === 'denied' ? 'Permission is blocked. Change it in browser settings; in-page alerts still work.' : alertPrefs.notifications && Notification.permission === 'granted' ? 'Browser notifications enabled for this open page.' : 'Optional. Permission is requested only when you click.';
}
function saveAlertPrefs() {
  try { localStorage.setItem(ALERT_KEY, JSON.stringify(alertPrefs)); return true; } catch { return false; }
}
function prepareSound() {
  try { audioContext ||= new AudioContext(); audioContext.resume().catch(() => {}); } catch {}
}
function playSound() {
  if (!audioContext || audioContext.state !== 'running') return;
  const oscillator = audioContext.createOscillator(), gain = audioContext.createGain(), now = audioContext.currentTime;
  oscillator.frequency.value = 660; gain.gain.setValueAtTime(0.05,now); gain.gain.exponentialRampToValueAtTime(0.001,now + .16);
  oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(now); oscillator.stop(now + .18);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
}
function saveAlerts(event) {
  event.preventDefault();
  const scope = $('alertScope').value, raw = $('alertIds').value.trim(), threshold = Number($('alertThreshold').value);
  $('alertIds').setAttribute('aria-invalid','false'); $('alertThreshold').setAttribute('aria-invalid','false');
  const ids = raw ? raw.split(',').map(x => Number(x.trim())) : [];
  if (scope === 'ids' && (!raw || ids.length > 100 || ids.some(x => !Number.isSafeInteger(x) || x <= 0))) {
    $('alertIds').setAttribute('aria-invalid','true'); $('alertStatus').textContent = 'Enter up to 100 positive Pepe IDs, separated by commas.'; $('alertIds').focus(); return;
  }
  if (!Number.isFinite(threshold) || threshold < 0 || !$('alertThreshold').value) {
    $('alertThreshold').setAttribute('aria-invalid','true'); $('alertStatus').textContent = 'Enter a swap threshold of zero or more ETH.'; $('alertThreshold').focus(); return;
  }
  alertPrefs = {...alertPrefs,enabled:$('alertEnabled').checked,scope,ids:[...new Set(ids)],threshold,sound:$('alertSound').checked,auction:$('alertAuction').checked,activation:$('alertActivation').checked,exit:$('alertExit').checked,swap:$('alertSwap').checked};
  if (alertPrefs.sound) prepareSound();
  const saved = saveAlertPrefs();
  $('alertStatus').textContent = `${saved ? 'Saved.' : 'Browser storage is unavailable; choices last for this visit.'} ${alertPrefs.enabled ? 'Alerts are on while this page is open.' : 'Alerts are off.'}${alertPrefs.enabled && scope === 'wallet' && !HL ? ' Highlight a wallet to receive matching alerts.' : ''}${alertPrefs.sound ? ' Sound is ready for this visit; after a reload, click Save alerts to enable audio again.' : ''}`;
}
function toast(message, tx = '') {
  const card = document.createElement('div'); card.className = 'toast';
  const text = document.createElement('p'); text.textContent = message; card.append(text);
  if (/^0x[0-9a-f]{64}$/i.test(tx)) { const a = document.createElement('a'); a.href = `https://etherscan.io/tx/${tx}`; a.textContent = 'View transaction ↗'; a.target = '_blank'; a.rel = 'noopener noreferrer'; card.append(a); }
  const dismiss = document.createElement('button'); dismiss.textContent = 'Dismiss'; dismiss.setAttribute('aria-label',`Dismiss alert: ${message}`); dismiss.onclick = () => { card.remove(); if (mobile) $('btnMenu').focus(); else /** @type {HTMLButtonElement} */ ($('toolNav').querySelector('button[data-open="alerts"]')).focus(); }; card.append(dismiss);
  $('toastStack').prepend(card); while ($('toastStack').children.length > 3) $('toastStack').lastElementChild.remove();
  $('toastAnnounce').textContent = message;
  if (alertPrefs.sound) playSound();
  if (alertPrefs.notifications && 'Notification' in window && Notification.permission === 'granted') {
    try { const n = new Notification('OG Swarm map', {body:message,tag:tx || message}); setTimeout(() => n.close(),15000); } catch { $('notificationStatus').textContent = 'This browser could not show a notification. In-page alerts are still on.'; }
  }
}
async function deliverAlerts(events) {
  if (!alertPrefs.enabled) return;
  for (const e of events) {
    if (!alertPrefs.enabled) break;
    const key = `${e.tx}:${e.idx}`;
    if (alertSeen.has(key)) continue;
    alertSeen.add(key); if (alertSeen.size > 2000) alertSeen.delete(alertSeen.values().next().value);
    const eligible = e.type === 'auction' ? alertPrefs.auction : e.type === 'act' || e.type === 'up' ? alertPrefs.activation : e.type === 'exit' ? alertPrefs.exit : e.type === 'swap' && alertPrefs.swap && e.eth > alertPrefs.threshold;
    if (!eligible) continue;
    if (alertPrefs.scope === 'ids' && (!('id' in e) || !alertPrefs.ids.includes(e.id))) continue;
    if (alertPrefs.scope === 'wallet') {
      if (!HL) continue;
      let owner = e.owner;
      if (e.type === 'swap') {
        try { const tx = await requestRPC('eth_getTransactionByHash',[e.tx]); owner = tx?.from?.toLowerCase(); }
        catch { $('alertStatus').textContent = 'Could not identify a swap sender. That wallet alert was skipped; live reads will retry.'; continue; }
      }
      if (owner !== HL) continue;
    }
    const message = e.type === 'auction' ? `New auction: Pepe #${e.id}, starting at ${fmtOG(e.price)} OG.` : e.type === 'act' ? `Pepe #${e.id} activated at L${e.level}.` : e.type === 'up' ? `Pepe #${e.id} upgraded from L${e.from} to L${e.level}.` : e.type === 'exit' ? `Pepe #${e.id} exited with ${est(e.eth)} ETH.` : `Big ${e.buy ? 'buy' : 'sell'}: ${est(e.eth)} ETH.`;
    toast(message,e.tx);
  }
}
function initTools() {
  try {
    const c = JSON.parse(lsGet(FEE_KEY));
    if (c && Number.isSafeInteger(c.from) && c.from > 0 && Number.isSafeInteger(c.through) && c.through >= c.from - 1 && Array.isArray(c.records) && c.records.length <= 50000 && c.records.every(r => Number.isSafeInteger(r.block) && r.block >= c.from && r.block <= c.through && Number.isSafeInteger(r.idx) && /^\d+$/.test(r.normal))) feeCache = c;
  } catch {}
  try {
    const p = JSON.parse(lsGet(ALERT_KEY));
    if (p && ['all','wallet','ids'].includes(p.scope) && Array.isArray(p.ids) && p.ids.length <= 100 && p.ids.every(id => Number.isSafeInteger(id) && id > 0) && Number.isFinite(p.threshold) && p.threshold >= 0) {
      for (const k of ['enabled','auction','activation','exit','swap','sound','notifications']) if (typeof p[k] === 'boolean') alertPrefs[k] = p[k];
      alertPrefs.scope = p.scope; alertPrefs.ids = p.ids; alertPrefs.threshold = p.threshold;
    }
  } catch {}
  document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click',() => openPanel(b.getAttribute('data-open'),b)));
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click',closePanel));
  $('calcLevel').addEventListener('change',renderCalculator); $('calcFrom').addEventListener('change',renderCalculator);
  $('calcLookup').addEventListener('submit',lookupAccount);
  $('alertScope').value = alertPrefs.scope; $('alertIds').value = alertPrefs.ids.join(', '); $('alertThreshold').value = String(alertPrefs.threshold);
  for (const [id,key] of [['alertEnabled','enabled'],['alertAuction','auction'],['alertActivation','activation'],['alertExit','exit'],['alertSwap','swap'],['alertSound','sound']]) /** @type {HTMLInputElement} */ ($(id)).checked = alertPrefs[key];
  $('alertStatus').textContent = alertPrefs.enabled ? 'Saved alerts are on while this page is open.' : 'Alerts are off. Choose what to watch, then save.';
  $('alertForm').addEventListener('submit',saveAlerts); $('alertScope').addEventListener('change',renderAlertWallet);
  $('enableNotifications').addEventListener('click',async () => {
    if (alertPrefs.notifications) alertPrefs.notifications = false;
    else { try { alertPrefs.notifications = (Notification.permission === 'granted' || await Notification.requestPermission() === 'granted'); } catch {} }
    saveAlertPrefs(); notificationStatus();
  });
  const contracts = [['OG token',A.OG],['Hook',A.HOOK],['Distributor',A.DIST],['Auction',A.AUCTION],['Swarm Pepe collection',A.SPEPE],['Pool ID',POOL_ID]];
  for (const [name,value] of contracts) {
    const row = document.createElement('div'); row.className = 'contract-row';
    row.innerHTML = `<strong>${name}</strong><code>${value}</code><button type="button" aria-label="Copy ${name}">Copy</button><a href="https://etherscan.io/address/${name === 'Pool ID' ? A.PM + '#readContract' : value}" target="_blank" rel="noopener noreferrer">${name === 'Pool ID' ? 'PoolManager on Etherscan' : name + ' on Etherscan'} ↗</a>`;
    row.querySelector('button').addEventListener('click',async () => {
      let copyTimeout; $('copyStatus').textContent = `Copying ${name}...`;
      try { await Promise.race([navigator.clipboard.writeText(value), new Promise((_, reject) => { copyTimeout = window.setTimeout(() => reject(new Error('Clipboard unavailable')), 3000); })]); $('copyStatus').textContent = `${name} copied.`; }
      catch { const selection = window.getSelection(), range = document.createRange(); range.selectNodeContents(row.querySelector('code')); selection.removeAllRanges(); selection.addRange(range); $('copyStatus').textContent = `Copy unavailable. ${name} is selected; use your browser’s Copy command.`; }
      finally { clearTimeout(copyTimeout); }
    }); $('contractList').append(row);
  }
  $('rpcRetry').addEventListener('click',() => { schedulePoll(0); if (calculatorVisible()) { if (feeResult) feeResult.loadedAt = 0; startFeeHistory(); } showRetry(); });
  setInterval(() => { if (!isHidden()) { showRetry(); if (calculatorVisible()) renderCalculator(); } },1000);
  document.addEventListener('visibilitychange',() => { if (isHidden()) clearTimeout(feeTimer); else if (calculatorVisible()) startFeeHistory(); });
  new ResizeObserver(() => { if (!mobile) document.documentElement.style.setProperty('--tools-bottom', ($('toolNav').getBoundingClientRect().bottom + 8) + 'px'); }).observe($('toolNav'));
  extrasReady = true; renderCalculator(); renderAlertWallet(); notificationStatus();
}

// ---------- live loop ----------
let liveQueue = [], pollTimer = 0, polling = false;
function schedulePoll(delay = POLL_MS) {
  clearTimeout(pollTimer);
  if (isHidden()) return;
  pollTimer = window.setTimeout(poll, Math.max(delay, retryAt - Date.now()));
}
async function poll() {
  if (polling || isHidden()) return;
  polling = true;
  try {
    // No new block means no logs, snapshot, or price read.
    const h = Number(await requestRPC('eth_blockNumber', []));
    if (!Number.isSafeInteger(h) || h <= 0) throw new Error('Invalid block number');
    if (!firstLoaded || resnapshot || h < scanned) {
      const block = ethers.toQuantity(h);
      const ids = await snapshotIds(block);
      const state = await readState(ids, block);
      head = scanned = h; liveQueue = []; commitState(state); resnapshot = false;
      if (!firstLoaded) {
        let i = 0; for (const n of nodes.values()) { n.r = 0; n.flash = 0; setTimeout(() => { n.flash = 0.8; }, 200 + i++ * 18); }
        firstLoaded = true; mode = 'live'; $('loading').style.display = 'none';
      }
    } else if (h > scanned) {
      // Bound catch-up work after a long-hidden tab to one 50-block range/tick.
      const to = Math.min(h, scanned + LOG_CHUNK), evs = await fetchEvents(scanned + 1, to);
      const ids = new Set([...nodes.values()].filter((n) => !n.exiting).map((n) => n.id));
      for (const e of evs) { if ('id' in e) { if (e.type === 'act' || e.type === 'up') ids.add(e.id); else if (e.type === 'exit') ids.delete(e.id); } }
      const state = await readState([...ids], ethers.toQuantity(to));
      // Cursor and rendered state commit together only after ALL reads succeed.
      head = scanned = to; commitState(state);
      deliverAlerts(evs);
      const spread = Math.min(POLL_MS * 0.8, Math.max(400, evs.length * 350));
      evs.forEach((e, i) => liveQueue.push({ e, at: performance.now() + (evs.length > 1 ? (i / (evs.length - 1)) * spread : 0) }));
    }
    if (firstLoaded) $('loadMsg').textContent = '';
  } catch (error) {
    if (!isHidden()) {
      if (Date.now() >= retryAt) deferRPC(error);
      if (!firstLoaded) $('loadMsg').textContent = 'Waiting for chain data. Retrying automatically…';
    }
  } finally { polling = false; schedulePoll(); scheduleImages(); if (calculatorVisible()) startFeeHistory(); }
}
setInterval(() => {
  if (isHidden()) return;
  const now = performance.now();
  while (liveQueue.length && liveQueue[0].at <= now) applyEvent(liveQueue.shift().e);
}, 50);
document.addEventListener('visibilitychange', () => {
  if (isHidden()) { clearTimeout(pollTimer); clearTimeout(imgTimer); imgTimer = 0; activeRequest?.abort(); }
  else { schedulePoll(0); scheduleImages(); }
});
addEventListener('focus', () => { if (!isHidden()) { schedulePoll(0); scheduleImages(); } });
// Read-only diagnostics, also used by development interaction checks.
window.__swarm = {
  get ready() { return firstLoaded; }, nodes: () => [...nodes.values()].filter((n) => !n.exiting).length, G: () => G, fps: () => fps,
  view: () => ({ mobile, width: W, height: H, dpr: DPR, camera: { ...cam }, particles: parts.length, rings: rings.length, selected: selectedId, mode,
    nodes: [...nodes.values()].filter((n) => !n.exiting).map((n) => ({ id: n.id, owner: n.owner, level: n.level, pending: n.pending, last: n.last, screen: toScreen(n.x, n.y), radius: n.r * cam.s })) }),
};
initTools();
requestAnimationFrame(frame);
poll();
})();
