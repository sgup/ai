// Mouse input → a bowling shot.
//
// Control scheme (mouse-only, intuitive):
//   • Move the mouse left/right anywhere on screen to AIM (set the ball's lateral
//     start position and a small launch angle).
//   • PRESS and DRAG BACKWARD (downward on screen) to charge POWER — like pulling
//     back a slingshot. The further you pull, the more power.
//   • Drag LEFT/RIGHT while pulling back to add SPIN (hook). Pulling back to the
//     left curves the ball right-to-left, and vice versa.
//   • RELEASE to bowl.
//
// Also supports: just click without dragging = a soft straight roll.

export class InputController {
  constructor(canvas, { onAimUpdate, onRelease, isInteractive }) {
    this.canvas = canvas;
    this.onAimUpdate = onAimUpdate;
    this.onRelease = onRelease;
    this.isInteractive = isInteractive;

    this.dragging = false;
    this.startY = 0;
    this.startX = 0;
    this.aimX = 0; // -1..1 lateral aim
    this.angle = 0; // radians launch angle
    this.power = 0; // 0..1
    this.spin = 0; // -1..1

    this._bind();
    this._emit();
  }

  reset() {
    this.dragging = false;
    this.power = 0;
    this.spin = 0;
    this._emit();
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener("pointermove", (e) => this._onMove(e));
    c.addEventListener("pointerdown", (e) => this._onDown(e));
    window.addEventListener("pointerup", (e) => this._onUp(e));
    window.addEventListener("pointercancel", () => this._cancel());
    // Keyboard fallback for accessibility / no-drag play.
    window.addEventListener("keydown", (e) => this._onKey(e));
  }

  _px(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width, // 0..1
      y: (e.clientY - r.top) / r.height, // 0..1
    };
  }

  _onMove(e) {
    if (!this.isInteractive()) return;
    const p = this._px(e);

    if (!this.dragging) {
      // Free aim: map horizontal cursor position to lateral aim.
      this.aimX = clamp((p.x - 0.5) * 2, -1, 1);
      this.angle = -this.aimX * 0.12; // slight angle toward center
      this._emit();
      return;
    }

    // Dragging back: vertical distance dragged downward = power.
    const dy = p.y - this.startY; // positive = dragged down
    this.power = clamp(dy * 1.8, 0, 1);
    // Horizontal drag during pull = spin.
    const dx = p.x - this.startX;
    this.spin = clamp(dx * -3.0, -1, 1);
    // Keep the aim from the press position; allow fine angle from horizontal too.
    this.angle = -this.aimX * 0.12 + dx * 0.25;
    this._emit();
  }

  _onDown(e) {
    if (!this.isInteractive()) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    const p = this._px(e);
    this.dragging = true;
    this.startY = p.y;
    this.startX = p.x;
    this.aimX = clamp((p.x - 0.5) * 2, -1, 1);
    this.power = 0;
    this.spin = 0;
    this._emit();
  }

  _onUp(e) {
    if (!this.dragging) return;
    this.dragging = false;
    if (!this.isInteractive()) {
      this.power = 0;
      this.spin = 0;
      return;
    }
    // Minimum power so a tiny drag still rolls the ball.
    const power = Math.max(this.power, 0.18);
    this.onRelease({
      aimX: this.aimX,
      angle: this.angle,
      power,
      spin: this.spin,
    });
    this.power = 0;
    this.spin = 0;
  }

  _cancel() {
    this.dragging = false;
    this.power = 0;
    this.spin = 0;
    this._emit();
  }

  _onKey(e) {
    if (!this.isInteractive()) return;
    const step = 0.06;
    if (e.key === "ArrowLeft") {
      this.aimX = clamp(this.aimX - step, -1, 1);
      this._emit();
    } else if (e.key === "ArrowRight") {
      this.aimX = clamp(this.aimX + step, -1, 1);
      this._emit();
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      // space bowls with a default medium power.
      this.onRelease({ aimX: this.aimX, angle: this.angle, power: 0.7, spin: this.spin });
    } else if (e.key === "a" || e.key === "A") {
      this.spin = clamp(this.spin - 0.15, -1, 1);
      this._emit();
    } else if (e.key === "d" || e.key === "D") {
      this.spin = clamp(this.spin + 0.15, -1, 1);
      this._emit();
    }
  }

  _emit() {
    this.onAimUpdate({
      aimX: this.aimX,
      angle: this.angle,
      power: this.power,
      spin: this.spin,
    });
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
