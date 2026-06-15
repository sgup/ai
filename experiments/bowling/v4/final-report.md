# v4 — final report (agent's verbatim closing message)

> Operating instructions injected: **Fable5.md @ v4** (9e087b3 — + quality-floor & design-interrogation rules). Model: Opus 4.8. agentId: `af61d9f0ddb7a5d98`.

---

The output directory contains exactly one file: `index.html`. Final re-read pass against the operating instructions' checklist, focusing on the one runtime claim I cannot confirm here.

The honest gap: I cannot render WebGL in this sandbox, so I have **not** confirmed the game visually runs — that the CDN modules load in a real browser, that physics tuning (ball speed, hook force, pin masses) produces satisfying pin action, or that the camera framing looks right. What I *did* confirm: the scoring algorithm is correct (7 canonical cases pass under Node), the JS parses without syntax errors, no undefined-reference issues, and I caught and fixed a real physics bug (pin collision cylinders were being rotated onto their sides) plus removed dead code with a latent `this`-bug.

**Files created:**
- `index.html` — the complete, self-contained 3D bowling game (single file, 46 KB).

**Summary:** A full-featured 3D bowling game in one self-contained `index.html`, using Three.js 0.184 and cannon-es 0.20 loaded via an ESM importmap from esm.sh (verified both versions exist and that esm.sh serves them as ES modules). It renders a wood-textured regulation lane with gutters, side rails, a glowing pin-deck masking unit, shadow-casting lights, a clearcoated bowling ball with finger holes, and ten lathe-turned pins with red neck stripes racked in the standard triangle. Physics gives the ball realistic mass (~14 lb), the lane low friction, and a spin-driven hook force so sideways drag curves the ball into the pocket. Mouse control is drag-to-aim-and-power: drag back on the lane to set direction, power (live meter), and hook, then release to bowl — fully playable without a keyboard (touch is wired too, plus `R` for new game and `C`/a button to toggle behind/top camera). Scoring is real 10-frame USBC scoring with strikes (X), spares (/), open frames, all bonus-ball math, and the special 3-ball 10th frame, shown on a live scoreboard with per-frame cumulative totals and a game-over card that grades your final score.

The one thing I could not verify and you should confirm by opening the file in a browser (it needs internet for the CDN modules): that it visually renders and that the physics tuning feels right — pin action, ball speed, and hook curve are all knobs set by reason, not by watching them run. If the hook is too strong or weak, the single knob is the `0.16` multiplier in `applyHookForce()`; ball speed lives in `launchBall()` (`5.0 + power * 5.5`).

---

*Driver note: this run shipped no test file, so the "7 canonical cases pass" claim is self-reported and was not independently re-run. Like v3, it explicitly flagged rendering as unconfirmed rather than claiming browser verification.*
