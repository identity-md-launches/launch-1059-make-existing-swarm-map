# Validation record — OG Swarm map tools

Worker observations on 2026-10-08. This record is not independent behavior certification.

## Scope and decisions

The production export is the existing plain HTML/JS site with Calculator, How it works, Alerts, Contracts and recoverable RPC status. It preserves the canvas and its controls, the original desktop panels, mobile sheet, RPC pacing/polling/backoff and art caching. No runtime dependency, font, wallet or tracker was added. Existing package/build/lock/ignore files remain unchanged.

The calculator uses an on-demand complete 24-hour RewardsReceived.normal window, not an extrapolation of events observed since page load. A timestamp search defines its exact block boundary. Its displayed ending time distinguishes cached history from current state. The brief's hourly backlog formula is advanced linearly between snapshots; projections stop at stream end. Payback uses the displayed daily total. Wallet lookup aggregates active NFTs; inactive IDs can be checked individually. AuctionListed was verified against the deployed ABI, and the exiting owner is correlated using token and transaction. Native pool sender addresses are not assumed to identify wallet traders.

## Commands and environment

Node 24.21.0, npm 11.19.0, existing locked TypeScript 5.9.3 and Playwright 1.64.0. Chromium was supplied by the browser tool at `/opt/imd-worker/local/imd-browser-tool/ms-playwright/chromium-1246/chrome-linux64/chrome`.

- `npm ci --prefix /tmp/swarm-check --cache /tmp/swarm-npm-cache --ignore-scripts --no-audit --no-fund`: passed using copies of the existing web manifest/lockfile. An initial attempt without the explicit cache failed because the default npm cache was read-only; nothing in the repository was installed or changed by that attempt.
- `npm run build`: passed; five complete local files copied into dist.
- `/tmp/swarm-check/node_modules/.bin/tsc --project web/tsconfig.json`: passed, JavaScript checkJs/noEmit.
- `node --check swarm.js`: passed.
- `CHROMIUM_PATH=… node --loader ./test/scratch/resolve-loader.mjs web/validate.mjs`: passed **67 checks**. The scratch resolver only maps the existing Playwright import to the temporary locked installation. The three optional earlier-source pixel comparisons were not available and were explicitly skipped, not claimed as passes.
- `CHROMIUM_PATH=… node --loader ./test/scratch/resolve-loader.mjs web/validate-tools.mjs`: passed **33 checks** after the final source change. Together with the original suite, **100 checks passed**. The same script runs normally as `node web/validate-tools.mjs` after the documented web npm install.
- `CHROMIUM_PATH=… node --loader ./test/scratch/resolve-loader.mjs web/live-check.mjs`: **passed** on the final export in a separate rerun. Blocks 26,149,052 → 26,149,054; 130 nodes; levels 34/19/77; weight 380; 41 requests; zero request failures or uncaught errors. No startup historical logs and the following live log ranges were correctly bounded. This smoke check does not open the 24h calculator.
- `git diff --check`: passed.

The original suite covered mobile touch drag/pinch/double-tap, node detail cards, wallet highlighting/clearing, tab/holder keyboard access, focus restoration, desktop restoration, and RPC behavior. It exercised startup 429 recovery and five-endpoint rotation with 15/30/60/60-second cooldowns; no startup historical logs; unchanged-block early return; 50-block catch-up; partial snapshot/cursor recovery; hidden visibility; five-minute Chainlink gating; image concurrency/cache/storage failures; and empty active population. It found no uncaught application errors or failed local resources.

New production-export checks cover exact fee-window inclusion/exclusion, excluding surplus, pool price/weights/burn differences, hourly/day/30-day values, active/wallet/inactive/invalid lookups, contracts copy and clipboard failure, glossary navigation, alert permission click timing, persistent choices, sound generation, event filters, transaction-sender matching, real auction/exit correlation, desktop Escape, seven-tab Home/End, responsive scrolling, bounded serialized reads, short/ended streams, zero fees/weight/payback, cache reload and history 429 recovery. Notification and clipboard success use API doubles; audio uses Chromium's native oscillator with an observation wrapper. The short-window fixture deliberately uses one hour per block to check timestamp boundaries quickly; production uses real block timestamps.

## Rendered inspection

The provided browser tool successfully loaded the actual export at `http://127.0.0.1:8000/dist/`. The automated scripts additionally serve it under `/preview/`. Browser screenshots were inspected, including live Calculator at 1440×900, its loading/error state at 375×812, How it works and Contracts at desktop, and Alerts at 320×640 with a visible keyboard focus ring. Tool layout checks also cover 430×932, 812×375, 768×800 and 1024×768; the original suite covers 360×780, 412×915 and 915×412.

Live inspection observed 130 active Pepes, L1/L2/L3 counts 34/19/77 and weight 380, and blocks advancing from 26,148,964 through 26,149,022. Local index, ethers, application JS and favicon loaded. PublicNode supplied current state and historical chunks, then rejected one historical log request with HTTP 403, `Archive requests require a personal token`. LlamaRPC also failed CORS. The UI displayed the timed retry message and retained the last valid snapshot. This is an observed provider limitation, not a successful live full-window calculation. The full historical formula and retry path are checked with deterministic fixtures. An initial concurrent `web/live-check.mjs` process was interrupted with exit 143 before it wrote a result; that interrupted attempt is not claimed as a pass; the later independent rerun passed as recorded above.

Evidence outputs (separate from runtime): `artifacts/interaction-results.json`, `artifacts/tools-results.json`, `artifacts/live-results.json`, `artifacts/live-contracts-desktop.png`, `artifacts/live-glossary-desktop.png`, `artifacts/live-alerts-focus-320.png`, `artifacts/live-calculator-loading-desktop.png`, `artifacts/tools-calculator-mobile.png`, and `artifacts/tools-contracts-{375,1440}.png`. The older root screenshot is not evidence of this upgrade. The live loading screenshot precedes the measured-toolbar placement correction; final glossary/contract screenshots and automated geometry checks cover that correction.

## Better Interface coverage

All six pinned core guides and the workflow/documentation sections were read. The intended neon design and plain JS stack remain authoritative.

| Domain | Coverage and evidence | Unperformed or inapplicable |
| --- | --- | --- |
| Accessibility — Checked | Native labeled form controls, fieldsets, table headers, status regions, named copy/dismiss actions, roving tabs, Escape/focus return. Viewed the 2px blue focus ring in the real 320px Alerts panel. Checkbox labels provide the touch target. Reduced-motion CSS and original mobile canvas behavior checked. | No screen-reader session, full automated accessibility audit, forced-colors check, OS text scaling or physical-device test. Existing desktop animated canvas remains unchanged. |
| Layout — Checked | All four tools fit and their ends remain reachable at the tested widths; desktop toolbar height is measured before positioning its panel. Full addresses and short landscape layouts checked. | No browser-native 200% zoom or RTL mirror; English-only UI. No claim that viewport resizing equals native zoom. |
| Writing — Checked | Persistent labels, full-unit estimates, explicit incomplete/window timestamp, positive validation instructions, no bare-dash initial statistics, timed retry with action. Read-only/notification/page-open limits visible. | No translation or editorial user study. |
| Typography — Checked | Existing system fonts preserved; new 12–15px dense-tool roles, 16px mobile inputs, 1.55 panel line height, tabular values, address wrapping and table units. | Exact font weight availability differs by OS; no font-download claim. OS text scaling untested. |
| Colors — Checked | Existing named neon roles preserved with textual level/state cues. Opaque panel secondary text measured **8.6098:1** (`#a2aec6` / `#0a0e1c`). Retry text measured **13.3311:1** (`#ffd166` / `#0a0e1c`). | Full animated-canvas and transparent desktop contrast not measured. No light theme exists. Notice alpha-background and every possible focus-background pair were not independently measured. |
| UI — Checked | Loading, populated, empty, invalid, cached, retry and recovered states; clear selection, native inputs, persistent dismissible toasts, copy fallback. No animation added to new controls. | Notification delivery in real OS UI, physical audio output, background throttling on actual mobile OS and 10%-speed animation inspection unverified. |

## Findings, fixes and rechecks

1. **Medium — layout/typography, `index.html:136`.** At 320px the highlighted wallet made `#alerts` scrollWidth 314px inside a 302px panel. Reproduced with the browser and interaction check. Added `overflow-wrap:anywhere` to panel paragraphs. Browser recheck gave 302/302px; the full address remains visible over multiple lines.
2. **Medium — layout, `index.html:132`, `swarm.js:1064`.** A fixed desktop panel offset could cover wrapped toolbar buttons on a narrow desktop. Replaced the offset with measured `--tools-bottom` via ResizeObserver. At 768×800, toolbar bottom was 217px and panel top 225px. Subsequent 768/1024/1440 tool navigation/scrolling checks passed.
3. **Medium — accessibility/recovery, `index.html:124,199`, `swarm.js:50`.** Focus styling was originally mobile-only, and the old retry status offered no countdown or action. Added a global focus rule, a clear countdown with Retry, and mobile clearance. The original rate-limit suite passed cooldown/rotation/recovery and menu clearance at 320px and landscape.
4. **High — calculation consistency, `swarm.js:858`.** With less than one day of stream remaining, uncapped daily payback would disagree with the capped earnings row. Payback now divides by the displayed daily stream plus ordinary fee value. Short-stream fixture checks the equal capped horizon values and the corresponding payback.
5. **Medium — UI, `swarm.js:1055`.** Native clipboard access can remain pending when browser permission is blocked. Added immediate Copying feedback and a bounded three-second fallback to selecting the full value with manual-copy instructions. Success and rejection paths are exercised by the clipboard API double; native OS clipboard success is not claimed.

During test development, two assertions were corrected to account for display rounding and asynchronously queued transaction-sender reads, and the short-stream assertion was corrected for actual elapsed vesting during the test. These were test assumptions, not hidden product failures. Intermediate interrupted test processes are not counted as successful final runs.

## Delivery limits

No hosting/publishing tool is exposed. The export is prepared for the existing `og-swarm-map` label; no new IPFS CID, publication or ENS update is asserted. No on-chain action took place. Git metadata is outside the authorized edit paths, so submission/committing is left to the contributor pipeline.

Public RPC restrictions can prevent completion of the 24h window; anonymous access is not guaranteed. Same-height reorgs are not detected. Wallet swap attribution uses transaction sender and does not reconstruct smart-account/relayer intent. Alerts pause with hidden tabs, do not run after close and do not replay old history on reload. Full screen-reader/native-device/OS notification validation remains unperformed.

## Final local result and packaging

Local implementation and required build/typecheck/interaction/design review are complete. Publication remains incomplete because no publishing capability is available in this worker. All 100 deterministic checks passed (67 existing behavior checks plus 33 new tool checks), with no uncaught application errors or failed local resources in their successful final runs. The final build and JavaScript typecheck passed after the last source change.

A submission-candidate audit found 27 files, 2,851,995 raw bytes and a 1,931,179-byte compressed tar, before the small final documentation update. Separate evidence at that audit was 3,809,003 bytes; the conservative raw source/export plus evidence total was 6,660,998 bytes, below 8,388,608. Final exact packaging numbers are in `artifacts/packaging-results.json`. All five source/export file pairs match byte for byte. No existing build configuration, manifests, lockfiles, ignore rules, protected files or submodules changed. No dependency/cache/archive directory is in the candidate submission. Temporary browser-tool traces were removed after copying the selected evidence images.
