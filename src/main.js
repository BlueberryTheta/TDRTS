import { GameState } from './state.js';
import { Renderer } from './render.js';
import { attachInput } from './input.js';
import { UNIT_TYPES, FORT_TYPES, UNIT_ABILITIES, rankForXP } from './units.js';
import { AssetStore } from './assets.js';
import { runAiTurn } from './ai.js';

const TILE_SIZE = 64;
const GRID_W = 12;
const GRID_H = 12;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
// Ensure canvas matches grid size
canvas.width = GRID_W * TILE_SIZE;
canvas.height = GRID_H * TILE_SIZE;

const ui = {
  currentPlayer: document.getElementById('currentPlayer'),
  money: document.getElementById('money'),
  turn: document.getElementById('turn'),
  shop: document.getElementById('shop'),
  endTurn: document.getElementById('endTurn'),
  // Top HUD (mobile)
  currentPlayerTop: document.getElementById('currentPlayerTop'),
  moneyTop: document.getElementById('moneyTop'),
  turnTop: document.getElementById('turnTop'),
  endTurnTop: document.getElementById('endTurnTop'),
};

const game = new GameState(GRID_W, GRID_H);
const renderer = new Renderer(ctx, TILE_SIZE, game);
// Load background map image (optional), try multiple filenames
function loadBackgroundSequential(paths, fallbackPath) {
  if (!paths.length) {
    if (fallbackPath) {
      const fb = new Image();
      fb.onload = () => { renderer.bgImage = fb; };
      fb.src = fallbackPath;
    }
    return;
  }
  const [head, ...rest] = paths;
  const img = new Image();
  img.onload = () => { renderer.bgImage = img; };
  img.onerror = () => loadBackgroundSequential(rest, fallbackPath);
  img.src = head;
}

loadBackgroundSequential([
  'assets/background.png',
  'assets/background.jpg',
  'assets/background.jpeg',
  'background.png',
  'background.jpg',
  'background.jpeg',
], 'assets/map.svg');

// Determine mode (ai or mp) via URL or landing modal
let MODE = (new URLSearchParams(location.search)).get('mode');
const DEBUG = (() => { try { return (window.DEBUG === true) || (new URLSearchParams(location.search).get('debug') === '1'); } catch { return false; } })();
function dlog(...args) { if (DEBUG) console.log('[APP]', ...args); }
let mpClient = null; // multiplayer client instance when in MP mode

// --- Load unit/fort images ---
const assets = new AssetStore(TILE_SIZE);
renderer.assets = assets;

const UNIT_TO_FILE = {
  Infantry: 'assets/Infantry.png',
  Tank: 'assets/Tank.png',
  Artillery: 'assets/Artillery.png',
  Engineer: 'assets/Engineer.png',
  Officer: 'assets/Officer.png',
  Medic: 'assets/Medic.png',
  Scout: 'assets/Scout.png',
  MechanizedInfantry: 'assets/Mechanized Infantry.png',
};

const FORT_TO_FILE = {
  Pillbox: 'assets/Pill Box.png',
  Bunker: 'assets/Bunker.png',
  BarbedWire: 'assets/Barbed Wire.png',
  SupplyDepot: 'assets/Supply Depot.png',
};

const MISC_ASSETS = {
  Base: 'assets/Base.png',
  BlueFlag: 'assets/Blue Flag.png',
  OrangeFlag: 'assets/Orange Flag.png',
};

assets.load({ ...UNIT_TO_FILE, ...FORT_TO_FILE, ...MISC_ASSETS });

// Decorate shop buttons with thumbnails
function decorateShop() {
  const map = { ...UNIT_TO_FILE, ...FORT_TO_FILE };
  const btns = document.querySelectorAll('#shop .shop-item');
  btns.forEach((btn) => {
    const unitKey = btn.getAttribute('data-unit');
    const fortKey = btn.getAttribute('data-fort');
    const key = unitKey || fortKey;
    const path = map[key];
    const thumb = btn.querySelector('.thumb');
    if (thumb && path) {
      thumb.style.backgroundImage = `url('${path}')`;
    }
    const priceSpan = btn.querySelector('.price');
    if (priceSpan) {
      if (unitKey && UNIT_TYPES[unitKey]) priceSpan.textContent = `$${UNIT_TYPES[unitKey].cost}`;
      if (fortKey && FORT_TYPES[fortKey]) priceSpan.textContent = `$${FORT_TYPES[fortKey].cost}`;
    }
  });
}
decorateShop();

// Expand accordions on desktop by default
function setAccordionsOpenByViewport() {
  const open = window.innerWidth > 900;
  document.querySelectorAll('details.accordion').forEach((d) => {
    if (open) d.setAttribute('open', ''); else d.removeAttribute('open');
  });
}
setAccordionsOpenByViewport();
window.addEventListener('resize', () => {
  setAccordionsOpenByViewport();
});

// --- Landing (mode selection) ---
const modeModal = document.getElementById('modeModal');
const playVsAiBtn = document.getElementById('playVsAi');
const playOnlineBtn = document.getElementById('playOnline');
function setMode(m) {
  MODE = m;
  if (modeModal) modeModal.style.display = 'none';
  dlog('Mode set to', MODE);
  if (MODE === 'ai') {
    // If it's AI's turn (player 2) for any reason, run AI
    maybeRunAI();
  } else if (MODE === 'mp') {
    // Initialize multiplayer client
    initMultiplayer().catch(err => console.error('MP init failed', err));
  }
}
if (!MODE) {
  if (modeModal) modeModal.style.display = 'flex';
} else if (modeModal) {
  modeModal.style.display = 'none';
}
if (playVsAiBtn) playVsAiBtn.onclick = () => setMode('ai');
if (playOnlineBtn) playOnlineBtn.onclick = () => setMode('mp');

function updateUI() {
  // avoid noisy per-frame logs; show when major fields change (optional: could be expanded)
  ui.currentPlayer.textContent = String(game.currentPlayer + 1);
  ui.money.textContent = String(game.money[game.currentPlayer]);
  ui.turn.textContent = String(game.turn);
  if (ui.currentPlayerTop) ui.currentPlayerTop.textContent = String(game.currentPlayer + 1);
  if (ui.moneyTop) ui.moneyTop.textContent = String(game.money[game.currentPlayer]);
  if (ui.turnTop) ui.turnTop.textContent = String(game.turn);
  // Game over modal
  if (game.isGameOver && !gameOverShown) {
    showGameOver();
  }
  // MP: enable inputs only on your turn
  if (MODE === 'mp' && mpClient) {
    const myTurn = game.currentPlayer === mpClient.player;
    const shopBtns = document.querySelectorAll('#shop .shop-item');
    shopBtns.forEach(b => b.disabled = !myTurn);
    if (ui.endTurn) ui.endTurn.disabled = !myTurn;
    if (ui.endTurnTop) ui.endTurnTop.disabled = !myTurn;
  }
  // Selected unit panel
  const info = document.getElementById('unitInfo');
  const none = document.getElementById('unitNone');
  const u = game.getUnitById(game.selectedId);
  if (!u) {
    if (info) info.style.display = 'none';
    if (none) none.style.display = '';
  } else {
    if (none) none.style.display = 'none';
    if (info) info.style.display = '';
    const nameEl = document.getElementById('unitName');
    const ownerEl = document.getElementById('unitOwner');
    const hpEl = document.getElementById('unitHP');
    const statsEl = document.getElementById('unitStats');
    const xpEl = document.getElementById('unitXP');
    const rankEl = document.getElementById('unitRank');
    const abilEl = document.getElementById('unitAbilities');
    if (nameEl) nameEl.textContent = u.type;
    if (ownerEl) ownerEl.textContent = `(P${u.player + 1})`;
    if (hpEl) hpEl.textContent = `HP: ${Math.max(0, u.hp)} / ${u.maxHp}`;
    const hpPct = Math.max(0, Math.min(1, (u.hp || 0) / (u.maxHp || 1)));
    const bar = document.querySelector('#unitHpBar .bar-fill');
    if (bar) bar.style.width = `${hpPct * 100}%`;
    const lvl = rankForXP(u.xp || 0).level;
    const aura = game.getOfficerBonus(u);
    const atkEff = (u.atk || 0) + lvl + aura;
    const defEff = (u.def || 0) + lvl + aura;
    if (statsEl) statsEl.textContent = `ATK: ${atkEff}, DEF: ${defEff}, MOVE: ${u.move}, RNG: ${u.range}, SIGHT: ${u.sight ?? 3}`;
    const rk = rankForXP(u.xp || 0);
    if (xpEl) xpEl.firstChild ? xpEl.firstChild.nodeValue = `XP: ${u.xp || 0} (` : (xpEl.textContent = `XP: ${u.xp || 0} (`);
    if (rankEl) rankEl.textContent = rk.label;
    const rankBadge = document.getElementById('unitRankBadge');
    if (rankBadge) rankBadge.textContent = rk.label;
    const ab = UNIT_ABILITIES[u.type] || [];
    if (abilEl) {
      if (ab.length) {
        abilEl.innerHTML = 'Abilities: ' + ab.map(a => `<span class="ability">${a}</span>`).join('');
      } else {
        abilEl.textContent = 'Abilities: -';
      }
    }
  }
}

function animate() {
  // Keep visibility current for rendering and input
  if (typeof game.recomputeVisibility === 'function') game.recomputeVisibility();
  renderer.draw();
  updateUI();
  requestAnimationFrame(animate);
}

// Shop interaction
ui.shop.addEventListener('click', (e) => {
  const root = e.currentTarget;
  const el = (e.target instanceof HTMLElement) ? e.target.closest('[data-unit],[data-fort]') : null;
  if (!(el instanceof HTMLElement)) return;
  const type = el.getAttribute('data-unit');
  const fortTypeKey = el.getAttribute('data-fort');
  if (type) {
    const unitType = UNIT_TYPES[type];
    if (!unitType) return;
    game.queueSpawn(unitType);
    return;
  }
  if (fortTypeKey) {
    const fortType = FORT_TYPES[fortTypeKey];
    if (!fortType) return;
    // If an Engineer is selected for the current player and not acted, queue build around it
    const sel = game.getUnitById(game.selectedId);
    if (sel && sel.player === game.currentPlayer && sel.type === 'Engineer' && !sel.acted) {
      game.queueFortBuild(fortType);
    } else {
      game.queueFort(fortType);
    }
  }
});

// End turn button
ui.endTurn.addEventListener('click', () => {
  if (MODE === 'mp' && mpClient) {
    mpClient.action({ kind: 'endTurn' });
  } else {
    game.endTurn();
    maybeRunAI();
  }
});
if (ui.endTurnTop) {
  ui.endTurnTop.addEventListener('click', () => {
    if (MODE === 'mp' && mpClient) mpClient.action({ kind: 'endTurn' });
    else { game.endTurn(); maybeRunAI(); }
  });
}

// Input handling (canvas clicks)
attachInput(canvas, TILE_SIZE, game, undefined);

// Start the game loop
animate();

// --- Simple AI integration (Player 2) ---
function setUIEnabled(enabled) {
  // Disable all buttons while AI acts
  const buttons = document.querySelectorAll('button');
  buttons.forEach((b) => (b.disabled = !enabled));
}

async function maybeRunAI() {
  if (MODE !== 'ai') return;
  if (game.currentPlayer !== 1) return;
  setUIEnabled(false);
  try {
    await runAiTurn(game);
  } catch (err) {
    console.error('AI turn error:', err);
  } finally {
    setUIEnabled(true);
  }
}

// If for any reason AI starts, ensure it runs
maybeRunAI();

// --- Game Over Modal ---
let gameOverShown = false;
function showGameOver() {
  gameOverShown = true;
  setUIEnabled(false);
  const modal = document.getElementById('gameOverModal');
  const text = document.getElementById('gameOverText');
  if (text) text.textContent = `Player ${String((game.winner ?? 0) + 1)} captured the flag!`;
  if (modal) modal.style.display = 'flex';
  const btn = document.getElementById('newGameBtn');
  if (btn) btn.onclick = () => {
    // Simple reset: full reload
    location.reload();
  };
}

// --- Multiplayer wiring ---
function applySnapshot(snap) {
  const s = snap.state;
  dlog('Apply snapshot', { turn: s.turn, currentPlayer: s.currentPlayer, units: s.units?.length, forts: s.forts?.length, flags: s.flags });
  // Replace mutable fields
  game.w = s.w; game.h = s.h;
  game.turn = s.turn; game.currentPlayer = s.currentPlayer;
  game.income = s.income; game.money = s.money;
  game.bases = s.bases; game.flags = s.flags;
  game.units = s.units; game.forts = s.forts;
  game.isGameOver = s.isGameOver; game.winner = s.winner;
}

function buildSnapshot() {
  return {
    w: game.w,
    h: game.h,
    turn: game.turn,
    currentPlayer: game.currentPlayer,
    income: game.income,
    money: game.money,
    bases: game.bases,
    flags: game.flags,
    units: game.units,
    forts: game.forts,
    isGameOver: game.isGameOver,
    winner: game.winner,
  };
}

function applyActionLocal(action, byPlayer, isRemote=false) {
  dlog('Apply action', action.kind, { byPlayer, isRemote, action });
  switch (action.kind) {
    case 'spawn': {
      const { spawnType, unitType, fortType, x, y } = action;
      if (spawnType === 'unit') { const ut = UNIT_TYPES[unitType]; if (!ut) return; game.currentPlayer = byPlayer; game.queueSpawn(ut); game.trySpawnAt(x, y); }
      else { const ft = FORT_TYPES[fortType]; if (!ft) return; game.currentPlayer = byPlayer; game.queueFort(ft); game.trySpawnAt(x, y); }
      break;
    }
    case 'buildFort': {
      const { fortType, engineerId, x, y } = action; const ft = FORT_TYPES[fortType]; if (!ft) return; game.currentPlayer = byPlayer; game.selectedId = engineerId; game.queueFortBuild(ft); game.tryBuildAt(x, y); break;
    }
    case 'move': {
      const { unitId, x, y } = action; const u = game.getUnitById(unitId); if (!u) return; game.currentPlayer = byPlayer; game.moveUnitTo(u, x, y); game.checkFlagCapture(u); break;
    }
    case 'attack': {
      const { attackerId, x, y } = action; const a = game.getUnitById(attackerId); const enemy = game.getEnemyAt(x, y) || game.getFortAt(x, y); if (!a || !enemy) return; game.currentPlayer = byPlayer; game.attack(a, enemy); break;
    }
    case 'endTurn': {
      // Allow server to be source of truth for currentPlayer if provided
      game.endTurn(); break;
    }
  }
}

async function initMultiplayer() {
  const defaultWs = ((location.protocol === 'https:') ? 'wss://' : 'ws://') + location.host + '/api/ws';
  const wsUrl = (window.WS_URL || localStorage.getItem('WS_URL') || defaultWs);
  dlog('MP init', { wsUrl });
  const { MultiplayerClient } = await import('./net.js');
  mpClient = new MultiplayerClient(wsUrl);
  try {
    await mpClient.connect();
    dlog('MP connected');
  } catch (e) {
    // Show mode modal with error and allow falling back
    const modeModal = document.getElementById('modeModal');
    const info = document.getElementById('mpInfo');
    if (info) info.innerHTML = `<summary>Connection Error</summary><p class="hint">Failed to open WebSocket at <code>${wsUrl}</code>.<br/>Make sure you're running on Vercel or 'vercel dev' locally. You can fall back to Play vs Computer.</p>`;
    if (modeModal) modeModal.style.display = 'flex';
    console.error('MP init failed', e);
    MODE = 'ai';
    return;
  }

  // Room UI
  const modal = document.getElementById('modeModal');
  const info = document.getElementById('mpInfo');
  const urlParams = new URLSearchParams(location.search);
  const roomFromUrl = urlParams.get('room');
  mpClient.on('room', ({ roomId, player }) => {
    dlog('Room joined', { roomId, player });
    // Show shareable URL
    if (info) {
      info.innerHTML = `<summary>Online Multiplayer</summary><div class="hint">Room: <strong>${roomId}</strong><br/>Share this link: <code>?mode=mp&room=${roomId}</code></div>`;
    }
    // If host, send initial snapshot
    if (player === 0) {
      mpClient.send({ type: 'snapshot', state: buildSnapshot() });
    }
  });
  mpClient.on('snapshot', (msg) => { applySnapshot(msg); });
  mpClient.on('event', (msg) => { if (msg.action) applyActionLocal(msg.action, msg.player, /*remote*/true); if (typeof msg.currentPlayer === 'number') game.currentPlayer = msg.currentPlayer; });
  mpClient.on('request_state', () => { mpClient.send({ type: 'snapshot', state: buildSnapshot() }); });

  if (roomFromUrl) {
    mpClient.joinRoom(roomFromUrl);
  } else {
    // Wait for button clicks from landing modal
    const playOnlineBtn = document.getElementById('playOnline');
    if (playOnlineBtn) playOnlineBtn.onclick = null; // already used
    const createBtn = document.getElementById('playOnline');
    // Reuse Play Online to create room immediately for simplicity
  }

  // Set hooks for input to send actions
  const hooks = {
    spawn: ({ kind, unitType, fortType, x, y }) => {
      if (game.currentPlayer !== mpClient.player) return;
      dlog('HOOK spawn', { kind, unitType, fortType, x, y });
      const spawnType = kind; // 'unit' or 'fort'
      mpClient.action({ kind: 'spawn', spawnType, unitType, fortType, x, y });
      // Apply locally
      if (spawnType === 'unit') { const ut = UNIT_TYPES[unitType]; game.queueSpawn(ut); game.trySpawnAt(x, y); }
      else { const ft = FORT_TYPES[fortType]; game.queueFort(ft); game.trySpawnAt(x, y); }
    },
    buildFort: (fortType, engineerId, x, y) => {
      if (game.currentPlayer !== mpClient.player) return;
      dlog('HOOK buildFort', { fortType, engineerId, x, y });
      mpClient.action({ kind: 'buildFort', fortType, engineerId, x, y });
      game.selectedId = engineerId; const ft = FORT_TYPES[fortType]; game.queueFortBuild(ft); game.tryBuildAt(x, y);
    },
    move: (unitId, x, y) => {
      if (game.currentPlayer !== mpClient.player) return;
      dlog('HOOK move', { unitId, x, y });
      mpClient.action({ kind: 'move', unitId, x, y });
      const u = game.getUnitById(unitId); if (u) { game.moveUnitTo(u, x, y); game.checkFlagCapture(u); }
    },
    attack: (attackerId, x, y) => {
      if (game.currentPlayer !== mpClient.player) return;
      dlog('HOOK attack', { attackerId, x, y });
      mpClient.action({ kind: 'attack', attackerId, x, y });
      const a = game.getUnitById(attackerId); const enemy = game.getEnemyAt(x, y) || game.getFortAt(x, y); if (a && enemy) game.attack(a, enemy);
    },
  };
  // Reattach input with hooks
  attachInput(canvas, TILE_SIZE, game, hooks);

  // Provide simple create/join actions from modal buttons
  const playVsAiBtn = document.getElementById('playVsAi');
  const playOnlineBtn2 = document.getElementById('playOnline');
  if (playVsAiBtn) playVsAiBtn.onclick = () => { /* ignore here */ };
  if (playOnlineBtn2) playOnlineBtn2.onclick = async () => {
    mpClient.createRoom();
    document.getElementById('modeModal').style.display = 'none';
  };

  // Simple join prompt
  if (!roomFromUrl) {
    const code = prompt('Enter room code to join, or leave blank to create');
    if (code && code.trim()) { mpClient.joinRoom(code.trim()); document.getElementById('modeModal').style.display='none'; }
    else { mpClient.createRoom(); document.getElementById('modeModal').style.display='none'; }
  }
}

if (MODE === 'mp') {
  initMultiplayer().catch(err => console.error('MP init failed', err));
}
