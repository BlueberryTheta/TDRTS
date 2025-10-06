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
let MODE = (new URLSearchParams(location.search)).get('mode'); try { if (!MODE) { const lr = localStorage.getItem('LAST_ROOM'); if (lr) MODE = 'mp'; } } catch {}
const DEBUG = (() => { try { return (window.DEBUG === true) || (new URLSearchParams(location.search).get('debug') === '1'); } catch { return false; } })();
function dlog(...args) { if (DEBUG) console.log('[APP]', ...args); }
// Debug helper to inspect units in console
try {
  window.dumpUnits = () => {
    const arr = game.units.map(u => ({ id: u.id, type: u.type, p: u.player, x: u.x, y: u.y, hp: u.hp, acted: !!u.acted, moved: !!u.moved }));
    console.table(arr);
    return arr;
  };
} catch {}
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
/*
assets.load({ ...UNIT_TO_FILE, ...FORT_TO_FILE, ...MISC_ASSETS });\n// --- MP Game Log ---\nconst __LOG = [];\nfunction logAction(action, byPlayer){\n  try {\n    const p = (typeof byPlayer === 'number') ? byPlayer : (mpClient && typeof mpClient.player==='number' ? mpClient.player : 0);\n    const who = p===0 ? 'P1' : 'P2';\n    let msg = '';\n    switch(action?.kind){\n      case 'spawn': { if(action.spawnType==='unit') msg = ${who} spawned  @ ,; else msg = ${who} placed  @ ,; break; }\n      case 'buildFort': msg = ${who} built  @ ,; break;\n      case 'move': msg = ${who} moved unit# -> ,; break;\n      case 'attack': msg = ${who} attacked @ ,; break;\n      case 'endTurn': msg = ${who} ended turn; break;\n      default: msg = action?.kind ? ${who}  : ${who} action;\n    }\n    __LOG.push({ t: Date.now(), p, msg });\n    if (__LOG.length > 200) __LOG.shift();\n    const list = document.getElementById('mpLogList');\n    if (list){\n      const div = document.createElement('div');\n      div.className = 'item ' + (p===0 ? 'p1' : 'p2');\n      const tm = new Date().toLocaleTimeString([], { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' });\n      div.textContent = []  + msg;\n      list.appendChild(div);\n      list.scrollTop = list.scrollHeight;\n    }\n  } catch {}\n}\n
*/

assets.load({ ...UNIT_TO_FILE, ...FORT_TO_FILE, ...MISC_ASSETS });

// --- MP Game Log ---
const __LOG = [];
function logAction(action, byPlayer) {
  try {
    const p = (typeof byPlayer === 'number') ? byPlayer : (mpClient && typeof mpClient.player === 'number' ? mpClient.player : 0);
    const who = p === 0 ? 'P1' : 'P2';
    let msg = '';
    switch (action && action.kind) {
      case 'spawn': {
        if (action.spawnType === 'unit') msg = `${who} spawned ${action.unitType} @ ${action.x},${action.y}`;
        else msg = `${who} placed ${action.fortType} @ ${action.x},${action.y}`;
        break;
      }
      case 'buildFort': msg = `${who} built ${action.fortType} @ ${action.x},${action.y}`; break;
      case 'move': msg = `${who} moved unit#${action.unitId} -> ${action.x},${action.y}`; break;
      case 'attack': msg = `${who} attacked @ ${action.x},${action.y}`; break;
      case 'endTurn': msg = `${who} ended turn`; break;
      default: msg = (action && action.kind) ? `${who} ${action.kind}` : `${who} action`;
    }
    __LOG.push({ t: Date.now(), p, msg });
    if (__LOG.length > 200) __LOG.shift();
    const list = document.getElementById('mpLogList');
    if (list) {
      const div = document.createElement('div');
      div.className = 'item ' + (p === 0 ? 'p1' : 'p2');
      const tm = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      div.textContent = `[${tm}] ` + msg;
      list.appendChild(div);
      list.scrollTop = list.scrollHeight;
    }
  } catch {}
}
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

// MP Debug overlay toggle wiring (ensure after DOMContentLoaded)
function wireMpDebug() {
  try {
    const btn = document.getElementById('mpDebugToggle');
    const ov = document.getElementById('mpDebugOverlay');
    const close = document.getElementById('mpDebugClose');
    if (btn && ov && !btn.__wired) {
      btn.addEventListener('click', () => { ov.style.display = (ov.style.display === 'none' || !ov.style.display) ? 'block' : 'none'; });
      btn.__wired = true;
    }
    if (close && ov && !close.__wired) { close.addEventListener('click', () => { ov.style.display = 'none'; }); close.__wired = true; }
    // Keyboard shortcut: press "D" to toggle overlay
    if (!window.__MP_DEBUG_KEY) {
      window.addEventListener('keydown', (e) => {
        if (e.key === 'd' || e.key === 'D') { try { const el = document.getElementById('mpDebugOverlay'); if (el) el.style.display = (el.style.display === 'none' || !el.style.display) ? 'block' : 'none'; } catch {} }
      });
      window.__MP_DEBUG_KEY = true;
    }
    // Auto-open if ?mpdebug=1
    try {
      const usp = new URLSearchParams(location.search);
      if ((usp.get('mpdebug') === '1' || usp.get('debug') === '1') && ov) ov.style.display = 'block';
    } catch {}
  } catch {}
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireMpDebug, { once: true });
} else {
  wireMpDebug();
}

// --- Landing (mode selection) ---
const modeModal = document.getElementById('modeModal');
const playVsAiBtn = document.getElementById('playVsAi');
const playOnlineBtn = document.getElementById('playOnline');
function setMode(m) {
  MODE = m;
  dlog('Mode set to', MODE);
  if (MODE === 'ai') {
    if (modeModal) modeModal.style.display = 'none';
    // If it's AI's turn (player 2) for any reason, run AI
    maybeRunAI();
  } else if (MODE === 'mp') {
    // Ensure modal stays open for create/join UI
    if (modeModal) modeModal.style.display = 'flex';
    const ctrls = document.getElementById('mpControls'); if (ctrls) ctrls.style.display='block';
    // Initialize multiplayer client (will wire the controls)
    initMultiplayer().catch(err => console.error('MP init failed', err));
  }
}
if (!MODE) {
  if (modeModal) modeModal.style.display = 'flex';
} else if (modeModal) {
  modeModal.style.display = 'none';
}
if (playVsAiBtn) playVsAiBtn.onclick = () => setMode('ai');
if (playOnlineBtn) playOnlineBtn.onclick = () => {
  const ctrls = document.getElementById('mpControls'); if (ctrls) ctrls.style.display='block';
  setMode('mp');
};

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
    const ready = (window.mpPlayers || 0) >= 2;
    const myTurn = ready && game.currentPlayer === mpClient.player;
    const shopBtns = document.querySelectorAll('#shop .shop-item');
    shopBtns.forEach(b => b.disabled = !myTurn);
    if (ui.endTurn) ui.endTurn.disabled = !myTurn;
    if (ui.endTurnTop) ui.endTurnTop.disabled = !myTurn;
    // Opponent status pill
    const opp = document.getElementById('opponentStatus');
    if (opp) {
      const joined = (window.mpPlayers || 0) >= 2;
      opp.textContent = joined ? 'Connected' : 'Waiting';
      opp.classList.remove('connected','waiting');
      opp.classList.add(joined ? 'connected' : 'waiting');
    }
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

  // (MP Debug UI removed)
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
  const el = (e.target instanceof HTMLElement) ? e.target.closest('[data-unit],[data-fort]') : null;
  if (!(el instanceof HTMLElement)) return;
  const type = el.getAttribute('data-unit');
  const fortTypeKey = el.getAttribute('data-fort');
  const ready = (window.mpPlayers || 0) >= 2;
  const myTurn = (MODE !== 'mp' || (ready && mpClient && game.currentPlayer === mpClient.player));
  dlog('SHOP click', { type, fortTypeKey, turn: game.turn, cp: game.currentPlayer, me: mpClient?.player, ready, myTurn });
  if (!myTurn) { dlog('SHOP blocked: not your turn or not ready'); return; }
  if (type) {
    const unitType = UNIT_TYPES[type];
    if (!unitType) { dlog('SHOP unitType missing', type); return; }
    game.queueSpawn(unitType);
    dlog('SHOP queued unit', { type });
    return;
  }
  if (fortTypeKey) {
    const fortType = FORT_TYPES[fortTypeKey];
    if (!fortType) { dlog('SHOP fortType missing', fortTypeKey); return; }
    // If an Engineer is selected for the current player and not acted, queue build around it
    const sel = game.getUnitById(game.selectedId);
    if (sel && sel.player === game.currentPlayer && sel.type === 'Engineer' && !sel.acted) {
      game.queueFortBuild(fortType);
      dlog('SHOP queued buildFort', { type: fortTypeKey, engineerId: sel.id });
    } else {
      game.queueFort(fortType);
      dlog('SHOP queued fort', { type: fortTypeKey });
    }
  }
});

// End turn button
ui.endTurn.addEventListener('click', () => {
  if (MODE === 'mp' && mpClient) {
    game.endTurn();
    if (typeof mpClient.sync === 'function') { mpClient.sync(buildSnapshot()); }
    else if (typeof mpClient.snapshot === 'function') { if (typeof mpClient.player === 'number' && mpClient.player === 0) mpClient.snapshot(buildSnapshot()); }
  } else {
    game.endTurn();
    maybeRunAI();
  }
});
if (ui.endTurnTop) {
  ui.endTurnTop.addEventListener('click', () => {
    if (MODE === 'mp' && mpClient) { game.endTurn(); if (typeof mpClient.sync === 'function') { mpClient.sync(buildSnapshot()); } else if (typeof mpClient.snapshot === 'function') { if (typeof mpClient.player === 'number' && mpClient.player === 0) mpClient.snapshot(buildSnapshot()); } }
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
  const s = snap && snap.state;
  if (!s) return;
  // Apply only if strictly newer. If snapshot has no rev, ignore unless our local rev is missing.
  const localRev = (typeof game.rev === 'number') ? game.rev : -1;
  const hasSnapRev = (typeof s.rev === 'number');
  const snapRev = hasSnapRev ? s.rev : -1;
  if (!hasSnapRev && localRev >= 0) {
    // Ignore rev-less snapshots once local state has initialized
    return;
  }
  if (hasSnapRev && snapRev <= localRev) return;
  game.w = s.w; game.h = s.h;
  game.turn = s.turn;
  game.currentPlayer = s.currentPlayer;
  game.income = s.income;
  game.money = s.money;
  game.bases = s.bases;
  game.flags = s.flags;
  game.units = s.units;
  game.forts = s.forts;
  // Ensure local id counter advances beyond all received ids to avoid id collisions
  try {
    let maxId = 0;
    if (Array.isArray(game.units)) {
      for (const u of game.units) if (u && typeof u.id === 'number') maxId = Math.max(maxId, u.id);
    }
    if (Array.isArray(game.forts)) {
      for (const f of game.forts) if (f && typeof f.id === 'number') maxId = Math.max(maxId, f.id);
    }
    game._unitId = (maxId || 0) + 1;
  } catch {}
  game.isGameOver = s.isGameOver;
  game.winner = s.winner;
  if (hasSnapRev) game.rev = snapRev;
}

function buildSnapshot() { return game.toSnapshot ? game.toSnapshot() : {
  w: game.w,
  h: game.h,
  turn: game.turn,
  currentPlayer: game.currentPlayer,
  rev: game.rev,
  income: game.income,
  money: game.money,
  bases: game.bases,
  flags: game.flags,
  units: game.units,
  forts: game.forts,
  isGameOver: game.isGameOver,
  winner: game.winner,
}; }

function applyActionLocal(action, byPlayer, isRemote=false) {
  // Ignore our own echoed remote events to avoid double-apply
  if (isRemote && mpClient && typeof mpClient.player === 'number' && byPlayer === mpClient.player) {
    const optimisticallyApplied = new Set(['spawn','buildFort','move','attack']);
    if (optimisticallyApplied.has(action.kind)) {
      return;
    }
  }
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

function buildInviteLink(roomId) {
  const url = new URL(location.href);
  url.searchParams.set('mode','mp');
  if (roomId) url.searchParams.set('room', roomId);
  return url.toString();
}

function showRoomBanner(roomId, player) {
  const banner = document.getElementById('roomBanner');
  const codeEl = document.getElementById('roomCode');
  const playerEl = document.getElementById('playerLabel');
  const copyBtn = document.getElementById('copyLinkBtn');
  if (banner) banner.style.display = '';
  if (codeEl) codeEl.textContent = roomId;
  if (playerEl) playerEl.textContent = player === 0 ? 'P1' : 'P2';
  if (copyBtn) copyBtn.onclick = () => navigator.clipboard?.writeText(buildInviteLink(roomId)); const menuBtn = document.getElementById('mpMenuBtn'); if (menuBtn) menuBtn.onclick = () => { const mm = document.getElementById('mpMenuModal'); if (mm) mm.style.display = 'flex'; };
}

async function initMultiplayer() {
  const defaultWs = ((location.protocol === 'https:') ? 'wss://' : 'ws://') + location.host + '/api/ws';
  const wsUrl = (window.WS_URL || localStorage.getItem('WS_URL') || defaultWs);
  const forceWS = (window.FORCE_WS === true) || (localStorage.getItem('FORCE_WS') === '1');
  // Prefer HTTP polling on any non-localhost host to avoid WS isolate issues in serverless
  const isLocal = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
  const preferHttp = !isLocal && !forceWS;
  dlog('MP init', { wsUrl, host: location.hostname, forceWS, preferHttp });
  const { MultiplayerClient, HttpMPClient } = await import('./net.js');
  // Probe HTTP backend availability quickly
  async function httpAvailable() {
    try {
      const res = await fetch(`/api/mp/poll?room=__health__&since=0`, { cache: 'no-store' });
      return res.ok;
    } catch { return false; }
  }

  let useHttp = preferHttp && (await httpAvailable());
  if (useHttp) {
    mpClient = new HttpMPClient(location.origin);
    await mpClient.connect();
    window.MP_TRANSPORT = 'http';
    try { window.__MP_CLIENT = mpClient; } catch {}
    try { window.SYNC_SNAPSHOT = () => { try { const snap = buildSnapshot(); setTimeout(() => { try { mpClient.sync(snap); } catch {} }, 0); } catch {} }; } catch {}
  } else {
    mpClient = new MultiplayerClient(wsUrl);
    try {
      await mpClient.connect();
      dlog('MP connected');
      window.MP_TRANSPORT = 'ws';
      try { window.__MP_CLIENT = mpClient; } catch {}
      try { window.SYNC_SNAPSHOT = () => { try { const snap = buildSnapshot(); setTimeout(() => { try { mpClient.snapshot(snap); } catch {} }, 0); } catch {} }; } catch {}
    } catch (e) {
      console.error('MP WS connect failed, falling back to HTTP', e);
      if (await httpAvailable()) {
        mpClient = new HttpMPClient(location.origin);
        await mpClient.connect();
        window.MP_TRANSPORT = 'http';
        try { window.__MP_CLIENT = mpClient; } catch {}
        try { window.SYNC_SNAPSHOT = () => { try { const snap = buildSnapshot(); setTimeout(() => { try { mpClient.sync(snap); } catch {} }, 0); } catch {} }; } catch {}
      } else {
        window.MP_TRANSPORT = 'unavailable';
      }
    }
  }

  // Room UI
  const modal = document.getElementById('modeModal');
  const info = document.getElementById('mpInfo');
  const urlParams = new URLSearchParams(location.search);
  const roomFromUrl = urlParams.get('room');
  mpClient.on('room', ({ roomId, player, players }) => {
    dlog('Room joined', { roomId, player, players });
    window.mpPlayers = typeof players === 'number' ? players : window.mpPlayers;
    window.currentRoomId = roomId; try { localStorage.setItem('LAST_ROOM', roomId); localStorage.setItem('LAST_SEAT', String(player)); localStorage.setItem('REJOIN_' + roomId, String(player)); } catch {}
    try { localStorage.setItem('REJOIN_' + roomId, String(player)); } catch {}
    try { window.MY_PLAYER = player; } catch {}
    // Show shareable URL
    if (info) {
      const using = (typeof window.MP_TRANSPORT === 'string') ? window.MP_TRANSPORT : 'unknown';
      let extra = '';
      if (using === 'unavailable') extra = `<div class="hint" style="color:#f85149">Multiplayer backend unavailable. Configure Neon/Postgres or force WebSocket for testing.</div>`;
      info.innerHTML = `<summary>Online Multiplayer</summary><div class="hint">Room: <strong>${roomId}</strong><br/>Share this link: <code>?mode=mp&room=${roomId}</code><br/>Transport: <strong>${using.toUpperCase()}</strong></div>${extra}`;
    }
    // If host, send initial snapshot and start a light heartbeat to ensure persistence
    if (player === 0) {
      const snap = buildSnapshot();
      // Send one initial snapshot; remove periodic heartbeat to prevent stale overwrites
      if (typeof mpClient.sync === 'function') mpClient.sync(snap); else if (typeof mpClient.snapshot === 'function') mpClient.snapshot(snap);
      try { window.__SYNC_HEARTBEAT = false; } catch {}
    }
    // Update banner and close modal
    showRoomBanner(roomId, player);
    const modeEl = document.getElementById('modeModal'); if (modeEl) modeEl.style.display = 'none';
  });
  // Snapshot-only: just apply snapshots from poller/WS relay
  mpClient.on('snapshot', (msg) => { applySnapshot(msg); });
  // WS relay: apply remote actions in real-time so peers see each other immediately
  mpClient.on('event', (msg) => {
    try {
      const { player, action, currentPlayer } = msg || {};
      if (action) {
        applyActionLocal(action, typeof player === 'number' ? player : -1, true);
        // Log the action
        try { logAction(action, player); } catch {}
        // Opponent activity pulse
        try {
          const opp = document.getElementById('opponentStatus');
          if (opp && typeof mpClient.player === 'number' && player !== mpClient.player) {
            opp.textContent = 'Active';
            opp.classList.remove('waiting'); opp.classList.add('connected');
            clearTimeout(window.__OPP_ACTIVE_TIMER);
            window.__OPP_ACTIVE_TIMER = setTimeout(() => {
              const joined = (window.mpPlayers || 0) >= 2;
              opp.textContent = joined ? 'Connected' : 'Waiting';
            }, 2500);
          }
        } catch {}
      }
      if (typeof currentPlayer === 'number') {
        game.currentPlayer = currentPlayer;
      }
      // After applying a remote action, publish authoritative snapshot
      const using = (typeof window !== 'undefined' && window.MP_TRANSPORT) ? window.MP_TRANSPORT : 'unknown';
      if (typeof mpClient?.sync === 'function') {
        // HTTP: persist+append sync event
        mpClient.sync(buildSnapshot());
      } else if (typeof mpClient?.snapshot === 'function') {
        // WS relay: host sends snapshots
        if (typeof mpClient.player === 'number' && mpClient.player === 0) {
          mpClient.snapshot(buildSnapshot());
        }
      }
    } catch (e) { console.error('MP event apply failed', e); }
  });
  // WS relay may ask a host to provide the latest snapshot
  mpClient.on('request_state', () => {
    try {
      if (typeof mpClient.snapshot === 'function') mpClient.snapshot(buildSnapshot());
    } catch (e) { console.error('MP request_state snapshot failed', e); }
  });
  // Mark that WS event handlers are registered (debug aid)
  try { window.__MP_EVENT_HANDLERS = true; } catch {}
  if (typeof mpClient.on === 'function') {
    mpClient.on('error', (err) => { console.error('MP ERROR action', err?.status || '', err?.message || ''); });
  }
  if (typeof mpClient.on === 'function') {
    mpClient.on('players', (n) => { window.mpPlayers = n; });
  }

  if (roomFromUrl) { let rejoinAs = null; try { const saved = localStorage.getItem('REJOIN_' + roomFromUrl); if (saved === '0' || saved === '1') rejoinAs = Number(saved); } catch {} if (rejoinAs !== null && typeof mpClient.rejoinRoom === 'function') mpClient.rejoinRoom(roomFromUrl, rejoinAs); else mpClient.joinRoom(roomFromUrl); } else { let lastRoom = null; let lastSeat = null; try { lastRoom = localStorage.getItem('LAST_ROOM'); const s = localStorage.getItem('LAST_SEAT'); if (s === '0' || s === '1') lastSeat = Number(s); } catch {} if (lastRoom) { if (lastSeat !== null && typeof mpClient.rejoinRoom === 'function') mpClient.rejoinRoom(lastRoom, lastSeat); else mpClient.joinRoom(lastRoom); } else wireMpControls(); }

  // Set hooks for input to send actions
  const hooks = {
    // Snapshot-only: apply locally, then persist+broadcast snapshot
    spawn: ({ kind, unitType, fortType, x, y }) => {
      if (game.currentPlayer !== mpClient.player) return;
      // Ensure local owner context is correct for spawn
      game.currentPlayer = mpClient.player;
      const spawnType = kind; // 'unit' or 'fort'
      if (spawnType === 'unit') {
        const ut = UNIT_TYPES[unitType];
        game.queueSpawn(ut);
        const created = game.trySpawnAt(x, y);
        if (created && created.id && created.player === mpClient.player) {
          game.selectedId = created.id;
        }
        try { logAction({ kind: 'spawn', spawnType:'unit', unitType, x, y }, mpClient.player); } catch {}
      } else {
        const ft = FORT_TYPES[fortType];
        game.queueFort(ft);
        const created = game.trySpawnAt(x, y);
        // Do not auto-select forts
        try { logAction({ kind: 'spawn', spawnType:'fort', fortType, x, y }, mpClient.player); } catch {}
      }
      // Persist snapshot: HTTP always, WS only by host
      if (typeof mpClient.sync === 'function') {
        mpClient.sync(buildSnapshot());
      } else if (typeof mpClient.snapshot === 'function') {
        if (typeof mpClient.player === 'number' && mpClient.player === 0) mpClient.snapshot(buildSnapshot());
      }
    },
    buildFort: (fortType, engineerId, x, y) => {
      if (game.currentPlayer !== mpClient.player) return;
      game.currentPlayer = mpClient.player;
      const eng = game.getUnitById(engineerId);
      if (!eng || eng.player !== mpClient.player) return; // enforce ownership
      game.selectedId = engineerId; const ft = FORT_TYPES[fortType]; game.queueFortBuild(ft); game.tryBuildAt(x, y);
      try { logAction({ kind:'buildFort', fortType, engineerId, x, y }, mpClient.player); } catch {}
      if (typeof mpClient.sync === 'function') { mpClient.sync(buildSnapshot()); }
      else if (typeof mpClient.snapshot === 'function') { if (typeof mpClient.player === 'number' && mpClient.player === 0) mpClient.snapshot(buildSnapshot()); }
    },
    move: (unitId, x, y) => {
      if (game.currentPlayer !== mpClient.player) return;
      game.currentPlayer = mpClient.player;
      const u = game.getUnitById(unitId); if (!u || u.player !== mpClient.player) return; // enforce ownership
      game.moveUnitTo(u, x, y); game.checkFlagCapture(u);
      try { logAction({ kind:'move', unitId, x, y }, mpClient.player); } catch {}
      if (typeof mpClient.sync === 'function') { mpClient.sync(buildSnapshot()); }
      else if (typeof mpClient.snapshot === 'function') { if (typeof mpClient.player === 'number' && mpClient.player === 0) mpClient.snapshot(buildSnapshot()); }
    },
    attack: (attackerId, x, y) => {
      if (game.currentPlayer !== mpClient.player) return;
      game.currentPlayer = mpClient.player;
      const a = game.getUnitById(attackerId); if (!a || a.player !== mpClient.player) return; // enforce ownership
      const enemy = game.getEnemyAt(x, y) || game.getFortAt(x, y); if (enemy) game.attack(a, enemy);
      try { logAction({ kind:'attack', attackerId, x, y }, mpClient.player); } catch {}
      if (typeof mpClient.sync === 'function') { mpClient.sync(buildSnapshot()); }
      else if (typeof mpClient.snapshot === 'function') { if (typeof mpClient.player === 'number' && mpClient.player === 0) mpClient.snapshot(buildSnapshot()); }
    },
  };
  // Reattach input with hooks
  attachInput(canvas, TILE_SIZE, game, hooks);
  try { window.__MP_HOOKS = hooks; } catch {}

  // No auto create/join; handled by UI
}

if (MODE === 'mp') { initMultiplayer().catch(err => console.error('MP init failed', err)); }

function wireMpControls() {
  const ctrls = document.getElementById('mpControls'); if (ctrls) ctrls.style.display='block';
  const createBtn = document.getElementById('createRoomBtn');
  const createdRoom = document.getElementById('createdRoom');
  const createdRoomCode = document.getElementById('createdRoomCode');
  const copyBtnModal = document.getElementById('copyLinkBtnModal');
  const joinBtn = document.getElementById('joinRoomBtn');
  const joinInput = document.getElementById('joinCodeInput');
  const joinErr = document.getElementById('joinError');

  if (createBtn) createBtn.onclick = async () => {
    dlog('UI createRoom clicked');
    try {
      await mpClient.createRoom();
      if (createdRoom) createdRoom.style.display = 'block';
      if (createdRoomCode && window.currentRoomId) createdRoomCode.textContent = window.currentRoomId;
      dlog('Room created currentRoomId=', window.currentRoomId);
    } catch (e) {
      console.error('Create room failed', e);
      if (createdRoom) {
        createdRoom.style.display = 'block';
        createdRoom.innerHTML = `<div class="hint" style="color:#f85149">Multiplayer backend unavailable. Configure HTTP MP or force WebSocket.</div>`;
      }
    }
  };
  if (joinBtn) joinBtn.onclick = async () => {
    const code = (joinInput?.value || '').trim();
    dlog('UI joinRoom clicked code=', code);
    if (!code) { if (joinErr) { joinErr.style.display='block'; joinErr.textContent='Enter a code.'; } return; }
    try { await mpClient.joinRoom(code); if (joinErr) joinErr.style.display='none'; }
    catch(e){ if (joinErr){ joinErr.style.display='block'; joinErr.textContent='Join failed: ' + (e?.message || 'Invalid code or server unavailable.'); } }
  };
  if (copyBtnModal) copyBtnModal.onclick = () => { if (window.currentRoomId) navigator.clipboard?.writeText(buildInviteLink(window.currentRoomId)); };
}






