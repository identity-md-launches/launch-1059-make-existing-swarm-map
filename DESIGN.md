# Swarm map design

## Overview

A plain HTML/JavaScript, read-only Ethereum map for OG launch #1040. The original neon canvas, owner clusters, pixel art, glass stats, holders, events and legend remain. Calculator, How it works, Alerts and Contracts use the same source elements on desktop and in the mobile sheet. There is no framework, wallet, remote font or new runtime asset.

The source of truth is the inline CSS in `index.html`, the canvas `COL` palette and tool functions in `swarm.js`. The build copies these files unchanged. The original desktop panels keep their positions; the new panels appear over the center of the map when opened.

## Colors

| Token or value | Implemented role |
| --- | --- |
| `--fg: #e8f1ff` | Primary text and controls |
| `--mut: #7d8aa6` | Existing compact HUD labels |
| `--panel-muted: #a2aec6` | New panel help, table labels and secondary values |
| `--l1: #39ff9f` | L1, live status, buy and total estimate |
| `--l2: #4cc3ff` | L2, selection and visible keyboard focus |
| `--l3: #ff5cf0` | L3 and upgrade |
| `--gold: #ffd166` | Highlighted wallet, estimate notice, auction and retry text |
| `--panel-surface: #0a0e1c` | Opaque tool, toast and navigation surfaces |
| `--mobile-surface: #0a0e1c` | Existing opaque mobile chrome |
| `--glass: rgba(10,14,28,.62)` | Original desktop glass panels |
| `--line: rgba(120,160,255,.18)` | Borders and separators |
| `#03040a` | Page background |
| `rgba(20,28,50,.8)` | Inputs and buttons |
| `#7cc8ff` | Links |
| `#ff6b6b` | Sell badge |

Keep the existing green → blue → magenta title and canvas glow palette. Levels, states and warnings also have text. The new secondary text is intentionally lighter than the compact original HUD labels. New panels are opaque, so their contrast is independent of the moving canvas. Measured pairs and unverified transparent/animated surfaces are recorded in `web/VALIDATION.md`. There is one dark theme.

## Typography

The original base is `13px/1.4 system-ui, Segoe UI, Roboto, sans-serif`; no font files are fetched. The title is 15px/700 with `.18em` tracking, or 12px with `.1em` on mobile. Existing stats use 17px/650 and tabular numbers. Events and canvas addresses use `ui-monospace, Consolas, monospace`.

New `.feature-panel` text has line-height 1.55. Its h2 is 15px, h3 is 13px, help/table text is 12px, and result values are 15px. Numbers are tabular; very small nonzero ETH amounts use scientific notation instead of rounding to zero. System font availability determines exact glyphs and synthesized weights.

Labels remain visible above editable fields. Mobile input/select text is 16px to avoid input zoom. Addresses and IDs remain selectable and wrap; contract codes use `user-select:all`. New links are underlined with a 3px offset. A definition list structures the glossary; table headers, captions and row headers describe earnings units and periods.

## Layout

The existing mobile query is `(max-width:767px), (max-width:1023px) and (max-height:500px)`. It covers portrait phones and rotated short screens. Canvas dimensions still follow the visual viewport, `100dvh`, and devicePixelRatio capped at 2. Existing drag, pinch, Fit and node selection behavior remains.

Desktop has the original left stats, right holders, bottom-right events and bottom-left legend. The new toolbar occupies the central gap and wraps on narrower desktops. A ResizeObserver measures its bottom into `--tools-bottom`. The open panel begins 8px below it, is at most 510px wide (viewport minus 32px), has 18px padding, and scrolls within the viewport with a 24px bottom margin. These are nonmodal panels with a Close button; the map stays usable.

Mobile keeps the collapsed three-value summary and expands to the existing 62% viewport / 500px limit, or 58% in landscape. The seven tabs form a horizontally scrollable row; adjacent content and the scrollbar indicate more tabs. A selected tab is scrolled into view when opened through Menu or keyboard arrows. Menu includes four tool shortcuts in a two-column grid. Panel content scrolls inside `#sheetPanels`, with 14px horizontal padding. Desktop Close buttons are hidden; collapse or Escape closes the sheet. Opening Menu, a node card or the sheet retains the existing mutual dismissal behavior.

Calculator inputs/results use two columns with 12px gaps (8px result gaps on mobile). Lookup is a flexible input plus submit button. Fieldsets use 10px padding, with 14–18px between major groups. Long wallet text explicitly wraps at 320px. Toasts sit above page content, are at most 340px wide, and stack at most three cards in a bounded scroll area. The mobile retry banner moves Menu and toasts down to keep controls reachable.

Production-export layout checks cover new tools at 320×640, 375×812, 430×932, 812×375, 768×800, 1024×768 and 1440×900. The existing interaction suite additionally covers 360×780, 412×915 and 915×412. These are Chromium viewport checks, not physical-device verification.

## Elevation & Depth

Original desktop `.glass` retains its 8px backdrop blur and faint outer/inset glow. Mobile removes blur. New panels override the glass background with the opaque panel token; they use the original border/radius vocabulary. Stacking is toolbar 12, panel 15, existing node tooltip 20, mobile top bar 30, RPC status 31, toasts 40. Toasts use `0 8px 24px #0008`. Retry and toast layers carry text in addition to color.

## Shapes

Original glass panels and toasts have 12px corners. Inputs, buttons and fieldsets use 8px. Borders are 1px; keyboard focus is a global 2px blue outline with 3px offset. The summary keeps an inset focus outline so it is not clipped by the sheet. Controls are at least 40px high in new desktop panels, 36px in the compact toolbar, and 44px on mobile. Checkboxes are 18px with full clickable labels at least 40/44px high.

## Components

- **Tool navigation:** `#toolNav`, `[data-open]`, `openPanel`, `closePanel`. Expanded state is exposed. Escape restores desktop focus to the opening button. Mobile tabs use roles, associated panels, roving tabindex, Left/Right/Home/End and visible focus.
- **Calculator:** `.form-grid`, `.result-grid`, `.estimate-table`, `renderCalculator`. Target/starting level selects update immediately. The full activation and incremental burn costs are distinct. Backlog, ordinary fees and total have hourly/daily/30-day rows. Every result is an estimate. Loading, missing price/feed, incomplete fee history, zero weight, invalid lookup, inactive Pepe and no-payback states use words, never bare dashes. The complete 24h window has an explicit ending time.
- **Glossary:** `.glossary`, native definition terms/descriptions, level names paired with map colors and a descriptive official-site link.
- **Alerts:** `#alertForm`, `.check`, native fieldsets, explicit Save. Scoped filters, minimum swap size, sound and notification opt-in persist locally. Browser permission is requested only by its button. `toast` uses safe text nodes, a polite announcement, transaction link and Dismiss; cards do not expire automatically. The visible stack retains the newest three. The ticker separately retains recent events.
- **Contracts:** `.contract-row`, a full wrapping code value, named Copy button, descriptive Etherscan link and polite copy feedback. Clipboard failure selects the value and explains manual copying. The pool links to its PoolManager because a pool ID is not an address.
- **Recovery:** `#rpcStatus`, `#rpcMessage`, `#rpcRetry`, `showRetry`. Countdown plus Retry uses the existing shared cooldown. Last successful values stay visible, explicitly marked as last available data. Initial values say Loading...; empty holders and no active rewards are explicit.

New controls change state immediately without animation. Reduced motion disables CSS blink/spinners/event entry globally. The existing mobile canvas reduced-motion behavior remains; desktop canvas motion is unchanged and is a documented limitation.

## Do's and Don'ts

Reuse `.feature-panel`, native fields, tokens and the existing sheet for another read-only tool. Extend `panelIds` and `tabIds` together; preserve their keyboard association. Keep tool content scrollable and measure toolbar height before placing desktop panels. Use the shared transport, its cooldown and existing address constants for reads.

Do not add a wallet, transaction flow, runtime dependency, tracker, remote font or alternate data model. Never substitute zero for an incomplete fee scan. Keep unit, period, window timestamp and estimate language next to financial numbers. Keep source and all five export files identical after `npm run build`.

Design review follows Jakub Krehel's Better Interface (MIT, pinned `267330e1adfc66a718fb65fa6918c1f06d0a689e`). Documentation method follows Paul Bakaus's Impeccable (Apache-2.0, pinned `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`). Notices are retained in `web/design-guidance-LICENSE.txt`.
