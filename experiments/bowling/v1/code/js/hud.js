// HUD: scoreboard, power/spin meter, status message, game-over overlay.
// Pure DOM; the game calls these methods.

export class HUD {
  constructor() {
    this.scoreboard = document.getElementById("scoreboard");
    this.message = document.getElementById("message");
    this.turn = document.getElementById("turn");
    this.powerFill = document.getElementById("power-fill");
    this.spinFill = document.getElementById("spin-fill");
    this.gameOver = document.getElementById("gameover");
    this.finalScore = document.getElementById("final-score");
    this.playAgain = document.getElementById("play-again");
    this._buildScaffold();
  }

  _buildScaffold() {
    // Build 10 empty frame cells once.
    this.scoreboard.innerHTML = "";
    this.frameEls = [];
    for (let f = 0; f < 10; f++) {
      const cell = document.createElement("div");
      cell.className = "frame";
      const head = document.createElement("div");
      head.className = "frame-num";
      head.textContent = String(f + 1);
      const rolls = document.createElement("div");
      rolls.className = "rolls";
      const tenth = f === 9;
      const slots = tenth ? 3 : 2;
      const slotEls = [];
      for (let s = 0; s < slots; s++) {
        const sl = document.createElement("span");
        sl.className = "roll";
        rolls.appendChild(sl);
        slotEls.push(sl);
      }
      const total = document.createElement("div");
      total.className = "frame-total";
      cell.appendChild(head);
      cell.appendChild(rolls);
      cell.appendChild(total);
      this.scoreboard.appendChild(cell);
      this.frameEls.push({ cell, slotEls, total });
    }
  }

  renderScoreboard(cells, grandTotal) {
    cells.forEach((c, i) => {
      const el = this.frameEls[i];
      el.cell.classList.toggle("active", c.active);
      el.slotEls.forEach((slot, s) => {
        const sym = c.symbols[s] ?? "";
        slot.textContent = sym;
        slot.classList.toggle("strike", sym === "X");
        slot.classList.toggle("spare", sym === "/");
      });
      el.total.textContent = c.score == null ? "" : String(c.score);
    });
    const totalEl = document.getElementById("grand-total");
    if (totalEl) totalEl.textContent = String(grandTotal);
  }

  setTurn(frame, ball) {
    this.turn.textContent = `Frame ${frame} · Ball ${ball}`;
  }

  setMessage(text) {
    this.message.textContent = text || "";
    this.message.classList.toggle("show", !!text);
  }

  setPower(power, spin) {
    this.powerFill.style.width = `${Math.round(power * 100)}%`;
    // spin from -1..1 → center-origin bar
    const pct = (spin + 1) / 2; // 0..1
    this.spinFill.style.left = `${pct * 100}%`;
  }

  showGameOver(score, onPlayAgain) {
    this.finalScore.textContent = String(score);
    this.gameOver.classList.add("show");
    this.playAgain.onclick = () => onPlayAgain();
  }

  hideGameOver() {
    this.gameOver.classList.remove("show");
  }
}
