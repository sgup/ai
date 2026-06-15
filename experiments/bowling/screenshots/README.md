# Screenshots

Visual record for the bowling × operating-instructions experiment (see [`../RESULTS.md`](../RESULTS.md)).
All captured in real Chrome 149 via headless Playwright.

## Served over HTTP — all five originals are playable

Each original build served over `http://localhost` and loaded to its interactive
aiming state. Proof that every variant works when served correctly.

| Image | What it shows |
|-------|---------------|
| `baseline-served-playable.png` | 3D lane, pins, aiming arrows, ball picker, scoreboard, control meters |
| `v1-served-playable.png` | lane, ball at the foul line, pins, power/spin meters (intro dismissed on click) |
| `v2-served-playable.png` | auto-starts; lane, full rack, hook/spin guide line, ball |
| `v3-served-playable.png` | auto-starts; lane, pins, spin/hook slider, power meter |
| `v4-served-playable.png` | auto-starts; lane, pins, New Game / View toggle, power bar |

## Opened via `file://` — broken (the real cause of every "broken" report)

Double-clicking `index.html` loads it from `file://` (origin `null`), where Chrome
blocks **all ES-module loading** by CORS. The module graph never loads, so the game
never starts. This — not any game bug — was behind every failure report; the three
`-fixed` rebuilds chased phantom causes and were deleted.

| Image | What it shows |
|-------|---------------|
| `v1-file-FAILURE-deadbutton.png` | intro card frozen; "Start Bowling" does nothing — `main.js` never ran, so its click handler was never attached |
| `baseline-file-FAILURE-stuck-loading.png` | stuck forever on the "Waxing the lane…" spinner — module never loads, so the loading overlay is never hidden |

**To play:** serve over HTTP (`cd <variant>/code && python3 -m http.server 8000`) and
open `http://localhost:8000` — never the `file://` path.
