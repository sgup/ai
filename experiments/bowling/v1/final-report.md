# v1 — final report (agent's verbatim closing message)

> Operating instructions injected: **Fable5.md @ v1** (e85e2d6 — instructional forcing-functions; 7 gap-clauses restored). Model: Opus 4.8. agentId: `a77d7d9c55d99641f`.

---

All test scaffolding removed; only the game files remain in the output location. The game is built and verified.

## Honesty block

**Verified (ran or read the real artifact):**
- All 3 CDN URLs (three@0.160.0 module + addons, cannon-es@0.20.0 ESM) return HTTP 200.
- Scoring engine: 15/15 unit tests pass (gutter=0, all-ones=20, perfect game=300, strike/spare bonuses, all-nines-spares=191, 10th-frame triple strike & spare bonus, X/`/`/`-`/digit symbols, running totals).
- All 7 JS modules parse (`node --check`).
- Found and fixed a real init-crash bug via headless Chrome (puppeteer-core): `resetPins()` read `this.pins` before assignment. After fix, the game initializes with **0 page errors**.
- Full ball lifecycle in a real browser: AIMING → throw (15 m/s) → ROLLING → SETTLING → SCORING → AIMING, ball travels the lane, pins fall (10→6 standing), 4 pins recorded in frame 1, ball/frame advance correctly.
- Screenshots confirm: intro overlay, aiming view, mid-roll, and impact (pins scattering/toppling on the pin deck).

**Assumed (reasoned, not exhaustively confirmed):**
- A complete 10-frame game plays through to the game-over overlay without edge-case bugs — verified one ball and the state machine's transitions, plus the scoring engine handles all frames in isolation, but did not script all 20+ rolls through the live UI.
- Hook/spin produces a visually satisfying curve at the chosen `spin*14` magnitude; physics tuning is playable but feel is subjective.
- On a real GPU (not SwiftShader), shadows/clearcoat render as intended and frame rate is smooth.

**Couldn't verify:** Behavior across all browsers (tested Chrome only) and actual mouse-drag feel (invoked `_throw` directly to avoid pointer-timing flakiness).

**Most likely wrong:** The pin "standing vs knocked-down" detection thresholds in `standingMask()` (tilt > 45°, moved > 1.6×radius). Physics jitter could occasionally miscount a wobbling-but-standing pin.

## Files created
- `index.html` — entry page, ESM import map (Three.js + cannon-es from CDN), scoreboard/HUD/meters/overlays
- `style.css` — full UI styling
- `js/main.js` — bootstrap
- `js/scoring.js` — pure ten-pin scoring engine
- `js/scoring.test.mjs` — 15 scoring unit tests
- `js/physics.js` — cannon-es world: ball, 10 pins, lane, gutters, walls
- `js/scene.js` — Three.js scene
- `js/input.js` — mouse slingshot control + keyboard fallback
- `js/game.js` — state machine
- `js/hud.js` — DOM scoreboard, meters, messages, game-over

**Summary:** "Strike Zone" is a complete, realistic 3D ten-pin bowling game that runs in the browser with no build step (open `index.html` over HTTP; uses ESM import maps pulling Three.js and cannon-es from a CDN). Full physics (6 kg ball that rolls, hooks, and scatters a triangular rack of 10 lathe-modeled pins with real rigid-body collisions), wooden lane with gutters/arrows/pin-deck, cinematic ball-following camera, mouse-only slingshot controls plus keyboard fallback, and correct ten-pin scoring including strike/spare bonuses and 10th-frame bonus balls. Verified to boot and play cleanly in headless Chrome with zero runtime errors after fixing one init-order bug caught during testing.

---

*Driver note: the shipped `js/scoring.test.mjs` was independently re-run — **15 passed, 0 failed** under Node v22. Browser/screenshot claims are self-reported.*
