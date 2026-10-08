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
const DEPLOY_BLOCK = 26147432, LOG_CHUNK = 5000, POLL_MS = 12000, EXIT_LOCK = 86400;
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
const iPM = new ethers.Interface(['event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)']);
const iSpepe = new ethers.Interface(['function ownerOf(uint256) view returns (address)', 'function tokenURI(uint256) view returns (string)']);
const iMC = new ethers.Interface([
  'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[])',
  'function getEthBalance(address) view returns (uint256)', 'function getCurrentBlockTimestamp() view returns (uint256)',
]);
const iSV = new ethers.Interface(['function getSlot0(bytes32) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)']);
const iCL = new ethers.Interface(['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)']);
const DIST_TOPICS = ['Activated', 'Upgraded', 'Exited', 'RewardsReceived'].map((n) => iDist.getEvent(n).topicHash);
const SWAP_TOPIC = iPM.getEvent('Swap').topicHash;

// ---------- rpc ----------
let rp = null;
async function getRP() {
  if (rp) return rp;
  for (const url of RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(url, 1, { staticNetwork: ethers.Network.from(1), batchMaxCount: 1 });
      await Promise.race([p.getBlockNumber(), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 6000))]);
      rp = p; return rp;
    } catch (e) { console.warn('RPC failed', url, e?.message); }
  }
  throw new Error('No public RPC reachable');
}
async function rpcSwap() { const cur = rp?._getConnection?.().url; rp = null; const i = RPCS.indexOf(cur); if (i >= 0 && RPCS.length > 1) RPCS.push(RPCS.splice(i, 1)[0]); return getRP(); }
async function multicall(calls, chunkSize = 300) {
  let p = await getRP(); const out = [];
  for (let i = 0; i < calls.length; i += chunkSize) {
    const chunk = calls.slice(i, i + chunkSize);
    const data = iMC.encodeFunctionData('aggregate3', [chunk.map(([t, f, fn, a]) => ({ target: t, allowFailure: true, callData: f.encodeFunctionData(fn, a) }))]);
    let raw; try { raw = await p.call({ to: A.MULTICALL, data }); } catch { p = await rpcSwap(); raw = await p.call({ to: A.MULTICALL, data }); }
    const [res] = iMC.decodeFunctionResult('aggregate3', raw);
    res.forEach((r, j) => { const [, f, fn] = chunk[j]; if (!r.success) return out.push(null); try { const d = f.decodeFunctionResult(fn, r.returnData); out.push(d.length === 1 ? d[0] : d); } catch { out.push(null); } });
  }
  return out;
}
async function getLogsChunked(filter, from, to) {
  let p = await getRP(); const all = [];
  for (let a = from; a <= to; a += LOG_CHUNK) {
    const q = { ...filter, fromBlock: a, toBlock: Math.min(to, a + LOG_CHUNK - 1) };
    let logs; try { logs = await p.getLogs(q); } catch { p = await rpcSwap(); logs = await p.getLogs(q); }
    all.push(...logs);
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
const events = [];         // all decoded events (for replay), sorted
const pendingByTx = new Map();
let G = {}, head = 0, scanned = DEPLOY_BLOCK - 1, mode = 'loading', firstLoaded = false;
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
const panelIds = ['stats', 'lb', 'tick'], tabIds = ['tabStats', 'tabHolders', 'tabEvents'];
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
function updateReplayLabel() {
  $('btnReplay').textContent = mode === 'replay' ? (mobile ? '■ Stop' : '■ Stop replay') : (mobile ? '▶ Replay' : '▶ Replay from launch');
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
  $('sheetToggle').setAttribute('aria-label', (sheetOpen ? 'Collapse' : 'Expand') + ' Stats, Holders and Events');
  $('sheetChevron').textContent = sheetOpen ? '⌄' : '⌃';
  $('sheetBody').hidden = mobile && !sheetOpen;
  if (sheetOpen) { selectedId = null; setMenu(false); }
  panelIds.forEach((id, i) => {
    $(id).hidden = mobile && i !== activeTab;
    if (mobile) { $(id).setAttribute('role', 'tabpanel'); $(id).setAttribute('aria-labelledby', tabIds[i]); $(id).tabIndex = 0; }
    else { $(id).removeAttribute('role'); $(id).removeAttribute('aria-labelledby'); $(id).removeAttribute('tabindex'); }
  });
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
  mobile = mobileQuery.matches;
  if (mobile) $('stats').append($('legend')); else legendHome.after($('legend'));
  selectedId = null; $('tip').style.display = 'none';
  setMenu(false); setSheet(false); updateReplayLabel(); resize(); measureChrome(); renderHud();
}
$('btnMenu').addEventListener('click', () => setMenu(!menuOpen));
$('sheetToggle').addEventListener('click', () => setSheet(!sheetOpen));
tabIds.forEach((id, i) => {
  $(id).addEventListener('click', () => selectTab(i));
  $(id).addEventListener('keydown', (e) => {
    const next = e.key === 'ArrowRight' ? (i + 1) % 3 : e.key === 'ArrowLeft' ? (i + 2) % 3 : e.key === 'Home' ? 0 : e.key === 'End' ? 2 : -1;
    if (next < 0) return; e.preventDefault(); selectTab(next); $(tabIds[next]).focus();
  });
});
document.addEventListener('keydown', (e) => {
  if (!mobile || e.key !== 'Escape') return;
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
  if (!opts.quiet) loadImages([id]);
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
  const N = Math.round(Math.min(mode === 'replay' ? 70 : 220, Math.max(mode === 'replay' ? 14 : 28, 30 + Math.sqrt(ethAmt * 1e4) * 14)));
  if (parts.length > (mode === 'replay' ? 500 : 1600)) return;
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
  if (parts.length > (mode === 'replay' ? 500 : 1600)) return;
  const n = Math.min(mobile ? Math.min(10, 120 - parts.length) : mode === 'replay' ? 16 : 40, 6 + Math.round(ethAmt * 60));
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
  const [d, s] = await Promise.all([
    getLogsChunked({ address: A.DIST, topics: [DIST_TOPICS] }, from, to),
    getLogsChunked({ address: A.PM, topics: [SWAP_TOPIC, POOL_ID] }, from, to),
  ]);
  return [...d, ...s].map(decodeLog).filter(Boolean).sort((a, b) => a.block - b.block || a.idx - b.idx);
}
// apply an event to the visual state. animate=false for silent state building.
function applyEvent(e, animate = true) {
  if (e.type === 'act') addNode(e.id, e.owner, e.level, { quiet: !animate });
  else if (e.type === 'up') { if (animate) upgradeNode(e.id, e.level, e.owner); else { const n = nodes.get(e.id); if (n) n.level = e.level; else addNode(e.id, e.owner, e.level, { quiet: true }); } }
  else if (e.type === 'exit') { if (animate) exitNode(e.id); else nodes.delete(e.id); }
  else if (e.type === 'swap') { if (animate) { corePulse(e.eth, e.buy); if (e.buy) inbound(e.eth); } if (e.sqrtP) { const s = Number(e.sqrtP) / 2 ** 96; G.ogPerEth = s * s; } }
  else if (e.type === 'rew') { if (animate) setTimeout(() => streamToNodes(e.eth), mode === 'replay' ? 120 : 380); }
  if (animate) pushTicker(e);
}
// ---------- ticker ----------
const tickRows = [];
function pushTicker(e, hist = false) {
  if (e.type === 'rew') { // merge into the swap row of the same tx
    const row = tickRows.find((r) => r.tx === e.tx && r.el);
    if (row) { const s = row.el.querySelector('.rw'); if (s) s.textContent = ` · ${e.eth < 0.0001 ? e.eth.toExponential(1) : e.eth.toFixed(5)} → Pepes`; }
    return;
  }
  const el = document.createElement('div'); el.className = 'ev';
  const t = `<span class="t">${mode === 'replay' || hist ? '#' + e.block : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>`;
  let body = '';
  if (e.type === 'swap' && e.agg) body = `<span class="tag ${e.buy ? 'buy' : 'sell'}">${e.agg}× SWAPS</span>${txLink(e.tx, `buys ${e.buyEth.toFixed(3)} · sells ${e.sellEth.toFixed(3)} ETH`)}<span class="rw" style="color:var(--gold)"></span>`;
  else if (e.type === 'swap') body = `<span class="tag ${e.buy ? 'buy' : 'sell'}">${e.buy ? 'BUY' : 'SELL'}</span>${txLink(e.tx, `${e.eth.toFixed(4)} ETH ${e.buy ? '→' : '←'} ${fmtOG(e.og)} OG`)}<span class="rw" style="color:var(--gold)"></span>`;
  else if (e.type === 'act') body = `<span class="tag act">ACTIVATE</span>${txLink(e.tx, `#${e.id} → L${e.level}`)} <span style="color:var(--mut)">${e.owner === HL ? '<b class="gold">you</b>' : short(e.owner)}</span>`;
  else if (e.type === 'up') body = `<span class="tag up">UPGRADE</span>${txLink(e.tx, `#${e.id} L${e.from}→L${e.level}`)} <span style="color:var(--mut)">${e.owner === HL ? '<b class="gold">you</b>' : short(e.owner)}</span>`;
  else if (e.type === 'exit') body = `<span class="tag exit">EXIT</span>${txLink(e.tx, `#${e.id} paid ${e.eth.toFixed(5)} ETH`)} <span style="color:var(--mut)">→ auction</span>`;
  el.innerHTML = t + body;
  const list = $('tickList'); list.prepend(el); tickRows.unshift({ tx: e.tx, el });
  while (list.children.length > 14) list.lastChild.remove();
  if (tickRows.length > 40) tickRows.length = 40;
}

// ---------- chain state ----------
async function refreshState() {
  const ids = [...nodes.keys()].filter((id) => !nodes.get(id).exiting);
  const n = ids.length;
  const r = await multicall([
    ...ids.map((id) => [A.SPEPE, iSpepe, 'ownerOf', [id]]), ...ids.map((id) => [A.DIST, iDist, 'pending', [id]]),
    ...ids.map((id) => [A.DIST, iDist, 'lastActivation', [id]]), ...ids.map((id) => [A.DIST, iDist, 'level', [id]]),
    [A.DIST, iDist, 'totalWeight', []], [A.DIST, iDist, 'activePerLevel', [1]], [A.DIST, iDist, 'activePerLevel', [2]], [A.DIST, iDist, 'activePerLevel', [3]],
    [A.DIST, iDist, 'backlogLeft', []], [A.DIST, iDist, 'streamEnd', []], [A.DIST, iDist, 'unfundedFees', []], [A.MULTICALL, iMC, 'getEthBalance', [A.DIST]],
    [A.STATEVIEW, iSV, 'getSlot0', [POOL_ID]], [A.CL, iCL, 'latestRoundData', []], [A.MULTICALL, iMC, 'getCurrentBlockTimestamp', []],
  ]);
  let sumPend = 0n; pendMax = 1e-9; let changed = false;
  ids.forEach((id, i) => {
    const nd = nodes.get(id); if (!nd) return;
    const own = (r[i] || nd.owner).toLowerCase(); if (own !== nd.owner && own !== A.AUCTION.toLowerCase()) { nd.owner = own; changed = true; }
    const p = r[n + i] ?? 0n; sumPend += p; nd.pending = nE(p); pendMax = Math.max(pendMax, nd.pending);
    nd.last = Number(r[2 * n + i] ?? 0);
    const lv = Number(r[3 * n + i] ?? nd.level); if (lv && lv !== nd.level && mode !== 'replay') { nd.level = lv; changed = true; }
  });
  if (changed) relayout();
  const t = r.slice(4 * n);
  G = { ...G, tw: t[0], apl: [t[1], t[2], t[3]].map((x) => Number(x ?? 0)), backlog: t[4] ?? 0n, streamEnd: Number(t[5] ?? 0), unfunded: t[6] ?? 0n, bal: t[7], sumPend, ts: Number(t[10] ?? Date.now() / 1000), tsAt: Date.now() };
  if (t[8]) { const s = Number(t[8][0]) / 2 ** 96; G.ogPerEth = s * s; }
  if (t[9] && t[9][1] > 0n) G.usd = Number(t[9][1]) / 1e8;
  renderHud();
}
// ---------- images (on-chain SVG in tokenURI) ----------
const imgQueue = new Set(); let imgBusy = false;
function loadImages(ids) { ids.forEach((id) => { if (!imgCache.has(id)) imgQueue.add(id); }); if (!imgBusy) pumpImages(); }
async function pumpImages() {
  imgBusy = true;
  try {
    while (imgQueue.size) {
      const batch = [...imgQueue].slice(0, 25); batch.forEach((id) => imgQueue.delete(id));
      const r = await multicall(batch.map((id) => [A.SPEPE, iSpepe, 'tokenURI', [id]]), 25);
      batch.forEach((id, i) => {
        const uri = r[i]; if (!uri) { imgCache.set(id, { failed: true }); return; }
        try {
          let j; if (uri.startsWith('data:application/json;base64,')) j = JSON.parse(atob(uri.slice(29))); else if (uri.startsWith('data:application/json')) j = JSON.parse(decodeURIComponent(uri.slice(uri.indexOf(',') + 1))); else { imgCache.set(id, { failed: true }); return; }
          meta.set(id, j.attributes || []);
          if (!j.image || !j.image.startsWith('data:')) { imgCache.set(id, { failed: true }); return; } // only inline images, never a remote fetch
          const img = new Image(); const ent = { img, url: j.image }; imgCache.set(id, ent);
          img.onload = () => { const s = document.createElement('canvas'); s.width = s.height = 64; const g = s.getContext('2d'); g.imageSmoothingEnabled = false; g.beginPath(); g.arc(32, 32, 32, 0, 6.283); g.clip(); g.drawImage(img, 0, 0, 64, 64); ent.sprite = s; };
          img.src = j.image;
        } catch { imgCache.set(id, { failed: true }); }
      });
    }
  } catch (e) { console.warn('images', e?.message); }
  imgBusy = false;
}

// ---------- HUD ----------
function renderHud() {
  if (G.tw == null) return;
  const tw = Number(G.tw), active = G.apl.reduce((a, b) => a + b, 0);
  const back = G.sumPend + G.backlog;
  $('mActive').textContent = active.toLocaleString('en-US') + (nodes.size !== active && mode === 'live' ? ' · syncing' : '');
  $('mWeight').textContent = tw.toLocaleString('en-US');
  $('mBack').textContent = fE(back, 4);
  $('hActive').innerHTML = `${active} <small>${nodes.size !== active && mode === 'live' ? '(syncing)' : ''}</small>`;
  $('hLevels').innerHTML = `<span class="l1">${G.apl[0]}</span> / <span class="l2">${G.apl[1]}</span> / <span class="l3">${G.apl[2]}</span>`;
  $('hWeight').textContent = tw.toLocaleString('en-US');
  const epw = tw ? nE(back) / tw : 0;
  $('hEpw').innerHTML = `${epw.toFixed(5)} <small>ETH${G.usd ? ' · ' + fmtUsd(epw * G.usd) : ''}</small>`;
  $('hBack').innerHTML = `${fE(back, 4)} <small>ETH = ${fE(G.sumPend, 3)} + ${fE(G.backlog, 3)}${G.usd ? '<br>≈ ' + fmtUsd(nE(back) * G.usd) : ''}</small>`;
  if (G.ogPerEth) $('hPrice').innerHTML = `${Math.round(G.ogPerEth).toLocaleString('en-US')} <small>OG / ETH${G.usd ? '<br>1M OG ≈ ' + fmtUsd(1e6 / G.ogPerEth * G.usd) : ''}</small>`;
  if (G.usd) $('hUsd').textContent = fmtUsd(G.usd);
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

// ---------- live loop ----------
let liveQueue = [];
async function poll() {
  if (mode !== 'live') return;
  try {
    const p = await getRP(); const h = await p.getBlockNumber();
    if (h > scanned) {
      const evs = await fetchEvents(scanned + 1, h); scanned = h; head = h;
      events.push(...evs);
      // spread the new events over the next poll window so bursts stay readable
      const spread = Math.min(POLL_MS * 0.8, Math.max(400, evs.length * 350));
      evs.forEach((e, i) => liveQueue.push({ e, at: performance.now() + (evs.length > 1 ? (i / (evs.length - 1)) * spread : 0) }));
    }
    await refreshState();
  } catch (e) { console.warn('poll failed', e?.message); }
}
setInterval(() => { // drain scheduled live events
  const now = performance.now();
  while (liveQueue.length && liveQueue[0].at <= now && mode === 'live') applyEvent(liveQueue.shift().e, true);
  if (liveQueue.length && liveQueue.length % 7 === 0) renderHud();
}, 50);

// ---------- replay ----------
let rp_ = null;
function startReplay() {
  if (mode === 'replay') return stopReplay();
  if (!events.length) return;
  mode = 'replay'; liveQueue = [];
  nodes.clear(); hubs.clear(); parts.length = 0; rings.length = 0; floats.length = 0; $('tickList').innerHTML = ''; tickRows.length = 0;
  const dur = Number($('rpSpeed').value) * 1000;
  const b0 = DEPLOY_BLOCK, b1 = Math.max(head, events[events.length - 1].block);
  rp_ = { t0: performance.now(), dur, b0, b1, i: 0 };
  $('mode').innerHTML = '<span class="dot rp"></span>REPLAY'; $('btnReplay').textContent = '■ Stop replay'; $('btnReplay').classList.add('on');
  updateReplayLabel(); selectedId = null;
  $('rpBar').style.display = 'block'; $('rpLbl').style.display = 'block';
}
function stopReplay(finished) {
  mode = 'live'; rp_ = null;
  $('mode').innerHTML = '<span class="dot"></span>LIVE'; $('btnReplay').textContent = '▶ Replay from launch'; $('btnReplay').classList.remove('on');
  updateReplayLabel(); selectedId = null;
  $('rpBar').style.display = 'none'; $('rpLbl').style.display = 'none';
  // rebuild exact current state from the full event list, then resync with the chain
  nodes.clear(); hubs.clear();
  for (const e of events) if (e.type === 'act' || e.type === 'up' || e.type === 'exit') applyEvent(e, false);
  relayout(); refreshState().catch(() => {});
  if (!finished) { $('tickList').innerHTML = ''; tickRows.length = 0; events.filter((e) => e.type !== 'rew').slice(-12).forEach((e) => pushTicker(e, true)); }
}
setInterval(() => {
  if (mode !== 'replay' || !rp_) return;
  const k = Math.min(1, (performance.now() - rp_.t0) / rp_.dur), blk = rp_.b0 + (rp_.b1 - rp_.b0) * k;
  const acc = rp_.acc || (rp_.acc = { swaps: 0, buyEth: 0, sellEth: 0, og: 0, last: null, rew: 0, fired: 0 });
  while (rp_.i < events.length && events[rp_.i].block <= blk) {
    const e = events[rp_.i++];
    if (e.type === 'swap') { acc.swaps++; if (e.buy) acc.buyEth += e.eth; else acc.sellEth += e.eth; acc.og += e.buy ? e.og : -e.og; acc.last = e; if (e.sqrtP) { const s = Number(e.sqrtP) / 2 ** 96; G.ogPerEth = s * s; } }
    else if (e.type === 'rew') acc.rew += e.eth;
    else applyEvent(e, true);
  }
  // swaps are aggregated and shown at most every 450ms so a busy stretch does not white out the screen
  const nowMs = performance.now();
  if (acc.last && (nowMs - acc.fired > 450 || k >= 1)) {
    const buy = acc.buyEth >= acc.sellEth, eth = buy ? acc.buyEth : acc.sellEth;
    corePulse(eth, buy); if (acc.buyEth > 0) inbound(acc.buyEth);
    pushTicker(acc.swaps > 1 ? { ...acc.last, eth, buy, agg: acc.swaps, buyEth: acc.buyEth, sellEth: acc.sellEth } : acc.last);
    if (acc.rew > 0) { const r = acc.rew; setTimeout(() => streamToNodes(r), 150); }
    Object.assign(acc, { swaps: 0, buyEth: 0, sellEth: 0, og: 0, last: null, rew: 0, fired: nowMs });
  }
  /** @type {HTMLElement} */ ($('rpBar').firstElementChild).style.width = (k * 100).toFixed(1) + '%';
  $('rpLbl').textContent = `block ${Math.floor(blk).toLocaleString('en-US')} · ${nodes.size} Pepes`;
  if (k >= 1) stopReplay(true);
}, 120);
$('btnReplay').onclick = startReplay;
if (params.get('replay')) setTimeout(startReplay, 1500);

// ---------- boot ----------
async function boot() {
  requestAnimationFrame(frame);
  try {
    $('loadMsg').textContent = 'reading the chain…';
    const p = await getRP(); head = await p.getBlockNumber();
    $('loadMsg').textContent = `scanning events since block ${DEPLOY_BLOCK.toLocaleString('en-US')}…`;
    const evs = await fetchEvents(DEPLOY_BLOCK, head); scanned = head; events.push(...evs);
    for (const e of evs) if (e.type === 'act' || e.type === 'up' || e.type === 'exit') applyEvent(e, false);
    // stagger an intro: every node pops in from its hub
    let i = 0; for (const n of nodes.values()) { n.r = 0; n.flash = 0; setTimeout(() => { n.flash = 0.8; }, 200 + i++ * 18); }
    relayout();
    for (const e of evs) if (e.type === 'swap' && e.sqrtP) { const s = Number(e.sqrtP) / 2 ** 96; G.ogPerEth = s * s; }
    evs.filter((e) => e.type !== 'rew').slice(-12).forEach((e) => pushTicker(e, true));
    await refreshState();
    loadImages([...nodes.keys()]);
    mode = mode === 'replay' ? 'replay' : 'live'; firstLoaded = true;
    $('loading').style.display = 'none';
    window.__swarm = { ready: true, nodes: () => [...nodes.values()].filter((n) => !n.exiting).length, G: () => G, events: () => events.length, fps: () => fps,
      view: () => ({ mobile, width: W, height: H, dpr: DPR, camera: { ...cam }, particles: parts.length, rings: rings.length, selected: selectedId, mode,
        nodes: [...nodes.values()].filter((n) => !n.exiting).map((n) => ({ id: n.id, screen: toScreen(n.x, n.y), radius: n.r * cam.s })) }),
      demo: () => { const s = [...events].reverse().find((e) => e.type === 'swap' && e.buy); const r = events.find((e) => e.type === 'rew' && e.tx === s?.tx); if (s) { corePulse(s.eth, true); inbound(s.eth); streamToNodes(r ? r.eth : s.eth * 0.025); } } };
    setInterval(poll, POLL_MS);
  } catch (e) { console.error(e); $('loadMsg').textContent = 'failed to load: ' + (e?.message || e); }
}
boot();
})();
