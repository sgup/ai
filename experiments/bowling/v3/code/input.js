// input.js — Mouse-driven aiming and throwing.
//
// Control scheme (easy with a mouse):
//   • Move the mouse left/right anywhere over the lane to set the ball's
//     starting position + aim. A dashed guide line previews the path.
//   • Press and HOLD to charge power; a power meter fills and pulses.
//   • Release to throw. Longer hold = more power (up to max).
//   • The SPIN slider (or A/D keys) sets hook; the guide line curves to match.
//
// This module only produces a "throw" descriptor; main.js owns the sim.

import { LANE } from "./physics.js";

export class InputController {
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.onThrow = opts.onThrow;
    this.getEnabled = opts.getEnabled; // () => bool, true when ready to bowl
    this.onAimChange = opts.onAimChange; // (aimX, spin, power) => void

    this.aimX = 0; // ball start x (-halfWidth..halfWidth area near foul line)
    this.spin = 0; // -1..1
    this.power = 0; // 0..1 while charging
    this.charging = false;
    this.chargeStart = 0;
    this.maxChargeMs = 1100;

    this._bind();
    this._loop();
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener("pointermove", (e) => this._move(e));
    c.addEventListener("pointerdown", (e) => this._down(e));
    window.addEventListener("pointerup", (e) => this._up(e));
    window.addEventListener("keydown", (e) => this._key(e, true));

    // Keep aim responsive even off-canvas drags.
    c.style.touchAction = "none";
  }

  _ndcX(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1; // -1..1
    return x;
  }

  _move(e) {
    if (!this.getEnabled()) return;
    // Map horizontal mouse position to a start-x near the foul line.
    // Clamp inside the lane so you can still aim for the gutter intentionally.
    const ndc = this._ndcX(e);
    this.aimX = Math.max(-1, Math.min(1, ndc)) * (LANE.halfWidth - 0.05);
    this._emit();
  }

  _down(e) {
    if (!this.getEnabled()) return;
    this.charging = true;
    this.chargeStart = performance.now();
    this.power = 0;
  }

  _up() {
    if (!this.charging) return;
    this.charging = false;
    const held = performance.now() - this.chargeStart;
    const power = Math.max(0.18, Math.min(1, held / this.maxChargeMs));
    this.power = 0;
    this.onThrow({ aimX: this.aimX, spin: this.spin, power });
    this._emit();
  }

  _key(e, down) {
    if (e.key === "a" || e.key === "ArrowLeft") {
      this.spin = Math.max(-1, this.spin - 0.12);
      this._emit();
    } else if (e.key === "d" || e.key === "ArrowRight") {
      this.spin = Math.min(1, this.spin + 0.12);
      this._emit();
    }
  }

  setSpin(v) {
    this.spin = Math.max(-1, Math.min(1, v));
    this._emit();
  }

  _emit() {
    this.onAimChange?.(this.aimX, this.spin, this.power);
  }

  _loop() {
    const tick = () => {
      if (this.charging) {
        const held = performance.now() - this.chargeStart;
        this.power = Math.min(1, held / this.maxChargeMs);
        this._emit();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
