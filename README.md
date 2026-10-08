# OG · Swarm map

A plain HTML/JavaScript, read-only visualizer for OG launch #1040 and its Swarm Pepe distributor on Ethereum mainnet. No wallet, signing, transactions, analytics, remote fonts, or image hosts. The existing canvas, neon colors, desktop panels and mobile sheet are retained.

![Live Swarm map](screenshot.png)

## Use the map

Nodes are active Pepes, clustered by owner. Green L1, blue L2 and magenta L3 carry weights 1, 2 and 4. Brighter nodes have more pending ETH. New swaps pulse from the pool; activations, upgrades, rewards and exits appear in the ticker. Hover a node on desktop or tap it on a phone for details.

- Desktop: drag to pan, scroll to zoom, double-click or **Fit** to reset.
- Mobile: drag, pinch, double-tap to fit; tap empty space or close the card to dismiss details. Expand the bottom summary for **Stats / Holders / Events**. **Menu** contains wallet highlighting and Fit.
- Keyboard: arrows pan, +/− zoom, Enter/0 fits. On mobile layout, N selects the next Pepe. Arrow keys switch sheet tabs; Enter/Space selects a holder; Escape closes overlays and returns focus.
- Highlight an address using the field, a holder row, or `?addr=0x…`. Clear the field to remove the highlight. The choice stays in localStorage.

Launch replay, its speed selector, progress UI and URL behavior are removed. The ticker starts empty and shows new events while the page is open.

## Install, preview, rebuild

Use Node.js 20+ (this worker used Node 24.21.0, npm 11.19.0). Runtime and build require no installation: ethers 6.13.4 is already bundled locally. Existing manifests, lockfile and build configuration are unchanged.

```bash
npm run build
python3 -m http.server 8000 --directory dist
# Open http://127.0.0.1:8000/
```

`build.mjs` copies five complete files into `dist/`: `index.html`, `swarm.js`, `ethers.umd.min.js`, `favicon.svg`, and `screenshot.png`. Use HTTP(S), not `file://`. All runtime asset URLs are relative; the export works under a static subpath without routing rewrites or a backend.

Development checks use the existing locked dependencies in `web/`:

```bash
npm ci --prefix web --ignore-scripts --no-audit --no-fund
npm --prefix web run typecheck
(cd web && npx playwright install chromium)
npm --prefix web run validate
node web/live-check.mjs
```

The production JavaScript is checked with TypeScript `allowJs`, `checkJs`, `noEmit`; the ethers UMD boundary remains `any`. Validation serves the actual export under `/preview/`, launches Chromium and closes both browser and server within the command. `validate` uses deterministic RPC fixtures for touch/keyboard/layout and failure scenarios; the separate live check requires public RPC connectivity. Set `CHROMIUM_PATH` to use an existing browser, or `PLAYWRIGHT_BROWSERS_PATH` for a custom Playwright installation. Linux also needs Chromium's system libraries and fonts.

Results and screenshots are written under `artifacts/`. The optional prior-version static HUD comparison runs only when `test/scratch/baseline/{index.html,swarm.js}` exists; later checkouts report a skip. Test fixtures never enter `dist/` or the live site. No vendored package registry is needed.

## Publish

Publish the **contents of `dist/`** together to the static host, or pin that directory to IPFS. The publisher serves the supplied export and does not rebuild. The existing name is `og-swarm-map.site.identitymd.eth`, accessible at `https://og-swarm-map.site.identitymd.eth.limo`. Update its contenthash only through the existing authorized publishing workflow. This assignment prepares the next export; it does not publish a CID, modify ENS, or deploy contracts.

Keep source, the existing `web/package.json` / `web/package-lock.json`, `DESIGN.md`, validation code and all five `dist/` files in the submission. Do not include dependencies, browser downloads, package caches or archives. The existing ignore rule already excludes `node_modules/` at every depth; no ignore file was changed.

## RPC behavior

**Startup:** read `eth_blockNumber`, then pin all discovery and state reads to that block. The deployed distributor exposes `level(id)` but **has no enumerable active-ID view**. The NFT's verified mint code assigns IDs from 1 through `totalMinted()`, with a maximum of 5,000. Therefore startup first reads that count and discovers nonzero levels in bounded Multicalls of at most 2,000 IDs. It then builds the authoritative active state in **one Multicall3 batch**: owners, levels, pending ETH, last activation, totals, backlog, balance, pool price and initial Chainlink price.

This necessary discovery preflight means startup is not literally a single total RPC/Multicall request. An attempted single batch covering every minted token's fields produced a 2.27 MB JSON calldata string and was rejected by the public RPC's request-size limit. At the live population checked here, the implemented path used four HTTP requests before images: block number, supply, one level discovery batch, and one active-state batch. There is no historical `getLogs` request, deploy-block constant, indexer, or hardcoded active-token list. Contract evidence: [verified distributor ABI/source](https://sourcify.dev/server/v2/contract/1/0xd450ea80aeC46B8bFfdf0C4F44d3964489B613f2?fields=abi,compilation,sources), [verified NFT ABI/source](https://sourcify.dev/server/v2/contract/1/0x999ce0CE8C5f7661e0c74a568FfE27CEB9177bDB?fields=abi,compilation,sources).

**Live updates:** one non-overlapping polling cycle, scheduled 15 seconds after completion. `eth_blockNumber` goes first; an unchanged block causes no log, state or price reads. For new blocks, fetch distributor and pool logs for the next range, at most 50 blocks inclusive per request. One range is processed per cycle, bounding catch-up after a long-hidden tab. Read one active-state Multicall at the range's end, including owners so NFT transfers also update the map. Only commit the cursor after both log filters and the entire required snapshot succeed. The counts and weighted population must match distributor totals. Missing subcalls preserve the previous state; a population mismatch or a backward head triggers a new view snapshot. Visual event effects cannot overwrite newer node data.

**Rate limits:** a shared transport serializes HTTP requests and leaves at least 350ms between them. HTTP 429 and JSON-RPC rate-limit/quota errors show **RPC busy, retrying** in a small polite HUD status. Failed requests rotate to the next existing endpoint and impose a global exponential cooldown of 15, 30, then 60 seconds maximum. Generic failures also recover automatically. Data remains visible during retries. There are no hidden provider probes or provider-managed immediate retries.

**Background tabs:** `document.visibilityState` stops polling and image work while hidden, aborts an in-flight request and clears timers. Returning to visibility/focus resumes with a block-number check, respecting any cooldown.

**Art:** only visible nodes large enough to draw art, or opened node details, request `tokenURI`. At most four tokenURI subcalls run together in one Multicall; only one HTTP request runs at a time. Successful inline metadata/images are cached by chain, collection and token ID in localStorage and reused after reload. Storage failures fall back to memory; invalid metadata is deferred for a minute. No external image URLs are fetched. To refresh cached art after an NFT reveal, clear this site's `swarm:1:…:image:` storage entries.

**ETH/USD:** Chainlink is included at most once per five minutes, and only when a new block requires a state read. Failed attempts also wait five minutes. The last valid value remains visible.

The existing public list is PublicNode, LlamaRPC, Ankr, drpc and Cloudflare. `?rpc=https://your-node.example` preserves the existing custom endpoint override; it replaces the list, so rotation is unavailable in that mode. No keys are stored. Provider limits, availability and CORS vary; a free endpoint cannot guarantee continuous service. Very large future active populations may exceed a provider's limit for the single state batch. Long absences catch up gradually; reload starts a fresh current snapshot. Same-height chain reorganizations are not detected by block-number-only polling.

## Contracts (Ethereum mainnet)

| | Address |
|---|---|
| OG token | [`0xce7eb1ad9e2e1c784ea05f7ea4a0fe625923d10a`](https://etherscan.io/address/0xce7eb1ad9e2e1c784ea05f7ea4a0fe625923d10a) |
| OGHook (Uniswap v4 hook) | [`0x22fded8abce0d93979ebb2a04cfc37c110abe0cc`](https://etherscan.io/address/0x22fded8abce0d93979ebb2a04cfc37c110abe0cc) |
| OGDistributor | [`0xd450ea80aeC46B8bFfdf0C4F44d3964489B613f2`](https://etherscan.io/address/0xd450ea80aeC46B8bFfdf0C4F44d3964489B613f2) |
| OGAuction | [`0xb0d2d2Cfe7A1b14d1f34135C3C7a8d152c4262e9`](https://etherscan.io/address/0xb0d2d2Cfe7A1b14d1f34135C3C7a8d152c4262e9) |
| Swarm Pepe NFT | [`0x999ce0CE8C5f7661e0c74a568FfE27CEB9177bDB`](https://etherscan.io/address/0x999ce0CE8C5f7661e0c74a568FfE27CEB9177bDB) |
| Uniswap v4 PoolManager | [`0x000000000004444c5dc75cB358380D2e3dE08A90`](https://etherscan.io/address/0x000000000004444c5dc75cB358380D2e3dE08A90) |
| OG/ETH pool id | `0x5f95e64cf8e8f4e4376c1d97b5959dc479abf7b191ba0b286faeb2ec4180a2f9` |

Read-only helpers: Multicall3 `0xcA11…CA11`, v4 StateView `0x7fFE…7227`, Chainlink ETH/USD `0x5f4e…8419`.

### Values and permissions

`activePerLevel(1..3)` and `totalWeight()` define population and weights. `pending(id)` includes already vested stream rewards. Total backing is the sum of active `pending` plus `backlogLeft()`; a Pepe's displayed backlog share is `backlog × weight / totalWeight`, assuming weights stay unchanged. Owners come from the NFT's `ownerOf`. All state fields in a refresh use the same block.

The app has no permissions over funds: only public `eth_call`, `eth_blockNumber` and `eth_getLogs` are used. Calling the payable Multicall ABI through `eth_call` is simulated; no transaction or ETH is sent. Existing activation/burn/exit/auction flows remain contract-owned. Frontend invariants are complete active population, matching level counts/weight, atomic snapshot/cursor updates, and no fabricated values on failed required reads.

## Validation

On 2026-10-08, production build, JavaScript syntax check, TypeScript check and `git diff --check` passed. The final Chromium interaction run passed **69 checks** with no uncaught application errors or failed primary UI resources. It covered 320–430px portrait, 812×375 / 915×412 landscape, desktop restoration, touch gestures, keyboard/focus, sheet tabs, highlighting and Fit, plus HTTP/JSON rate limits, hidden visibility, range/cursor recovery, partial Multicalls, image cache/concurrency/storage denial and five-minute price gating. Static desktop panels matched the prior source at 1024, 1280 and 1440px after excluding the intentionally changed top controls and normalizing the empty ticker.

`node web/live-check.mjs` also passed: blocks **26,148,755 → 26,148,757**, **126** active nodes, level counts **34 / 16 / 76**, weight **370**, zero startup log requests and no failed requests. Subsequent logs began after the snapshot block. Root `screenshot.png` is from this live run.

Better Interface's six domains were reviewed against the final source/export: accessibility (status semantics, keyboard and targets), layout (responsive panels and retry-note clearance), writing (recoverable errors and empty ticker), typography (retained system fonts and 12px note), colors (retry note measured **13.33:1** against its opaque background), and UI (loading, live, busy, recovered, empty and cached-image states). A retry-note/menu overlap was corrected in `index.html:116`; partial snapshot/cursor handling was corrected in `swarm.js:435,797`; eager images were replaced in `swarm.js:503`. The authoritative state still needs the explicitly documented discovery preflight above.

Remaining limits: no physical-device, screen-reader, native 200% zoom, OS text scaling, forced-colors or full animated-canvas contrast verification; no guarantee of anonymous availability across all public providers. Chromium's supplied MCP launcher lacked Chrome, so the worker used the existing locked Playwright package with Chromium installed under `/tmp`. Deterministic visibility/clock emulation is not a native OS background-tab test. The code remains JavaScript with a non-strict `checkJs` boundary. Forge, Slither and Aderyn were located but not run: this is a frontend-only repository, with no Foundry or contract change.

Detailed worker evidence, source findings and all six domains' coverage/limitations are in [artifacts/validation.md](artifacts/validation.md), `interaction-results.json` and `live-results.json`. The workspace excludes `artifacts/` from Git; these are separate evidence outputs, and this README retains the results in the source submission. `DESIGN.md` records the implemented design. These checks are worker observations, not independent behavior certification. Fixture screenshots are labeled separately from live-chain screenshots.

Packaging check: 24 candidate files, approximately **2.74 MB raw / 1.89 MB compressed**. Including separate evidence conservatively totals **5.22 MB raw**, below the **8 MiB** limit. All five export files match source bytes. No build/dependency/lockfile/ignore changes, generated dependencies, caches, archives or submodules are included.

## Files

- `index.html`, `swarm.js`: styles, controls, canvas and read-only data flow.
- `ethers.umd.min.js`, `favicon.svg`, `screenshot.png`: complete local assets.
- `dist/`: production static export.
- `web/`: existing locked validation dependencies and development-only checks.
- `DESIGN.md`, `artifacts/validation.md`: design and validation record.

## License

MIT; see [LICENSE](LICENSE). Unofficial community visualizer. Public chain values may lag or be unavailable.
