# v2 — final report (agent's verbatim closing message)

> Operating instructions injected: **Fable5.md @ v2** (2d4dc47 — rewrite to match observed Fable 5 behavior). Model: Opus 4.8. agentId: `a0e397118f5989482`.

---

All files are in the output location and nothing else was touched. Build complete and verified.

## Files created

- **`index.html`** — entry point: HUD (10-frame scoreboard, power/spin meters, message banner, hint), styles, and a resilient Three.js loader (vendored-local-first, then 3 CDN fallbacks, then a graceful error screen).
- **`scoring.js`** — dependency-free ten-pin scoring engine (strikes, spares, 10th-frame bonus balls, pin-availability, display glyphs); usable in browser and Node.
- **`physics.js`** — custom lightweight rigid-body physics: ball with rolling friction, hook/spin curve, gutter capture; pins with impulse-based ball→pin and pin→pin chain-reaction collisions and toppling.
- **`game.js`** — Three.js renderer + input + game state machine: wood-grain lane, gutters, dovetail arrows, spotlit pin deck, clear-coat ball with finger holes, lathe-modeled pins, mouse aim + press-hold power meter + drag-for-spin, follow camera, and synthesized WebAudio (roll/crash/strike chime).
- **`three.min.js`** — vendored Three.js r160 (UMD global build) so the game runs fully offline.
- **`scoring.test.js`** / **`physics.test.js`** — headless Node test suites.

## Result

A complete, playable 3D ten-pin bowling game ("Strike Zone"), mouse-driven: move to aim along a live curved guide line, press-and-hold for an oscillating power meter, drag up/down for hook spin, release to bowl. Realistic-looking 3D (perspective wood lane, gutters, aiming arrows, spotlit deck, clear-coat ball, lathe-shaped pins), animated pin physics with chain reactions and gutter balls, a follow camera, full standard scoring with a live 10-frame scoreboard, strike/spare detection with banners and chimes, correct 10th-frame bonus-ball logic, and `R` to restart.

**Verification (confirmed, not inferred):** Ran in real headless Chromium (Playwright, swiftshader WebGL). End-to-end harness reported `RESULT: PASS` with **zero console errors**, WebGL active, 10 pins rendered, and a programmatic throw correctly resolving through the state machine and writing to the scoreboard. Screenshots confirmed the lane, ball, aim line, pins, power/spin meters, and banners all render. Unit gates: **scoring 26/26**, **physics 6/6**, all three JS files parse clean. During the build I found and fixed three real runtime bugs (fallen pins never settling; a pin-vs-pin collision injecting runaway energy that flung pins to infinity; an over-violent ball→pin impulse), each re-verified at runtime after the fix.

**What only you can verify from where you sit:** real mouse feel, audio (the test env has no speakers), and behavior on your specific GPU/browser. Pin-action tuning is a craft knob — levers are `restitution` (0.6) and the topple threshold (`impactMag > 0.4`) in `physics.js`, and the ball→pin `transfer` cap (6.0 m/s). The claim I'd most expect to need adjustment is that pin-scatter realism *feels* right to a human player.

To play: open `index.html` in a browser (or serve over HTTP). Works offline thanks to the vendored `three.min.js`.

---

*Driver note: shipped `scoring.test.js` and `physics.test.js` independently re-run — **26 + 6 = 32 passed, 0 failed** under Node v22. Browser/Playwright claims are self-reported.*
