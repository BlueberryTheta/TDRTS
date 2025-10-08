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
try {
  console.log('[BOOT] main.js loaded', {
    href: location.href,
    hasModeParam: !!MODE,
  });
} catch {}
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

// --- Shop preview modal (units only) ---
function buildUnitPreviewHtml(key) {
  const ut = UNIT_TYPES[key];
  if (!ut) return '<div class="hint">Unknown unit</div>';
  const abil = (UNIT_ABILITIES[key] || []).map(a => `<span class="ability">${a}</span>`).join('');
  return `
    <span class="close" id="shopPrevClose">×</span>
    <h3>${ut.name} <span class="hint" style="font-weight:normal">$${ut.cost}</span></h3>
    <div class="row"><span>HP</span><span>${ut.hp}</span></div>
    <div class="row"><span>ATK</span><span>${ut.atk}</span></div>
    <div class="row"><span>DEF</span><span>${ut.def ?? 0}</span></div>
    <div class="row"><span>MOVE</span><span>${ut.move}</span></div>
    <div class="row"><span>RANGE</span><span>${ut.range}</span></div>
    <div class="row"><span>SIGHT</span><span>${ut.sight ?? 3}</span></div>
    <div class="abilities">${abil || '<span class="hint">No special abilities</span>'}</div>
    <div class="hint" style="margin-top:6px">Click a highlighted tile on the map to place.</div>
  `;
}

function showShopPreview(unitKey, anchorEl) {
  const box = document.getElementById('shopPreview');
  if (!box) return;
  box.innerHTML = buildUnitPreviewHtml(unitKey);
  box.style.display = 'block';
  // Position near the unit image (thumb) or the button
  const thumb = anchorEl.querySelector ? (anchorEl.querySelector('.thumb') || anchorEl) : anchorEl;
  const r = thumb.getBoundingClientRect();
  const pad = 4;
  // Place above and aligned left by default; clamp to viewport
  const preferredTop = Math.max(8, r.top - (box.offsetHeight || 180) - 8);
  const left = Math.min(window.innerWidth - 280, Math.max(8, r.left));
  box.style.top = `${preferredTop}px`;
  box.style.left = `${left}px`;
  const close = document.getElementById('shopPrevClose');
  if (close) close.onclick = () => hideShopPreview();
}

function hideShopPreview() {
  const box = document.getElementById('shopPreview');
  if (box) box.style.display = 'none';
}

function buildFortPreviewHtml(key) {
  const ft = FORT_TYPES[key];
  if (!ft) return '<div class="hint">Unknown fortification</div>';
  const lines = [];
  lines.push(`<div class="row"><span>HP</span><span>${ft.hp}</span></div>`);
  const atk = ft.atk ?? 0; const rng = ft.range ?? 0;
  lines.push(`<div class="row"><span>ATK</span><span>${atk}</span></div>`);
  lines.push(`<div class="row"><span>RANGE</span><span>${rng}</span></div>`);
  if (typeof ft.income === 'number') lines.push(`<div class="row"><span>Income</span><span>+$${ft.income}/turn</span></div>`);
  return `
    <span class="close" id="shopPrevClose">×</span>
    <h3>${ft.name} <span class="hint" style="font-weight:normal">$${ft.cost}</span></h3>
    ${lines.join('')}
    <div class="hint" style="margin-top:6px">Place near your base (highlighted tiles).</div>
  `;
}

function showFortPreview(fortKey, anchorEl) {
  const box = document.getElementById('shopPreview');
  if (!box) return;
  box.innerHTML = buildFortPreviewHtml(fortKey);
  box.style.display = 'block';
  const thumb = anchorEl.querySelector ? (anchorEl.querySelector('.thumb') || anchorEl) : anchorEl;
  const r = thumb.getBoundingClientRect();
  const left = Math.min(window.innerWidth - 280, Math.max(8, r.left));
  const top = Math.max(8, r.top - (box.offsetHeight || 160) - 8);
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  const close = document.getElementById('shopPrevClose');
  if (close) close.onclick = () => hideShopPreview();
}

// --- Deployed unit/fort preview (press-and-hold) ---
function buildDeployedPreviewHtml(entity) {
  if (!entity) return '<div class="hint">Unknown</div>';
  if (entity.fort) {
    const atk = entity.atk ?? 0; const rng = entity.range ?? 0;
    return `
      <span class="close" id="shopPrevClose">×</span>
      <h3>${entity.type}</h3>
      <div class="row"><span>HP</span><span>${Math.max(0, entity.hp)}/${entity.maxHp ?? entity.hp}</span></div>
      <div class="row"><span>ATK</span><span>${atk}</span></div>
      <div class="row"><span>RANGE</span><span>${rng}</span></div>
    `;
  }
  const abil = (UNIT_ABILITIES[entity.type] || []).map(a => `<span class="ability">${a}</span>`).join('');
  const rk = rankForXP(entity.xp || 0).label;
  return `
    <span class="close" id="shopPrevClose">×</span>
    <h3>${entity.type} <span class="hint" style="font-weight:normal">${entity.player === 0 ? 'P1' : 'P2'}</span></h3>
    <div class="row"><span>HP</span><span>${Math.max(0, entity.hp)}/${entity.maxHp ?? entity.hp}</span></div>
    <div class="row"><span>ATK</span><span>${entity.atk ?? 0}</span></div>
    <div class="row"><span>DEF</span><span>${entity.def ?? 0}</span></div>
    <div class="row"><span>MOVE</span><span>${entity.move ?? '-'}</span></div>
    <div class="row"><span>RANGE</span><span>${entity.range ?? '-'}</span></div>
    <div class="row"><span>SIGHT</span><span>${entity.sight ?? 3}</span></div>
    <div class="row"><span>Rank</span><span>${rk}</span></div>
    <div class="abilities">${abil || '<span class="hint">No special abilities</span>'}</div>
  `;
}

function showDeployedPreviewAt(x, y, clientX, clientY) {
  const box = document.getElementById('shopPreview'); if (!box) return;
  // Prefer unit if present; else fort
  const unit = (game.units || []).find(u => u.x === x && u.y === y);
  const fort = (game.forts || []).find(f => f.x === x && f.y === y);
  const entity = unit || fort;
  if (!entity) return;
  box.innerHTML = buildDeployedPreviewHtml(entity);
  box.style.display = 'block';
  const left = Math.min(window.innerWidth - 280, Math.max(8, clientX + 8));
  const top = Math.min(window.innerHeight - 200, Math.max(8, clientY - 8 - (box.offsetHeight || 160)));
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  const close = document.getElementById('shopPrevClose'); if (close) close.onclick = () => hideShopPreview();
}
try { window.SHOW_DEPLOYED_PREVIEW = (x,y,cx,cy) => { try { showDeployedPreviewAt(x,y,cx,cy); } catch {} }; } catch {}

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

// Move MP game log to bottom on mobile by reparenting it to #right
function placeLogByViewport() {
  try {
    const log = document.getElementById('mpLogPanel');
    if (!log) return;
    const left = document.getElementById('left');
    const right = document.getElementById('right');
    if (window.innerWidth <= 900) {
      if (right && log.parentElement !== right) right.appendChild(log);
    } else {
      // Place back under the canvas in #left
      if (left && log.parentElement !== left) left.appendChild(log);
    }
  } catch {}
}
placeLogByViewport();
window.addEventListener('resize', placeLogByViewport);

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
}

// --- Landing (mode selection) ---
const modeModal = document.getElementById('modeModal');
const playVsAiBtn = document.getElementById('playVsAi');
const playOnlineBtn = document.getElementById('playOnline');
const modeActions = document.querySelector('.mode-actions');
const modeBackBtn = document.getElementById('modeBackBtn');
// Tutorial elements
const playTutorialBtn = document.getElementById('playTutorial');
const tutorialOverlay = document.getElementById('tutorialOverlay');
const tutorialText = document.getElementById('tutorialText');
const tutorialBackBtn = document.getElementById('tutorialBackBtn');
const aiControls = document.getElementById('aiControls');
let __AI_DIFF = 'medium';
try {
  console.log('[BOOT] elements', {
    modeModal: !!modeModal,
    playVsAiBtn: !!playVsAiBtn,
    playOnlineBtn: !!playOnlineBtn,
  });
} catch {}
function setMode(m) {
  try { console.log('[UI] setMode begin', m); } catch {}
  MODE = m;
  dlog('Mode set to', MODE);
  if (MODE === 'ai') {
    // Show difficulty picker first
    if (modeModal) { modeModal.style.display = 'flex'; }
    if (aiControls) aiControls.style.display = 'block';
    const mpCtrls = document.getElementById('mpControls'); if (mpCtrls) mpCtrls.style.display = 'none';
    if (modeActions) modeActions.style.display = 'none';
    if (modeBackBtn) modeBackBtn.style.display = '';
  } else if (MODE === 'mp') {
    // Ensure modal stays open for create/join UI
    if (modeModal) { modeModal.style.display = 'flex'; try { console.log('[UI] show modeModal (mp controls)'); } catch {} }
    const ctrls = document.getElementById('mpControls'); if (ctrls) ctrls.style.display='block';
    if (aiControls) aiControls.style.display = 'none';
    if (modeActions) modeActions.style.display = 'none';
    if (modeBackBtn) modeBackBtn.style.display = '';
    // Initialize multiplayer client (will wire the controls)
    initMultiplayer().catch(err => console.error('MP init failed', err));
  } else if (MODE === 'tutorial') {
    if (modeModal) modeModal.style.display = 'none';
    showTutorial();
  }
  try { console.log('[UI] setMode end', m); } catch {}
}
try { window.__SETMODE = setMode; } catch {}
if (!MODE) {
  if (modeModal) { modeModal.style.display = 'flex'; try { console.log('[BOOT] no MODE param; showing modal'); } catch {} }
} else {
  // Honor URL mode directly on load
  try { console.log('[BOOT] MODE from URL -> setMode', MODE); } catch {}
  setMode(MODE);
}
if (playVsAiBtn) {
  playVsAiBtn.addEventListener('click', (e) => {
    try { console.log('[CLICK] Play vs Computer'); } catch {}
    e.preventDefault();
    setMode('ai');
  });
}
if (playOnlineBtn) {
  playOnlineBtn.addEventListener('click', (e) => {
    try { console.log('[CLICK] Play Online'); } catch {}
    e.preventDefault();
    const ctrls = document.getElementById('mpControls'); if (ctrls) ctrls.style.display='block';
    setMode('mp');
  });
}
if (typeof playTutorialBtn !== 'undefined' && playTutorialBtn) {
  playTutorialBtn.addEventListener('click', (e) => {
    e.preventDefault();
    try { console.log('[CLICK] Tutorial'); } catch {}
    setMode('tutorial');
  });
}
// Back button to return to mode selection root
if (modeBackBtn) {
  modeBackBtn.addEventListener('click', (e) => {
    e.preventDefault();
    try { console.log('[CLICK] Back to mode selection'); } catch {}
    // Hide sub-controls, show root actions
    const mpCtrls = document.getElementById('mpControls'); if (mpCtrls) mpCtrls.style.display = 'none';
    if (aiControls) aiControls.style.display = 'none';
    if (modeActions) modeActions.style.display = 'flex';
    if (modeBackBtn) modeBackBtn.style.display = 'none';
    // Keep modal open
    if (modeModal) modeModal.style.display = 'flex';
    // Reset MODE indicator but don't reload
    MODE = null;
  });
}
// AI difficulty controls
try {
  const diffBtns = document.querySelectorAll('.ai-diff');
  diffBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      __AI_DIFF = btn.getAttribute('data-diff') || 'medium';
      diffBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
  const startBtn = document.getElementById('startAiBtn');
  if (startBtn) startBtn.addEventListener('click', () => {
    try { console.log('[CLICK] Start AI Game diff=', __AI_DIFF); } catch {}
    window.AI_DIFFICULTY = __AI_DIFF;
    if (aiControls) aiControls.style.display = 'none';
    if (modeModal) modeModal.style.display = 'none';
    maybeRunAI();
  });
} catch {}
try {
  // Global error trap for early diagnostics
  window.addEventListener('error', (ev) => {
    try { console.error('[ERR]', ev?.message || ev); } catch {}
  });
} catch {}

// --- Tutorial static instructions ---
function showTutorial() {
  if (!tutorialOverlay || !tutorialText) return;
  tutorialText.innerHTML = buildTutorialContentHtml();
  tutorialOverlay.style.display = 'flex';
}
function hideTutorial() { if (tutorialOverlay) tutorialOverlay.style.display = 'none'; }
if (tutorialBackBtn) {
  tutorialBackBtn.addEventListener('click', (e) => {
    e.preventDefault();
    hideTutorial();
    if (modeModal) modeModal.style.display = 'flex';
    if (modeActions) modeActions.style.display = 'flex';
    if (aiControls) aiControls.style.display = 'none';
    if (modeBackBtn) modeBackBtn.style.display = 'none';
    MODE = null;
  });
}

function buildTutorialContentHtml() {
  const lines = [];
  lines.push('<h3>Objective</h3>');
  lines.push('<p>Capture the enemy flag from their base and bring it back to your base. The game is turn-based: Player 1 goes first.</p>');
  lines.push('<h3>Turn Flow</h3>');
  lines.push('<ul><li>At the start of your turn, you gain $10 plus +$5 per Supply Depot you own.</li><li>Buy and place units/forts near your base (highlighted tiles).</li><li>Move and attack with your units. Each unit can move and attack once per turn (artillery cannot attack adjacent).</li><li>End your turn. Forts like Pillboxes may auto-fire.</li></ul>');
  lines.push('<h3>Tile Highlights</h3>');
  lines.push('<ul>');
  lines.push('<li><strong>Spawn Tiles</strong> (purple): When a shop item is selected, purple tiles around your base show valid placement. Units may also stack on a friendly Bunker tile.</li>');
  lines.push('<li><strong>Engineer Build Tiles</strong> (green): Select an Engineer, choose a fort, then green tiles show where it can build (adjacent).</li>');
  lines.push('<li><strong>Move Range</strong> (blue): Selecting a deployed unit shows where it can move this turn.</li>');
  lines.push('<li><strong>Attack Range</strong> (red): Selecting a deployed unit shows tiles it can attack. Artillery cannot attack adjacent targets.</li>');
  lines.push('<li><strong>Spotted Artillery Tiles</strong> (gold): With a friendly Scout spotting, Artillery can fire beyond its base range at gold-highlighted tiles.</li>');
  lines.push('</ul>');
  lines.push('<h3>Flags</h3>');
  lines.push('<ul>');
  lines.push('<li>Moving onto the enemy flag picks it up. The flag moves with that unit.</li>');
  lines.push('<li>Bring the enemy flag back to your base to win.</li>');
  lines.push('<li>If a flag carrier is destroyed, the flag drops on that tile.</li>');
  lines.push('<li>Your own flag can be picked up by your units only if it has been moved from the base.</li>');
  lines.push('</ul>');
  lines.push('<h3>Fog of War</h3>');
  lines.push('<p>You only see tiles within friendly sight. Scouts extend vision and allow Artillery to fire beyond its base range at spotted tiles.</p>');
  lines.push('<h3>Units</h3>');
  lines.push(buildUnitsTableHtml());
  lines.push('<h3>Fortifications</h3>');
  lines.push(buildFortsTableHtml());
  lines.push('<h3>Tips</h3>');
  lines.push('<ul><li>Use Scouts to spot for Artillery and to reveal hidden enemies.</li><li>Officers add a leadership aura; Medics heal adjacent friendlies at end of turn.</li><li>Engineers can build Bunkers, Pillboxes, Barbed Wire, and Supply Depots.</li><li>Bunkers allow stacking and provide cover; Pillboxes threaten nearby enemies automatically.</li></ul>');
  return lines.join('');
}

function buildUnitsTableHtml() {
  const keys = Object.keys(UNIT_TYPES);
  const rows = keys.map(k => {
    const u = UNIT_TYPES[k];
    const abilList = (UNIT_ABILITIES[k] || []);
    const abil = abilList.length ? abilList.map(a => `<span class="ability">${a}</span>`).join('') : '<span class="hint">No special abilities</span>';
    const img = (typeof UNIT_TO_FILE !== 'undefined' && UNIT_TO_FILE[k]) ? UNIT_TO_FILE[k] : '';
    const title = prettyName(u.name);
    return `
      <div class="tu-row">
        ${img ? `<img class="tu-thumb" src="${img}" alt="${u.name}" />` : `<div class="tu-thumb"></div>`}
        <div class="tu-body">
          <div class="tu-name">${title} <span class="hint" style="font-weight:normal">$${u.cost}</span></div>
          <div class="tu-stats">
            <span class="pair"><span>HP</span><span>${u.hp}</span></span>
            <span class="pair"><span>ATK</span><span>${u.atk}</span></span>
            <span class="pair"><span>DEF</span><span>${u.def ?? 0}</span></span>
            <span class="pair"><span>MOVE</span><span>${u.move}</span></span>
            <span class="pair"><span>RNG</span><span>${u.range}</span></span>
            <span class="pair"><span>SIGHT</span><span>${u.sight ?? 3}</span></span>
          </div>
          <div class="tu-abil">${abil}</div>
        </div>
      </div>
    `;
  });
  return `<div class="tutorial-list">${rows.join('')}</div>`;
}

function buildFortsTableHtml() {
  const keys = Object.keys(FORT_TYPES);
  const rows = keys.map(k => {
    const f = FORT_TYPES[k];
    const parts = [];
    parts.push(`<span class=\"pair\"><span>HP</span><span>${f.hp}</span></span>`);
    if (typeof f.atk === 'number' && f.atk > 0) parts.push(`<span class=\"pair\"><span>ATK</span><span>${f.atk}</span></span>`);
    if (typeof f.range === 'number' && f.range > 0) parts.push(`<span class=\"pair\"><span>RNG</span><span>${f.range}</span></span>`);
    if (typeof f.income === 'number') parts.push(`<span class=\"pair\"><span>Income</span><span>+$${f.income}/turn</span></span>`);
    // Find image from main.js mapping if present
    const img = (typeof FORT_TO_FILE !== 'undefined' && FORT_TO_FILE[k]) ? FORT_TO_FILE[k] : '';
    const title = prettyName(f.name);
    return `
      <div class="tu-row">
        ${img ? `<img class="tu-thumb" src="${img}" alt="${f.name}" />` : `<div class="tu-thumb"></div>`}
        <div class="tu-body">
          <div class="tu-name">${title} <span class="hint" style="font-weight:normal">$${f.cost}</span></div>
          <div class="tu-stats">${parts.join('')}</div>
        </div>
      </div>
    `;
  });
  return `<div class="tutorial-list">${rows.join('')}</div>`;
}

// Display-only prettifier: insert spaces in CamelCase identifiers without changing internal names
function prettyName(name) {
  if (!name || typeof name !== 'string') return name;
  // Specific known cases
  const map = { MechanizedInfantry: 'Mechanized Infantry', BarbedWire: 'Barbed Wire', SupplyDepot: 'Supply Depot' };
  if (map[name]) return map[name];
  return name.replace(/([a-z])([A-Z])/g, '$1 $2');
}

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
    if (SHOW_SHOP_INFO) { try { showShopPreview(type, el); } catch {} }
    const unitType = UNIT_TYPES[type];
    if (!unitType) { dlog('SHOP unitType missing', type); return; }
    game.queueSpawn(unitType);
    dlog('SHOP queued unit', { type });
    return;
  }
  if (fortTypeKey) {
    if (SHOW_SHOP_INFO) { try { showFortPreview(fortTypeKey, el); } catch {} }
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
    const diff = (typeof window !== 'undefined' && window.AI_DIFFICULTY) ? window.AI_DIFFICULTY : 'medium';
    await runAiTurn(game, diff);
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
  if (copyBtn) copyBtn.onclick = () => navigator.clipboard?.writeText(buildInviteLink(roomId));
  const menuBtn = document.getElementById('mpMenuBtn');
  if (menuBtn) menuBtn.onclick = () => {
    const mm = document.getElementById('mpMenuModal');
    if (mm) mm.style.display = 'flex';
  };
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

// Centralized in‑game menu wiring (idempotent)
function wireMpInGameMenu() {
  try {
    const mm = document.getElementById('mpMenuModal'); if (!mm) return;
    const leaveBtn = document.getElementById('mpLeaveBtn');
    const mainBtn = document.getElementById('mpMainBtn');
    const cancelBtn = document.getElementById('mpMenuCancelBtn');
    const closeModal = () => { if (mm) mm.style.display = 'none'; };
    if (cancelBtn && !cancelBtn.__wired) { cancelBtn.addEventListener('click', (e)=>{ e.preventDefault(); closeModal(); }); cancelBtn.__wired = true; }
    if (leaveBtn && !leaveBtn.__wired) {
      leaveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        try { if (window.currentRoomId) localStorage.removeItem('REJOIN_' + window.currentRoomId); localStorage.removeItem('LAST_ROOM'); localStorage.removeItem('LAST_SEAT'); } catch {}
        try { if (mpClient && mpClient.ws && typeof mpClient.ws.close==='function') mpClient.ws.close(); } catch {}
        try { if (mpClient && typeof mpClient.polling === 'boolean') mpClient.polling = false; } catch {}
        try { window.MP_TRANSPORT = undefined; } catch {}
        mpClient = null;
        const banner = document.getElementById('roomBanner'); if (banner) banner.style.display = 'none';
        const modeModal = document.getElementById('modeModal'); if (modeModal) modeModal.style.display = 'flex';
        const modeActions = document.querySelector('.mode-actions'); if (modeActions) modeActions.style.display = 'flex';
        const aiControls = document.getElementById('aiControls'); if (aiControls) aiControls.style.display = 'none';
        const mpCtrls = document.getElementById('mpControls'); if (mpCtrls) mpCtrls.style.display = 'none';
        const backBtn = document.getElementById('modeBackBtn'); if (backBtn) backBtn.style.display = 'none';
        closeModal();
      });
      leaveBtn.__wired = true;
    }
    if (mainBtn && !mainBtn.__wired) {
      mainBtn.addEventListener('click', (e) => {
        e.preventDefault();
        try { if (window.currentRoomId) localStorage.removeItem('REJOIN_' + window.currentRoomId); localStorage.removeItem('LAST_ROOM'); localStorage.removeItem('LAST_SEAT'); } catch {}
        try { if (mpClient && mpClient.ws && typeof mpClient.ws.close==='function') mpClient.ws.close(); } catch {}
        try { if (mpClient && typeof mpClient.polling === 'boolean') mpClient.polling = false; } catch {}
        mpClient = null;
        location.href = location.pathname;
      });
      mainBtn.__wired = true;
    }
    // Close when clicking backdrop
    if (!mm.__backdrop) {
      mm.addEventListener('click', (e) => { if (e.target === mm) closeModal(); });
      mm.__backdrop = true;
    }
  } catch {}
}

// Ensure handlers once DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { try { wireMpInGameMenu(); } catch {} }, { once: true });
} else { try { wireMpInGameMenu(); } catch {} }












// Toggle for shop info
let SHOW_SHOP_INFO = true;
try {
  const saved = localStorage.getItem('SHOP_INFO_ON');
  SHOW_SHOP_INFO = saved == null ? true : saved === '1';
} catch {}
try {
  const t = document.getElementById('shopInfoToggle');
  if (t) {
    t.checked = !!SHOW_SHOP_INFO;
    t.addEventListener('change', () => {
      SHOW_SHOP_INFO = !!t.checked;
      try { localStorage.setItem('SHOP_INFO_ON', SHOW_SHOP_INFO ? '1' : '0'); } catch {}
      if (!SHOW_SHOP_INFO) hideShopPreview();
    });
  }
} catch {}
try { window.HIDE_SHOP_PREVIEW = hideShopPreview; } catch {}

// Hide preview on outside click or Escape
try {
  document.addEventListener('click', (e) => {
    const box = document.getElementById('shopPreview');
    if (!box || box.style.display === 'none') return;
    const path = e.composedPath ? e.composedPath() : [];
    const insidePreview = path.includes(box);
    const inShop = path.some(el => el && el.id === 'shop' || (el && el.classList && el.classList.contains && el.classList.contains('shop-item')));
    if (!insidePreview && !inShop) hideShopPreview();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideShopPreview();
  });
} catch {}
