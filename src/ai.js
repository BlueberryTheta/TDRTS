import { UNIT_TYPES } from './units.js';

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
  const aiUnits = game.units.filter((u) => u.player === 1);
  for (const u of aiUnits) {
    if (game.isGameOver) break;
    if (game.currentPlayer !== 1) break;
    // Attack first if in range (hard/medium); easy: 60% chance to try attack first
    const tryFirst = diff === 'easy' ? (Math.random() < 0.6) : true;
    if (tryFirst && !u.acted && tryAttackSmart(game, u, diff)) {
      await sleep(delayShort);
      continue;
    }
    // Move toward a target
    if (!u.moved) {
      const target = pickMoveTarget(game, u, diff, enemyBase);
      const step = bestMoveToward(game, u, target, diff);
      if (step) {
        game.moveUnitTo(u, step.x, step.y);
        game.checkFlagCapture(u);
      }
    }
    // Try attack after moving
    if (!u.acted) tryAttackSmart(game, u, diff);
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

function bestMoveToward(game, unit, target, diff='medium') {
  const movesSet = game.getMoveRange(unit);
  const moves = Array.from(movesSet).map(k => k.split(',').map(Number));
  if (moves.length === 0) return null;
  // Exclude tiles with enemies/forts
  const filtered = moves.filter(([x,y]) => !game.getEnemyAt(x,y) && !game.getFortAt(x,y));
  if (!filtered.length) return null;
  filtered.sort((a, b) => distance(a[0], a[1], target.x, target.y) - distance(b[0], b[1], target.x, target.y));
  if (diff === 'easy') {
    // pick from top 3 with randomness
    const k = Math.min(2, filtered.length - 1);
    return { x: filtered[k][0], y: filtered[k][1] };
  }
  return { x: filtered[0][0], y: filtered[0][1] };
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

