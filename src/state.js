import { UNIT_TYPES, makeUnit, FORT_TYPES, makeFort } from './units.js';

export class GameState {
  constructor(width, height) {
    this.w = width;
    this.h = height;
    this.turn = 1;
    this.currentPlayer = 0; // 0 or 1
    this.income = 50;
    this.money = [100, 100];

    // Bases at opposite corners; flags start on bases
    this.bases = [ { x: 0, y: 0 }, { x: this.w - 1, y: this.h - 1 } ];
    this.flags = [
      { atBase: true, carriedBy: null, x: this.bases[0].x, y: this.bases[0].y },
      { atBase: true, carriedBy: null, x: this.bases[1].x, y: this.bases[1].y },
    ];

    // Units array
    this.units = [];
    this._unitId = 1;

    // Fortifications array
    this.forts = [];

    // Selected unit id
    this.selectedId = null;

    // Spawn queue: unit type selected from shop; expect a tile click near base to place
    this.spawnQueue = null; // { unitType }
  }

  nextId() { return this._unitId++; }

  getUnitsAt(x, y) {
    return this.units.filter(u => u.x === x && u.y === y);
  }

  getUnitById(id) {
    return this.units.find(u => u.id === id) || null;
  }

  isInside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  tileOccupiedByPlayer(x, y, player) {
    return this.units.some(u => u.x === x && u.y === y && u.player === player) ||
           this.forts.some(f => f.x === x && f.y === y && f.player === player);
  }

  tileOccupied(x, y) {
    return this.units.some(u => u.x === x && u.y === y) || this.forts.some(f => f.x === x && f.y === y);
  }

  canSpawnAt(x, y) {
    const { x: bx, y: by } = this.bases[this.currentPlayer];
    const dx = Math.abs(x - bx), dy = Math.abs(y - by);
    const nearBase = (dx + dy) <= 1; // base tile or orthogonal neighbor
    return this.isInside(x, y) && nearBase && !this.tileOccupied(x, y);
  }

  queueSpawn(unitType) {
    if (this.money[this.currentPlayer] < unitType.cost) return;
    this.spawnQueue = { kind: 'unit', unitType };
  }

  queueFort(fortType) {
    if (this.money[this.currentPlayer] < fortType.cost) return;
    this.spawnQueue = { kind: 'fort', fortType };
  }

  trySpawnAt(x, y) {
    if (!this.spawnQueue) return false;
    if (!this.canSpawnAt(x, y)) return false;
    const id = this.nextId();
    if (this.spawnQueue.kind === 'unit') {
      const { unitType } = this.spawnQueue;
      const unit = makeUnit(id, unitType, this.currentPlayer, x, y);
      this.units.push(unit);
      this.money[this.currentPlayer] -= unitType.cost;
    } else if (this.spawnQueue.kind === 'fort') {
      const { fortType } = this.spawnQueue;
      const fort = makeFort(id, fortType, this.currentPlayer, x, y);
      this.forts.push(fort);
      this.money[this.currentPlayer] -= fortType.cost;
    }
    this.spawnQueue = null;
    return true;
  }

  endTurn() {
    // Reset units' action state for the next player
    this.units.forEach(u => {
      if (u.player === this.currentPlayer) {
        // Current player's units have completed their turn; nothing to do
      } else {
        // Next player's units will be ready to act
        u.moved = false;
        u.acted = false;
      }
    });
    // Income
    this.money[(this.currentPlayer + 1) % 2] += this.income;
    // Next player
    this.currentPlayer = (this.currentPlayer + 1) % 2;
    if (this.currentPlayer === 0) this.turn += 1;
    // Clear selection/spawn
    this.selectedId = null;
    this.spawnQueue = null;
  }

  selectUnitAt(x, y) {
    const unit = this.units.find(u => u.x === x && u.y === y && u.player === this.currentPlayer);
    this.selectedId = unit ? unit.id : null;
  }

  getEnemyAt(x, y) {
    return this.units.find(u => u.x === x && u.y === y && u.player !== this.currentPlayer) || null;
  }

  getFortAt(x, y) {
    return this.forts.find(f => f.x === x && f.y === y) || null;
  }

  moveUnitTo(unit, x, y) {
    if (!this.isInside(x, y)) return false;
    if (this.tileOccupiedByPlayer(x, y, unit.player)) return false;
    unit.x = x; unit.y = y; unit.moved = true;
    // If moved onto a flag
    this.pickupFlagIfAny(unit);
    return true;
  }

  pickupFlagIfAny(unit) {
    const enemyFlag = this.flags[(unit.player + 1) % 2];
    if (enemyFlag.carriedBy == null && enemyFlag.x === unit.x && enemyFlag.y === unit.y) {
      enemyFlag.carriedBy = unit.id;
    }
  }

  dropFlagAt(unit, x, y) {
    const enemyFlag = this.flags[(unit.player + 1) % 2];
    if (enemyFlag.carriedBy === unit.id) {
      enemyFlag.carriedBy = null;
      enemyFlag.x = x; enemyFlag.y = y; enemyFlag.atBase = false;
    }
  }

  checkFlagCapture(unit) {
    const enemyFlag = this.flags[(unit.player + 1) % 2];
    const myBase = this.bases[unit.player];
    if (enemyFlag.carriedBy === unit.id && unit.x === myBase.x && unit.y === myBase.y) {
      // Captured! Reset enemy flag to its base and give a reward / announce win.
      const enemyBase = this.bases[(unit.player + 1) % 2];
      enemyFlag.atBase = true;
      enemyFlag.carriedBy = null;
      enemyFlag.x = enemyBase.x; enemyFlag.y = enemyBase.y;
      // Simple reward/notification for now
      this.money[unit.player] += 100;
      // In a full game, trigger win state here
    }
  }

  attack(attacker, target) {
    if (attacker.acted) return false;
    target.hp -= attacker.atk;
    attacker.acted = true;

    // If target carried our flag, drop it on target tile
    const targetEnemyFlag = this.flags[(target.player + 1) % 2];
    if (targetEnemyFlag.carriedBy === target.id) {
      this.dropFlagAt(target, target.x, target.y);
    }

    if (target.hp <= 0) {
      // Remove dead unit or fort
      if (target.fort) {
        const fi = this.forts.findIndex(f => f.id === target.id);
        if (fi >= 0) this.forts.splice(fi, 1);
      } else {
        const idx = this.units.findIndex(u => u.id === target.id);
        if (idx >= 0) this.units.splice(idx, 1);
      }
    }

    // If attacker carries a flag and moved/attacked onto base, check capture
    this.checkFlagCapture(attacker);
    return true;
  }

  // Compute reachable tiles for a unit via Manhattan distance and empty tiles
  getMoveRange(unit) {
    const range = new Set();
    const maxD = unit.move;
    for (let dx = -maxD; dx <= maxD; dx++) {
      for (let dy = -maxD; dy <= maxD; dy++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d > maxD) continue;
        const x = unit.x + dx, y = unit.y + dy;
        if (!this.isInside(x, y)) continue;
        if (this.tileOccupiedByPlayer(x, y, unit.player)) continue;
        // Allow moving onto enemy tile only if we intend to attack instead (handled in input)
        range.add(`${x},${y}`);
      }
    }
    return range; // Set of "x,y"
  }

  getAttackableTiles(unit) {
    const tiles = new Set();
    const maxD = unit.range;
    for (let dx = -maxD; dx <= maxD; dx++) {
      for (let dy = -maxD; dy <= maxD; dy++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d > maxD || d === 0) continue;
        const x = unit.x + dx, y = unit.y + dy;
        if (!this.isInside(x, y)) continue;
        tiles.add(`${x},${y}`);
      }
    }
    return tiles;
  }
}
