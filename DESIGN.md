# Swarm map design

## Overview

This is the existing read-only OG launch #1040 canvas visualizer. Preserve its dark star field, additive neon nodes, pixel-art Pepes, glass panels, compact numbers and system fonts. Nodes remain the active contract population; performance settings affect drawing and transient effects, never the data set. Runtime source is `index.html` and `swarm.js`, with the existing local ethers UMD asset.

Desktop retains the original top bar, left stats, right holders, bottom-right events and bottom-left legend. The phone layout discloses those same elements through a bottom sheet so the map remains usable. It introduces no alternate data model or framework.

## Colors

Canonical CSS tokens are in `index.html:9`; canvas colors are `COL` in `swarm.js`.

| Token/value | Role |
| --- | --- |
| `--fg: #e8f1ff` | Main text and controls |
| `--mut: #7d8aa6` | Labels, timestamps, secondary values |
| `--l1: #39ff9f` | Level 1, live indicator, buys |
| `--l2: #4cc3ff` | Level 2, activations, selected tabs and focus |
| `--l3: #ff5cf0` | Level 3, upgrades |
| `--gold: #ffd166` | Highlighted wallet, backing emphasis, auction, field error |
| `--glass: rgba(10,14,28,.62)` | Original desktop glass surface |
| `--line: rgba(120,160,255,.18)` | Borders and separators |
| `--mobile-surface: #0a0e1c` | Opaque phone panels, keeping blur off and contrast stable |
| `#03040a` | Page background |
| `rgba(20,28,50,.8)` | Field/button fill |
| `#7cc8ff` | Links |
| `#ff6b6b` | Sell badge |

The title retains the original green → blue → magenta gradient. The canvas retains its radial `#0a0f24` → `#05070f` → `#020208` background. Status also has text; level colors are paired with L1/L2/L3 and weights in the legend. The new retry note has an opaque background so its contrast can be measured independently of the canvas. Current measurements and their scope are recorded in `artifacts/validation.md`; animated canvas and transparent desktop contrast remain unverified.

## Typography

`html, body` use `13px/1.4 system-ui, Segoe UI, Roboto, sans-serif`. There are no downloaded fonts. Events and canvas wallet labels use `ui-monospace, Consolas, monospace`. Actual glyph/weight rendering depends on the installed system font.

The original desktop title is 15px, weight 700, tracking `.18em`; phone title is 12px with `.1em`. Stats values remain 17px/650, with tabular numbers. Phone summaries use 13px/650 with tabular numbers, labels use 12px, and all phone UI/canvas text is at least 12px. The editable wallet field uses 16px on phones to avoid automatic iOS input zoom. Desktop's original smaller labels remain unchanged.

Long event rows wrap in the phone sheet. Card traits and large summary values can wrap. Wallet addresses retain the existing shortened presentation; holder buttons expose the full address in their accessible name. Menu fields have persistent labels. Fixed-width truncation is not used for phone event details.

## Layout

The query is `(max-width:767px), (max-width:1023px) and (max-height:500px)` in both CSS and JS. The second branch supports 812×375 and 915×412 landscape phones. At 1024px and above no mobile layout/performance branch applies. Tall tablets between 768 and 1023px retain the existing layout.

Phone canvas starts with `100dvh`; `resize()` measures `visualViewport.width/height/offsetLeft/offsetTop`, with window dimensions as fallback. Canvas backing pixels are rounded CSS dimensions × devicePixelRatio, capped at 2. Window resize, orientation change, and visual viewport resize/scroll update it. The page stays fixed; only panels/menu/card scroll. Only the canvas has `touch-action:none`; the viewport metadata does not disable user zoom elsewhere.

Phone chrome uses 8px minimum edges, enlarged by the corresponding `env(safe-area-inset-*)`. The top bar is 52px high with 6px control gaps. The collapsed sheet is normally 60px including its border. Its three summary columns show contract active Pepes, total weight and backing in ETH; the fourth holds the disclosure chevron. Expanded height is bounded by 62% of the visible viewport / 500px, or 58% in short landscape. Tabs remain above the scrollable content. Fit uses measured top/sheet bounds to keep the swarm in the available space.

The controls menu begins 60px below the top safe-area edge and scrolls within the space above the collapsed sheet. A node card sits 8px above that sheet, with bounded height and scrolling in short landscape. Opening the sheet dismisses a node card/menu; opening the menu collapses the sheet; selecting a node collapses the sheet. The legend lives at the end of Stats on phones and returns to its original body position on desktop.

Interaction-tested dimensions: 375×812, 812×375, 412×915, 915×412, 360×780, 430×932, 320×640; desktop 1024×768, 1280×720, 1440×900. Physical browser chrome and notch behavior are not yet device-verified.

## Elevation & Depth

Desktop `.glass` keeps its original 8px backdrop blur, faint 30px outer glow and 20px inset glow. Phone surfaces remove backdrop filtering, use the same dark hue opaquely, and reduce the outer glow to 16px. The phone menu has `0 8px 24px rgba(0,0,0,.4)`. Stacking order is canvas, sheet at 10, node card at 20, top/menu at 30. Sheet panels use their parent's surface instead of stacked glass effects.

Mobile `glowSprite` uses 64px cached sprites rather than 128px. Particle count is capped at 120, rings at 24, stars at 80, and each particle's single-frame trail segment at 18 CSS px. Node glow radius is reduced and floating-text shadow blur is disabled. On-canvas Pepe images appear at a projected radius of 10px (desktop 5px); wallet labels appear at scale 1.1 and event floats at scale .8. Offscreen drawing is culled after lifecycle updates. All nodes continue to update and remain selectable. Reduced-motion preference on phones removes particles, rings, floats, blinking and continuous decorative spin; live data and required layout updates continue.

## Shapes

Keep `.glass` and phone surfaces at 12px radius; controls use 8px. The summary's inset disclosure surface is 11px. Holder rows use 7px and badges 4px. Nodes, status indicators and portal shapes remain circular/elliptical. Phone node-card art is 44×44px with the existing pixel rendering and 1px border; desktop art remains 56px.

## Components

- **Top controls (`#top`, `#controls`)**: original controls on desktop; title, LIVE status and Menu on phones. Wallet highlight and Fit live in the disclosed menu. Escape closes it and returns focus. Empty wallet clears highlighting; invalid text gets a nearby correction message. No transaction action exists.
- **Details sheet (`#sheet`)**: native disclosure button with `aria-expanded`; Stats/Holders/Events form a roving-tabindex tablist. Left/Right/Home/End switch tabs, Tab reaches the panel, Escape collapses and returns focus. Content is the existing HUD DOM, not a copy. Closed/inactive content is hidden from focus and accessibility navigation.
- **Holders (`.lbr`)**: same visual grid; phone rows at least 48px high. Click, Enter or Space highlights the wallet, and `aria-pressed` identifies the selection. A HUD update restores keyboard focus to the same holder.
- **Node card (`#tip`)**: desktop hover presentation is preserved; phone taps select the nearest node within at least a 22px radius and show its existing details above the sheet. Empty-space tap, close button, Escape or a new drag dismisses it. Card DOM updates are limited to four per second. Tiny adjacent map nodes use nearest-node selection rather than overlapping separate DOM targets.
- **Map (`#c`)**: one pointer pans, two pointers zoom about their moving midpoint, double-tap fits. Capture/cancellation and resize clear gestures. Keyboard arrows pan, plus/minus zoom, Enter/0 fits; N cycles mobile node details. Desktop mouse/wheel/double-click behavior remains.
- **Focus and target states**: visible phone focus is a 2px `--l2` outline with 3px offset, inset on the summary to avoid clipping. Phone buttons, fields and event links have 44px minimum targets. Existing hover and selected colors remain. Mobile sheet/menu disclosure is immediate, without a new animation system.

- **RPC status (`#rpcStatus`)**: a stable polite live region, empty and invisible in normal operation. Failures show “RPC busy, retrying” or “RPC unavailable, retrying”. The compact note uses 12px system text, `--gold`, an opaque `#0a0e1c` surface, 8px radius, 4px/8px padding and z-index 31. It sits centered below the top bar (desktop top 64px; mobile visual-viewport/safe-area top plus 56px), with no new animation and no pointer interception. While this note is visible, mobile menus and detail cards reserve another 28px above their content so the message cannot cover their text. Previous data remains usable while retrying.
- **Initial loading / empty events**: existing loading ring and centered text; transient failures explain automatic retry. Events initially says “New events appear here while you watch.” and is replaced by the first event. Empty holders retains “No Pepes active yet.”. No demo population is substituted on failure.

The data path loads a current snapshot, then only new logs. Art loads on demand when it can be drawn, or when node details open. Successful art is cached locally by token ID. This changes network scheduling without changing node colors, dimensions or placement. The top bar has no replay controls, selector or progress UI.

## Do's and Don'ts

Reuse the existing color meanings, system typography, `.glass` and compact value/label pairs. Keep data loading and contract calculations independent of viewport state. For another compact read-only surface, start with these tokens and semantic native controls; apply phone disclosure only where content cannot fit, rather than copying this map's absolute panel coordinates.

Keep the responsive query identical in HTML CSS and JS. Measure fixed chrome when changing its size. Preserve 44px phone controls, 16px inputs, safe areas and scroll access to the end of a panel. Do not add runtime dependencies, external font/image hosts, wallet controls, analytics, sampled node populations or mobile effects that alter desktop rendering.

Design review used the pinned Better Interface guide, adapted from Jakub Krehel's Better Interface (MIT, `267330e1adfc66a718fb65fa6918c1f06d0a689e`). This documentation follows the supplied adaptation of Paul Bakaus's Impeccable document guide (Apache-2.0, `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`).
