import { GameState } from './state.js';
import { Renderer } from './render.js';
import { attachInput } from './input.js';
import { UNIT_TYPES } from './units.js';
import { runAiTurn } from './ai.js';

const TILE_SIZE = 64;
const GRID_W = 10;
const GRID_H = 10;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const ui = {
  currentPlayer: document.getElementById('currentPlayer'),
  money: document.getElementById('money'),
  turn: document.getElementById('turn'),
  shop: document.getElementById('shop'),
  endTurn: document.getElementById('endTurn'),
};

const game = new GameState(GRID_W, GRID_H);
const renderer = new Renderer(ctx, TILE_SIZE, game);

function updateUI() {
  ui.currentPlayer.textContent = String(game.currentPlayer + 1);
  ui.money.textContent = String(game.money[game.currentPlayer]);
  ui.turn.textContent = String(game.turn);
}

function animate() {
  renderer.draw();
  updateUI();
  requestAnimationFrame(animate);
}

// Shop interaction
ui.shop.addEventListener('click', (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const type = target.getAttribute('data-unit');
  if (!type) return;
  const unitType = UNIT_TYPES[type];
  if (!unitType) return;
  game.queueSpawn(unitType);
});

// End turn button
ui.endTurn.addEventListener('click', () => {
  game.endTurn();
  maybeRunAI();
});

// Input handling (canvas clicks)
attachInput(canvas, TILE_SIZE, game);

// Start the game loop
animate();

// --- Simple AI integration (Player 2) ---
function setUIEnabled(enabled) {
  // Disable all buttons while AI acts
  const buttons = document.querySelectorAll('button');
  buttons.forEach((b) => (b.disabled = !enabled));
}

async function maybeRunAI() {
  if (game.currentPlayer !== 1) return;
  setUIEnabled(false);
  await runAiTurn(game);
  setUIEnabled(true);
}

// If for any reason AI starts, ensure it runs
maybeRunAI();
