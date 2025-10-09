import { UNIT_TYPES, FORT_TYPES } from './units.js';

// Basic heuristic AI for Player 2 (index 1)
// - Buys a unit if it has money, prefers Tank > Artillery > Infantry
// - Spawns near its base, leaning toward the enemy base
// - For each unit: attack if enemy in range, else move toward enemy base/flag

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function distance(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

// (replaced by difficulty-aware pickPurchase)

// (replaced by difficulty-aware pickSpawnTile)

// (replaced by difficulty-aware bestMoveToward)

function tryAttack(game, unit) {
  const atks = game.getAttackableTiles(unit);
  for (const key of atks) {
    const [x, y] = key.split(',').map(Number);
    const enemy = game.getEnemyAt(x, y);
    if (enemy) { game.attack(unit, enemy); return true; }
    const fort = game.getFortAt(x, y);
    if (fort && fort.player !== unit.player) { game.attack(unit, fort); return true; }
  }
  return false;
}

export async function runAiTurn(game, difficulty = 'medium') {
  if (game.currentPlayer !== 1) return; // Only act for Player 2
  if (game.isGameOver) return;

  const diff = (typeof difficulty === 'string') ? difficulty.toLowerCase() : 'medium';
  const delayShort = diff === 'hard' ? 80 : diff === 'easy' ? 220 : 150;
  const delayLong = diff === 'hard' ? 120 : diff === 'easy' ? 300 : 200;

  // 0) Economy/build logic (simple): early Supply Depot; Pillbox when pressured
  maybeEconomyActions(game, diff);

  // 1) Buy and spawn if possible (diff-dependent)
  const choice = pickPurchase(game, diff);
  if (choice) {
    game.queueSpawn(choice);
    const tile = pickSpawnTile(game, diff);
    if (tile) game.trySpawnAt(tile.x, tile.y);
  }

  await sleep(delayLong);

  // 2) For each AI unit: attack/move based on difficulty
  const enemyBase = game.bases[0];
  const threatMap = computeThreatMap(game, 1);
  const aiUnits = game.units.filter((u) => u.player === 1);
  for (const u of aiUnits) {
    if (game.isGameOver) break;
    if (game.currentPlayer !== 1) break;
    // Detect if this unit is carrying any flag (enemy or own)
    let carrying = false;
    try {
      const ef = game.flags[(u.player + 1) % 2];
      const mf = game.flags[u.player];
      carrying = (ef && ef.carriedBy === u.id) || (mf && mf.carriedBy === u.id);
    } catch {}
    // Attack first if in range (hard/medium); easy: 60% chance to try attack first
    const tryFirst = carrying ? false : (diff === 'easy' ? (Math.random() < 0.6) : true);
    if (tryFirst && !u.acted && tryAttackSmart(game, u, diff)) {
      await sleep(delayShort);
      continue;
    }
    // Move toward a target
    if (!u.moved) {
      const target = pickMoveTarget(game, u, diff, enemyBase);
      const step = bestMoveToward(game, u, target, diff, { threatMap });
      if (step) {
        game.moveUnitTo(u, step.x, step.y);
        game.checkFlagCapture(u);
      }
    }
    // Try attack after moving (skip if carrying to prioritize returning)
    if (!carrying && !u.acted) tryAttackSmart(game, u, diff);
    await sleep(delayShort);
  }

  // 3) End AI turn
  await sleep(delayLong);
  if (game.currentPlayer === 1) game.endTurn();
}

// Difficulty-aware helpers
function pickPurchase(game, diff='medium') {
  const money = game.money[1];
  if (diff === 'easy') {
    if (money >= UNIT_TYPES.Infantry.cost && Math.random() < 0.7) return UNIT_TYPES.Infantry;
    if (money >= UNIT_TYPES.Scout.cost && Math.random() < 0.3) return UNIT_TYPES.Scout;
    return null;
  }
  if (diff === 'hard') {
    if (money >= UNIT_TYPES.Tank.cost) return UNIT_TYPES.Tank;
    if (money >= UNIT_TYPES.Artillery.cost) return UNIT_TYPES.Artillery;
    if (money >= UNIT_TYPES.Officer.cost && Math.random() < 0.5) return UNIT_TYPES.Officer;
    if (money >= UNIT_TYPES.Scout.cost && Math.random() < 0.6) return UNIT_TYPES.Scout;
    if (money >= UNIT_TYPES.Infantry.cost) return UNIT_TYPES.Infantry;
    return null;
  }
  // medium (default)
  if (money >= UNIT_TYPES.Tank.cost) return UNIT_TYPES.Tank;
  if (money >= UNIT_TYPES.Artillery.cost) return UNIT_TYPES.Artillery;
  if (money >= UNIT_TYPES.Infantry.cost) return UNIT_TYPES.Infantry;
  return null;
}

function pickSpawnTile(game, diff='medium') {
  const base = game.bases[1];
  const enemyBase = game.bases[0];
  const candidates = [
    { x: base.x, y: base.y },
    { x: base.x + 1, y: base.y },
    { x: base.x - 1, y: base.y },
    { x: base.x, y: base.y + 1 },
    { x: base.x, y: base.y - 1 },
  ];
  const valid = candidates.filter((t) => game.canSpawnAt(t.x, t.y));
  if (valid.length === 0) return null;
  valid.sort((a, b) => distance(a.x, a.y, enemyBase.x, enemyBase.y) - distance(b.x, b.y, enemyBase.x, enemyBase.y));
  if (diff === 'easy') return valid[Math.min(valid.length - 1, 2)]; // not the most optimal
  return valid[0];
}

function pickMoveTarget(game, unit, diff, enemyBase) {
  // If carrying any flag (enemy or own), head to our base to score/return
  try {
    const myBase = game.bases[unit.player];
    const enemyFlag = game.flags[(unit.player + 1) % 2];
    const myFlag = game.flags[unit.player];
    const carryingEnemy = enemyFlag && enemyFlag.carriedBy === unit.id;
    const carryingOwn = myFlag && myFlag.carriedBy === unit.id;
    if (carryingEnemy || carryingOwn) return { x: myBase.x, y: myBase.y };
  } catch {}

  // If our flag is being carried by enemy, try to intercept (hard/medium)
  try {
    const myFlag = game.flags[unit.player];
    if (myFlag && myFlag.carriedBy != null && diff !== 'easy') {
      const carrier = game.getUnitById(myFlag.carriedBy);
      if (carrier) return { x: carrier.x, y: carrier.y };
    }
  } catch {}

  // Default objective: head toward enemy flag position (or base if at base)
  try {
    const enemyFlag = game.flags[(unit.player + 1) % 2];
    if (enemyFlag && enemyFlag.carriedBy == null) return { x: enemyFlag.x, y: enemyFlag.y };
  } catch {}

  // hard: prefer nearest enemy unit; medium: enemy base; easy: jittered toward base
  if (diff === 'hard') {
    let best = null, bestD = 1e9;
    for (const e of game.units) {
      if (e.player !== 0) continue;
      const d = distance(unit.x, unit.y, e.x, e.y);
      if (d < bestD) { best = { x: e.x, y: e.y }; bestD = d; }
    }
    return best || enemyBase;
  }
  if (diff === 'easy') {
    const jitter = () => (Math.random() < 0.5 ? -1 : 1);
    return { x: enemyBase.x + jitter(), y: enemyBase.y + jitter() };
  }
  return enemyBase;
}

function bestMoveToward(game, unit, target, diff='medium', { threatMap } = {}) {
  const movesSet = game.getMoveRange(unit);
  const moves = Array.from(movesSet).map(k => k.split(',').map(Number));
  if (moves.length === 0) return null;
  // Exclude tiles with enemies/forts
  const filtered = moves.filter(([x,y]) => !game.getEnemyAt(x,y) && !game.getFortAt(x,y));
  if (!filtered.length) return null;
  // Easy: distance-first with slight randomness
  if (diff === 'easy') {
    filtered.sort((a, b) => distance(a[0], a[1], target.x, target.y) - distance(b[0], b[1], target.x, target.y));
    // pick from top 3 with randomness
    const k = Math.min(2, filtered.length - 1);
    return { x: filtered[k][0], y: filtered[k][1] };
  }
  // Medium/Hard: score tiles using threat map, cover, and ally proximity
  const scored = filtered.map(([x,y]) => ({ x, y, score: scoreTile(game, unit, x, y, target, threatMap, diff) }));
  scored.sort((a, b) => b.score - a.score);
  return { x: scored[0].x, y: scored[0].y };
}

function tryAttackSmart(game, unit, diff='medium') {
  // hard: prioritize lowest hp target; easy: 50% chance to skip attack
  if (diff === 'easy' && Math.random() < 0.4) return false;
  const atks = game.getAttackableTiles(unit);
  let chosen = null;
  if (diff === 'hard') {
    let bestScore = -1;
    for (const key of atks) {
      const [x,y] = key.split(',').map(Number);
      const enemy = game.getEnemyAt(x, y) || game.getFortAt(x, y);
      if (!enemy) continue;
      const score = (enemy.fort ? 0 : 10) + Math.max(0, (enemy.maxHp || 10) - (enemy.hp || 0));
      if (score > bestScore) { bestScore = score; chosen = { x, y }; }
    }
  } else {
    for (const key of atks) {
      const [x,y] = key.split(',').map(Number);
      const enemy = game.getEnemyAt(x, y) || game.getFortAt(x, y);
      if (enemy) { chosen = { x, y }; break; }
    }
  }
  if (!chosen) return false;
  const enemy = game.getEnemyAt(chosen.x, chosen.y) || game.getFortAt(chosen.x, chosen.y);
  if (!enemy) return false;
  game.attack(unit, enemy);
  return true;
}


// --- Threat-aware helpers ---
function computeThreatMap(game, forPlayer = 1) {
  // Map of tile key -> number of distinct enemy threats that can hit this tile
  const map = new Map();
  const add = (k) => map.set(k, (map.get(k) || 0) + 1);
  for (const u of game.units) {
    if (u.player === forPlayer) continue;
    try {
      for (const key of game.getAttackableTiles(u)) add(key);
    } catch {}
  }
  // Include Pillbox fort threat (Chebyshev range)
  for (const f of game.forts) {
    if (f.player === forPlayer) continue;
    if (f.type !== 'Pillbox') continue;
    const range = f.range ?? 2;
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        const x = f.x + dx, y = f.y + dy;
        if (!game.isInside(x, y)) continue;
        const cheb = Math.max(Math.abs(dx), Math.abs(dy));
        if (cheb > 0 && cheb <= range) add(`${x},${y}`);
      }
    }
  }
  return map;
}

function scoreTile(game, unit, x, y, target, threatMap, diff) {
  // Higher score is better
  let score = 0;
  // Approach objective strongly; reward progress relative to current tile
  const dNew = distance(x, y, target.x, target.y);
  const dCur = distance(unit.x, unit.y, target.x, target.y);
  // Base pull to objective (stronger than before)
  score += 80 - (2 * dNew);
  // Reward moving closer, penalize moving away
  score += (dCur - dNew) * 6; // +6 per step closer, -6 per step away

  // Threat penalty scaled by number of threats; reduced for Tanks and on Bunkers
  const key = `${x},${y}`;
  const threatCount = threatMap ? (threatMap.get(key) || 0) : 0;
  if (threatCount > 0) {
    const typeFactor = unit.type === 'Tank' ? 0.6 : 1.0;
    const bunker = game.isFriendlyBunkerAt(x, y, unit.player);
    const basePenalty = (diff === 'hard' ? 6 : 4) * typeFactor * (bunker ? 0.5 : 1);
    const penalty = Math.min( (diff === 'hard' ? 18 : 12), basePenalty * threatCount);
    score -= penalty;
  }

  // Cover bonus: friendly bunker
  if (game.isFriendlyBunkerAt(x, y, unit.player)) score += 8;

  // Officer aura bonus (if near after moving)
  try { if (game.hasFriendlyOfficerNearby({ ...unit, x, y })) score += 3; } catch {}

  // Opportunity to attack after moving (approximate by range/chebyshev)
  try {
    const range = unit.range || 1;
    const minRange = unit.type === 'Artillery' ? 2 : 1;
    let canThreaten = false;
    for (const e of game.units) {
      if (e.player === unit.player) continue;
      const cheb = Math.max(Math.abs(e.x - x), Math.abs(e.y - y));
      if (cheb >= minRange && cheb <= range) { canThreaten = true; break; }
    }
    if (canThreaten) score += (diff === 'hard' ? 8 : 5);
  } catch {}

  // Ally proximity bonus (prefer grouping lightly)
  let allies = 0;
  for (const a of game.units) {
    if (a.player !== unit.player || a.id === unit.id) continue;
    const cheb = Math.max(Math.abs(a.x - x), Math.abs(a.y - y));
    if (cheb <= 2) allies++;
  }
  score += Math.min(2, allies); // up to +2

  // Big bonus for stepping onto own base while carrying a flag (handled by target too)
  try {
    const myBase = game.bases[unit.player];
    const ef = game.flags[(unit.player + 1) % 2];
    const mf = game.flags[unit.player];
    if ((ef && ef.carriedBy === unit.id) || (mf && mf.carriedBy === unit.id)) {
      if (x === myBase.x && y === myBase.y) score += 100;
    }
  } catch {}

  return score;
}

// --- Simple economy/build logic ---
function maybeEconomyActions(game, diff='medium') {
  if (game.currentPlayer !== 1) return;
  const money = game.money[1] || 0;
  const base = game.bases[1];

  // Early Supply Depot (once), prefer first 6 turns
  const hasDepot = game.forts.some(f => f.player === 1 && f.type === 'SupplyDepot');
  if (!hasDepot && game.turn <= 6 && money >= (FORT_TYPES.SupplyDepot.cost || 150)) {
    try {
      game.queueFort(FORT_TYPES.SupplyDepot);
      const tile = pickSpawnTileFacingEnemy(game) || pickSpawnTile(game, diff);
      if (tile) game.trySpawnAt(tile.x, tile.y);
      return; // only one economy action per turn
    } catch {}
  }

  // Pillbox when pressured near base (distance <= 4) and none adjacent to base
  const pressured = isUnderPressure(game, 1, 4);
  const hasPillNearBase = game.forts.some(f => f.player === 1 && f.type === 'Pillbox' && Math.max(Math.abs(f.x - base.x), Math.abs(f.y - base.y)) <= 1);
  if (pressured && !hasPillNearBase && money >= (FORT_TYPES.Pillbox.cost || 80)) {
    try {
      game.queueFort(FORT_TYPES.Pillbox);
      const tile = pickSpawnTileFacingEnemy(game) || pickSpawnTile(game, diff);
      if (tile) game.trySpawnAt(tile.x, tile.y);
    } catch {}
  }
}

function isUnderPressure(game, player = 1, radius = 4) {
  const base = game.bases[player];
  for (const u of game.units) {
    if (u.player === player) continue;
    const cheb = Math.max(Math.abs(u.x - base.x), Math.abs(u.y - base.y));
    if (cheb <= radius) return true;
  }
  return false;
}

function pickSpawnTileFacingEnemy(game) {
  const base = game.bases[1];
  const candidates = [
    { x: base.x, y: base.y },
    { x: base.x + 1, y: base.y },
    { x: base.x - 1, y: base.y },
    { x: base.x, y: base.y + 1 },
    { x: base.x, y: base.y - 1 },
  ];
  const valids = candidates.filter(t => game.canSpawnAt(t.x, t.y));
  if (!valids.length) return null;
  // Prefer tile closer to nearest enemy to face pressure
  const nearestEnemyDist = (x, y) => {
    let best = 1e9;
    for (const u of game.units) {
      if (u.player !== 0) continue;
      const d = Math.max(Math.abs(u.x - x), Math.abs(u.y - y));
      if (d < best) best = d;
    }
    return best;
  };
  valids.sort((a, b) => nearestEnemyDist(a.x, a.y) - nearestEnemyDist(b.x, b.y));
  return valids[0];
}
