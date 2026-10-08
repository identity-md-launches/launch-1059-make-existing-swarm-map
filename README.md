# OG · Swarm map

A read-only, plain HTML/JavaScript map for OG launch #1040 on Ethereum mainnet. The original neon canvas, desktop stats/holders/events, mobile sheet, batched state reads and image cache remain. No wallet connection, signing, transactions, trackers, remote fonts or new runtime dependencies.

## Use the site

- **Map:** drag to pan, scroll/pinch to zoom, double-click/double-tap or Fit to reset. Hover a node on desktop or tap it on a phone. Highlight a wallet through the field, a holder, or `?addr=0x…`; the choice persists locally.
- **Calculator:** choose target and starting levels. See weight, cumulative burn, the incremental upgrade burn, ETH/USD cost at pool spot price, backlog/ordinary fee/total estimates by hour, day and 30 days, and simple payback. Look up a Pepe ID or wallet for level, pending ETH and weight share. A specific active Pepe fills its starting level. A wallet summarizes its active Pepes by level.
- **How it works:** plain-language glossary, map colors and the official OG site link.
- **Alerts:** choose all events, the highlighted wallet, or specific Pepe IDs; select listings, activations/upgrades, exits and/or swaps above an ETH threshold. Click **Save alerts**. In-page toasts are enabled separately from optional browser notifications and sound. Notification permission is requested only by the explicit button. Choices persist in localStorage; storage denial is reported and choices still work for the current visit.
- **Contracts:** copy the five contract addresses or pool ID, or open their Etherscan links. A pool ID is not an address, so its link opens the PoolManager. Clipboard failure selects the full value for manual copying.

Desktop tool buttons open a scrollable panel above the map. On mobile, **Menu** opens the same tools, and the sheet has Stats / Holders / Events / Calculator / How it works / Alerts / Contracts tabs. Swipe the tab row to reach more tabs. Keyboard Left/Right/Home/End switches tabs; Escape closes the sheet/menu or desktop tool and restores focus. Canvas arrows pan, +/− zoom, Enter/0 fits; on mobile, N selects the next Pepe. All new controls have visible focus.

**Alerts only work while the page is open.** The existing visibility behavior pauses all reads when hidden and catches up on return; this is not background push or a monitoring service. Reload starts from current state and does not replay past alerts. Toasts stay until dismissed or displaced by three newer alerts. Sound uses a locally generated Web Audio tone; after reload, click Save alerts to unlock audio again. Browser/OS notification and audio policies still apply.

Wallet swap alerts inspect the transaction sender because the pool's sender is often a router. Smart accounts, relayers and third-party execution may not identify the end trader. Pepe-ID filters exclude swaps, which carry no Pepe ID. Auction listings are matched to the exiting owner using the same transaction and token ID. Alerts use confirmed successful read cycles; failed sender lookups are explicitly reported as skipped.

## Calculator data and assumptions

Every output is labelled **estimate, not a promise**. L1/L2/L3 weights are 1/2/4; cumulative OG burns are 50,000/150,000/400,000. Upgrade burn is target cumulative burn minus the starting level's cumulative burn. Targets below the starting level do not imply a downgrade. Activation payback uses the full target activation cost.

- Activation ETH cost = cumulative OG burn / pool OG per ETH. USD uses the existing Chainlink ETH/USD value. These are spot valuations, excluding gas and slippage.
- Backlog ETH/hour/weight = `backlogLeft / (streamEnd - now) / totalWeight * 3600`. Between snapshots the remaining backlog advances linearly from the last block's values. Projected backlog earnings stop at the existing stream end. A new schedule can change them.
- Ordinary ETH/hour/weight = sum of `RewardsReceived.normal` in the complete last 24h event window / total weight / 24. Surplus is excluded. Multiply each rate by the chosen level's weight and period; add the two sources for the total.
- Payback days = activation ETH cost / displayed total ETH per day. Zero reward rate has no finite payback. The estimate changes with volume, price and total weight and does not establish that the current rate will continue until payback.

The fee window loads **on opening Calculator**, not at startup. A timestamp binary search locates the exact 24h block boundary. Only RewardsReceived logs are scanned, in at most 50-block ranges through the existing serialized, paced RPC transport. Completed chunks are cached under `swarm:1:<distributor>:fees24:v1` and reused after interruption/reload. Partial scans never become a zero-volume estimate. A complete window shows its ending time and refreshes every five minutes while Calculator is visible. Closing it or hiding the page pauses further history work. The first full scan can take several minutes or longer under provider restrictions. This is bounded fee analysis, with no launch replay, historical map reconstruction or historical alerts.

The scan requires historical log access for the full 24h. Some listed public providers restrict this, require an account, reject CORS, or rate-limit requests. The UI keeps the incomplete state and retries; it does not invent data. The pre-existing `?rpc=https://your-node.example` override can use a compatible endpoint, replacing the rotation list. Never put a private key in a URL or in this site.

## Install, preview and rebuild

Use Node.js 20+. The runtime and production build need **no installation**. The existing ethers 6.13.4 UMD file is local; root `package.json` and build configuration are unchanged.

```bash
npm run build
python3 -m http.server 8000 --directory dist
# Open http://127.0.0.1:8000/
```

`build.mjs` copies five files unchanged: `index.html`, `swarm.js`, `ethers.umd.min.js`, `favicon.svg`, `screenshot.png`. All runtime asset URLs are relative. Serve the entire export over HTTP(S), including when using a gateway subpath. No backend, route rewrites or service worker is needed.

Development checks use the existing locked dependencies in `web/`:

```bash
npm ci --prefix web --ignore-scripts --no-audit --no-fund
npm --prefix web run typecheck
(cd web && npx playwright install chromium)
npm --prefix web run validate
node web/validate-tools.mjs
node web/live-check.mjs
```

Set `CHROMIUM_PATH` to an installed Chromium if necessary. Typecheck uses TypeScript `allowJs`, `checkJs`, `noEmit`, with the existing ethers UMD boundary typed as `any`. Each validation script owns and closes its local preview server and browser. They serve the actual `dist/` under `/preview/`. RPC fixtures and API test doubles are development-only; nothing test-specific is imported by the production site. Validation writes reports/screenshots under `artifacts/`.

In this restricted worker, the existing `web/package.json` and lockfile were copied to `/tmp/swarm-check`; `npm ci --prefix /tmp/swarm-check --cache /tmp/swarm-npm-cache --ignore-scripts --no-audit --no-fund` installed the exact locked dev tools outside the repository. A temporary module resolver in `test/scratch/` let the same scripts use that installation. No package manifests, lockfiles, ignore rules or existing build configuration were changed.

## Publish under the same label

Publish the **contents of `dist/`** through the existing IdentityMD static-site publisher using label **`og-swarm-map`**. Its existing name is `og-swarm-map.site.identitymd.eth`, at [the Swarm map gateway](https://og-swarm-map.site.identitymd.eth.limo). Pin the complete directory to IPFS and update that existing name through the authorized publisher; do not create another label or deploy a contract. The publisher serves the supplied export without rebuilding it.

This worker supplies the rebuilt source/export for that label. **No publishing capability was exposed in this session, so no new CID or ENS contenthash update is claimed.** The prior CID recorded by the project input is `bafybeifpa5kvi7luc4txkvxo2ixvy3k3gkh3jo5sgf435g5xcrlv63626u`; it is not a CID for this upgrade.

Submit the source, existing lockfile, documentation, development checks and all five `dist/` files. Do not submit node_modules, caches, browser downloads, package archives or scratch scaffolding. The existing ignore rule already covers nested node_modules; it was not changed. This task does not edit Git metadata or create a submodule.

## Preserved RPC behavior

Startup discovers active IDs from the NFT's `totalMinted()` and distributor levels in bounded Multicalls of at most 2,000 IDs, then reads the complete active state in one atomic Multicall. All state is pinned to the same block. The contract has no enumerable active-ID view, so that preflight remains necessary. No logs are requested at startup.

The original nonoverlapping loop checks `eth_blockNumber` every 15 seconds after completion and skips work on an unchanged head. New logs cover at most 50 blocks per cycle. AuctionListed is added to the existing distributor filter as a second address/topic, preserving two live log requests per cycle (distributor/auction and pool). The snapshot and cursor only commit after both filters and required state reads succeed. Lookup of an inactive Pepe uses one on-demand Multicall. Wallet big-swap alerts add an on-demand transaction-sender read.

All producers share one HTTP queue, at least 350ms between requests, public endpoint rotation and exponential 15/30/60-second cooldown. Hidden tabs abort/pause work. Retry respects the current cooldown. The existing five-minute Chainlink gating and visible-art cache remain; at most four tokenURI subcalls share an image batch, and only local inline image data renders. New fee-cache and alert-preference keys do not replace the image or highlighted-wallet caches.

Current snapshots and fee cache do not detect same-height reorganizations. Public providers cannot guarantee availability. A window's displayed timestamp matters: previous complete history can remain visible during refresh/retry. This map has no authority over funds.

## Validation and design review

The final production build and JavaScript typecheck passed. The original interaction suite passed **67 checks**, and the new tools suite passed **33 checks** (100 total). A separate live RPC smoke check also passed: 130 active Pepes, weight 380, and a successful new-block refresh with no failed requests. The submission audit is below 8 MiB, including separate evidence conservatively. Actual commands, fixes, evidence and limitations for this assignment are recorded in [web/VALIDATION.md](web/VALIDATION.md). [DESIGN.md](DESIGN.md) describes the final tokens, typography, components, focus and responsive behavior. All six pinned Better Interface domains were reviewed, with browser inspection of the production export and corrections to observed findings. These are worker observations, not independent certification.

Source contracts were checked against their verified [distributor](https://sourcify.dev/server/v2/contract/1/0xd450ea80aeC46B8bFfdf0C4F44d3964489B613f2?fields=abi,sources), [auction](https://sourcify.dev/server/v2/contract/1/0xb0d2d2Cfe7A1b14d1f34135C3C7a8d152c4262e9?fields=abi,sources) and [hook](https://sourcify.dev/server/v2/contract/1/0x22fded8abce0d93979ebb2a04cfc37c110abe0cc?fields=abi,sources) ABIs/source. All runtime addresses remain the constants already in `swarm.js`.

## Files and license

`index.html` contains styles and controls; `swarm.js` contains canvas and read-only data/tools. The existing local asset files and `dist/` form the static site. `web/` contains locked development checks and the validation record. `artifacts/` contains separate evidence outputs; test fixtures and screenshots are not runtime dependencies. The existing root screenshot is retained from the prior version and is not evidence of the new panels.

MIT; see [LICENSE](LICENSE). This is an unofficial community visualizer. Better Interface and Impeccable design-guidance attribution and licenses are retained in [web/design-guidance-LICENSE.txt](web/design-guidance-LICENSE.txt).
