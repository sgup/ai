/**
 * ui.js — DOM heads-up display: scoreboard, control meters, banners, ball
 * picker and start/gameover screens. Pure presentation; the game core calls
 * these methods and never reads the DOM itself.
 */

import { BALL_COLORS } from "./scene.js";

export class GameUI {
  constructor() {
    this.el = {
      loading: document.getElementById("loading"),
      startScreen: document.getElementById("start-screen"),
      gameoverScreen: document.getElementById("gameover-screen"),
      scoreboard: document.getElementById("scoreboard"),
      controls: document.getElementById("controls"),
      banner: document.getElementById("banner"),
      ballPicker: document.getElementById("ball-picker"),
      sbFrames: document.getElementById("sb-frames"),
      sbTotal: document.getElementById("sb-total-value"),
      aimFill: document.getElementById("aim-fill"),
      aimMarker: document.getElementById("aim-marker"),
      spinFill: document.getElementById("spin-fill"),
      spinMarker: document.getElementById("spin-marker"),
      powerFill: document.getElementById("power-fill"),
      ctrlHint: document.getElementById("ctrl-hint"),
      bpSwatches: document.getElementById("bp-swatches"),
      finalScore: document.getElementById("final-score"),
      finalMsg: document.getElementById("final-msg"),
      startBtn: document.getElementById("start-btn"),
      replayBtn: document.getElementById("replay-btn"),
    };
    this._buildFrames();
    this._buildSwatches();
    this._bannerTimer = null;
  }

  hideLoading() {
    this.el.loading.classList.add("hidden");
  }
  showStart() {
    this.el.startScreen.classList.remove("hidden");
  }
  hideStart() {
    this.el.startScreen.classList.add("hidden");
  }

  showGame() {
    this.el.scoreboard.classList.remove("hidden");
    this.el.controls.classList.remove("hidden");
    this.el.ballPicker.classList.remove("hidden");
  }
  hideGame() {
    this.el.scoreboard.classList.add("hidden");
    this.el.controls.classList.add("hidden");
    this.el.ballPicker.classList.add("hidden");
  }

  onStart(cb) {
    this.el.startBtn.addEventListener("click", cb);
  }
  onReplay(cb) {
    this.el.replayBtn.addEventListener("click", cb);
  }
  onPickBall(cb) {
    this._pickCb = cb;
  }

  // ---------- Scoreboard ----------
  _buildFrames() {
    this.el.sbFrames.innerHTML = "";
    this.frameEls = [];
    for (let f = 0; f < 10; f++) {
      const isTenth = f === 9;
      const frame = document.createElement("div");
      frame.className = "frame" + (isTenth ? " tenth" : "");
      const num = document.createElement("div");
      num.className = "frame-num";
      num.textContent = f + 1;
      const rolls = document.createElement("div");
      rolls.className = "frame-rolls";
      const boxCount = isTenth ? 3 : 2;
      const rollEls = [];
      for (let b = 0; b < boxCount; b++) {
        const r = document.createElement("div");
        r.className = "roll";
        rolls.appendChild(r);
        rollEls.push(r);
      }
      const score = document.createElement("div");
      score.className = "frame-score";
      frame.appendChild(num);
      frame.appendChild(rolls);
      frame.appendChild(score);
      this.el.sbFrames.appendChild(frame);
      this.frameEls.push({ frame, rollEls, score });
    }
  }

  renderScorecard(scorecard, activeFrame, total) {
    scorecard.forEach((fr, idx) => {
      const fe = this.frameEls[idx];
      fe.frame.classList.toggle("active", idx === activeFrame);

      const isTenth = idx === 9;
      const boxes = fe.rollEls;
      boxes.forEach((b) => {
        b.textContent = "";
        b.className = "roll";
      });

      if (isTenth) {
        fr.symbols.forEach((sym, i) => {
          if (i < boxes.length) {
            boxes[i].textContent = sym;
            if (sym === "X") boxes[i].classList.add("strike");
            else if (sym === "/") boxes[i].classList.add("spare");
          }
        });
      } else {
        // Normal frame: strike shows in the second box, leaving first blank.
        if (fr.symbols[1] === "X") {
          boxes[0].textContent = "";
          boxes[1].textContent = "X";
          boxes[1].classList.add("strike");
        } else {
          if (fr.symbols[0] !== undefined && fr.symbols[0] !== "") {
            boxes[0].textContent = fr.symbols[0];
          }
          if (fr.symbols[1]) {
            boxes[1].textContent = fr.symbols[1];
            if (fr.symbols[1] === "/") boxes[1].classList.add("spare");
          }
        }
      }

      fe.score.textContent = fr.cumulative !== null && fr.cumulative !== undefined ? fr.cumulative : "";
    });
    this.el.sbTotal.textContent = total;
  }

  // ---------- Control meters ----------
  updateAim(aim, spin) {
    // aim -1..1 → marker position 0..100%
    const pct = (aim + 1) / 2 * 100;
    this.el.aimMarker.style.left = pct + "%";
    this.el.aimFill.style.width = pct + "%";
    this._updateSpin(spin);
  }
  updateCharge(power, aim, spin) {
    this.el.powerFill.style.width = Math.round(power * 100) + "%";
    const pct = (aim + 1) / 2 * 100;
    this.el.aimMarker.style.left = pct + "%";
    this.el.aimFill.style.width = pct + "%";
    this._updateSpin(spin);
  }
  _updateSpin(spin) {
    // Center at 50%, fill left/right based on sign.
    const mid = 50;
    const pct = mid + (spin * 50);
    this.el.spinMarker.style.left = clamp(pct, 2, 98) + "%";
    if (spin >= 0) {
      this.el.spinFill.style.left = "50%";
      this.el.spinFill.style.width = Math.abs(spin) * 50 + "%";
    } else {
      this.el.spinFill.style.left = 50 - Math.abs(spin) * 50 + "%";
      this.el.spinFill.style.width = Math.abs(spin) * 50 + "%";
    }
  }
  resetPower() {
    this.el.powerFill.style.width = "0%";
  }
  setHint(text) {
    this.el.ctrlHint.textContent = text;
  }

  // ---------- Banner ----------
  showBanner(text, kind = "") {
    const b = this.el.banner;
    b.textContent = text;
    b.className = "banner";
    if (kind) b.classList.add(kind);
    // Force reflow so the animation restarts.
    void b.offsetWidth;
    b.classList.add("show");
    b.classList.remove("hidden");
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => {
      b.classList.remove("show");
    }, 1850);
  }

  // ---------- Ball picker ----------
  _buildSwatches() {
    this.el.bpSwatches.innerHTML = "";
    this.swatchEls = [];
    BALL_COLORS.forEach((c, i) => {
      const s = document.createElement("div");
      s.className = "swatch" + (i === 0 ? " selected" : "");
      s.style.background = `radial-gradient(circle at 35% 30%, #${c.accent
        .toString(16)
        .padStart(6, "0")}, #${c.hex.toString(16).padStart(6, "0")})`;
      s.title = c.name;
      s.addEventListener("click", () => {
        this.swatchEls.forEach((e) => e.classList.remove("selected"));
        s.classList.add("selected");
        this._pickCb?.(i);
      });
      this.el.bpSwatches.appendChild(s);
      this.swatchEls.push(s);
    });
  }

  // ---------- Game over ----------
  showGameOver(total) {
    this.el.finalScore.textContent = `Final score: ${total}`;
    this.el.finalMsg.textContent = ratingMessage(total);
    this.el.gameoverScreen.classList.remove("hidden");
  }
  hideGameOver() {
    this.el.gameoverScreen.classList.add("hidden");
  }
}

function ratingMessage(total) {
  if (total === 300) return "A PERFECT GAME. You are a legend.";
  if (total >= 250) return "Phenomenal — pro-level bowling!";
  if (total >= 200) return "Excellent! You broke 200.";
  if (total >= 150) return "Solid game. Above average!";
  if (total >= 100) return "Nice — you cracked triple digits.";
  if (total >= 70) return "Good effort. Keep practicing!";
  return "Everyone starts somewhere. Roll again!";
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
