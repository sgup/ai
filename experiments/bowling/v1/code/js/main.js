// Entry point: wire up HUD + game on the canvas.
import { BowlingGame } from "./game.js";
import { HUD } from "./hud.js";

function start() {
  const canvas = document.getElementById("game");
  const hud = new HUD();
  // Expose for debugging in the console.
  window.__bowling = new BowlingGame(canvas, hud);

  // Dismiss the intro overlay on first interaction.
  const intro = document.getElementById("intro");
  const dismiss = () => intro.classList.add("hidden");
  document.getElementById("start-btn").addEventListener("click", dismiss);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
