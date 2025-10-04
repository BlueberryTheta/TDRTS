import { UNIT_TYPES } from './units.js';

// Basic heuristic AI for Player 2 (index 1)
// - Buys a unit if it has money, prefers Tank > Artillery > Infantry
// - Spawns near its base, leaning toward the enemy base
// - For each unit: attack if enemy in range, else move toward enemy base/flag

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function distance(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function pickPurchase(game) {
  const money = game.money[1];
  if (money >= UNIT_TYPES.Tank.cost) return UNIT_TYPES.Tank;
  if (money >= UNIT_TYPES.Artillery.cost) return UNIT_TYPES.Artillery;
  if (money >= UNIT_TYPES.Infantry.cost) return UNIT_TYPES.Infantry;
  return null;
}

function pickSpawnTile(game) {
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
  return valid[0];
}

function bestMoveToward(game, unit, target) {
  const moves = Array.from(game.getMoveRange(unit));
  if (moves.length === 0) return null;
  // Exclude tiles with enemies (AI mirrors player movement rule)
  const filtered = moves
    .map((k) => k.split(',').map(Number))
    .filter(([x, y]) => !game.getEnemyAt(x, y) && !game.getFortAt(x, y));
  if (filtered.length === 0) return null;
  filtered.sort((a, b) => distance(a[0], a[1], target.x, target.y) - distance(b[0], b[1], target.x, target.y));
  return { x: filtered[0][0], y: filtered[0][1] };
}

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

export async function runAiTurn(game) {
  if (game.currentPlayer !== 1) return; // Only act for Player 2
  if (game.isGameOver) return;

  // 1) Buy and spawn if possible
  const choice = pickPurchase(game);
  if (choice) {
    game.queueSpawn(choice);
    const tile = pickSpawnTile(game);
    if (tile) game.trySpawnAt(tile.x, tile.y);
  }

  await sleep(250);

  // 2) For each AI unit: attack if possible, else move toward enemy base/flag and then try to attack
  const enemyBase = game.bases[0];
  const aiUnits = game.units.filter((u) => u.player === 1);
  for (const u of aiUnits) {
    if (game.isGameOver) break;
    if (game.currentPlayer !== 1) break;
    // Attack first if in range
    if (!u.acted && tryAttack(game, u)) {
      await sleep(150);
      continue;
    }
    // Move toward target
    if (!u.moved) {
      const target = enemyBase; // simple target; could be enemy flag carrier
      const step = bestMoveToward(game, u, target);
      if (step) {
        game.moveUnitTo(u, step.x, step.y);
        game.checkFlagCapture(u);
      }
    }
    // Try attack after moving
    if (!u.acted) tryAttack(game, u);
    await sleep(150);
  }

  // 3) End AI turn
  await sleep(200);
  if (game.currentPlayer === 1) game.endTurn();
}
