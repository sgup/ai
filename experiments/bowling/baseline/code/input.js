/**
 * input.js — Mouse / touch control for aiming and bowling.
 *
 * Interaction model (designed to be obvious with just a mouse):
 *   - While idle, moving the pointer horizontally aims the ball left/right.
 *   - Press and HOLD, then DRAG the pointer DOWNWARD to wind up power
 *     (further down = more power, shown in the power meter).
 *   - A sideways component of the drag at release imparts SPIN (hook).
 *   - Release to bowl. Releasing with ~zero power cancels.
 *
 * Emits high-level callbacks; it never touches the scene or physics directly.
 */

export class InputController {
  constructor(canvas, handlers) {
    this.canvas = canvas;
    this.handlers = handlers; // { onAim, onCharge, onRelease }
    this.enabled = false;

    this.dragging = false;
    this.startX = 0;
    this.startY = 0;
    this.curX = 0;
    this.curY = 0;

    this.aim = 0; // -1..1 lateral aim
    this.power = 0; // 0..1
    this.spin = 0; // -1..1

    this._bind();
  }

  enable() {
    this.enabled = true;
  }
  disable() {
    this.enabled = false;
    this.dragging = false;
    this.canvas.classList.remove("grabbing");
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this._down(e));
    window.addEventListener("pointermove", (e) => this._move(e));
    window.addEventListener("pointerup", (e) => this._up(e));
    window.addEventListener("pointercancel", () => this._cancel());
  }

  _norm(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width, // 0..1
      y: (e.clientY - r.top) / r.height, // 0..1
    };
  }

  _down(e) {
    if (!this.enabled) return;
    const p = this._norm(e);
    this.dragging = true;
    this.startX = p.x;
    this.startY = p.y;
    this.curX = p.x;
    this.curY = p.y;
    this.power = 0;
    this.spin = 0;
    this.canvas.classList.add("grabbing");
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {}
  }

  _move(e) {
    if (!this.enabled) return;
    const p = this._norm(e);

    if (!this.dragging) {
      // Idle aiming: map horizontal position to aim.
      this.aim = clamp((p.x - 0.5) * 2.0, -1, 1);
      this.handlers.onAim?.(this.aim, this.spin);
      return;
    }

    this.curX = p.x;
    this.curY = p.y;

    // Power from downward drag (drag down to charge).
    const dy = Math.max(0, this.curY - this.startY);
    this.power = clamp(dy / 0.34, 0, 1);

    // Spin from horizontal drag during wind-up.
    const dx = this.curX - this.startX;
    this.spin = clamp(dx * 2.6, -1, 1);

    // Let aim drift a little with the horizontal drag too, so users can
    // fine-tune line while winding up.
    this.aim = clamp(this.aim + dx * 0.04, -1, 1);
    this.startX = this.curX; // incremental aim adjustment

    this.handlers.onCharge?.(this.power, this.aim, this.spin);
  }

  _up() {
    if (!this.enabled || !this.dragging) return;
    this.dragging = false;
    this.canvas.classList.remove("grabbing");

    if (this.power < 0.08) {
      // Treated as a cancel / mis-press.
      this.handlers.onRelease?.(null);
      this.power = 0;
      this.spin = 0;
      return;
    }

    this.handlers.onRelease?.({
      power: this.power,
      aim: this.aim,
      spin: this.spin,
    });
    this.power = 0;
    this.spin = 0;
  }

  _cancel() {
    this.dragging = false;
    this.power = 0;
    this.spin = 0;
    this.canvas.classList.remove("grabbing");
    this.handlers.onRelease?.(null);
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
