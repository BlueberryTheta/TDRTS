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

  getValidSpawnTiles() {
    const tiles = [];
    const { x: bx, y: by } = this.bases[this.currentPlayer];
    const candidates = [
      { x: bx, y: by },
      { x: bx + 1, y: by },
      { x: bx - 1, y: by },
      { x: bx, y: by + 1 },
      { x: bx, y: by - 1 },
    ];
    for (const t of candidates) {
      if (this.canSpawnAt(t.x, t.y)) tiles.push(t);
    }
    return tiles;
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
    // Fortifications end-of-turn effects (pillbox auto-fire)
    this.pillboxAutoFire();
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
    if (this.tileOccupied(x, y)) return false;
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

  attack(attacker, target, opts = {}) {
    const { suppressCounter = false } = opts;
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
    } else {
      // Defender counterattacks if still alive (units only)
      if (!suppressCounter && !target.fort) {
        const counter = Math.max(0, target.def || 0);
        if (counter > 0) {
          attacker.hp -= counter;
          // If attacker carried a flag, drop it on their tile before removal
          const attEnemyFlag = this.flags[(attacker.player + 1) % 2];
          if (attacker.hp <= 0) {
            if (attEnemyFlag.carriedBy === attacker.id) {
              this.dropFlagAt(attacker, attacker.x, attacker.y);
            }
            const ai = this.units.findIndex(u => u.id === attacker.id);
            if (ai >= 0) this.units.splice(ai, 1);
          }
        }
      }
    }

    // If attacker carries a flag and moved/attacked onto base, check capture
    this.checkFlagCapture(attacker);
    return true;
  }

  // Auto-fire from pillboxes at end of turn: damages all enemy units in range
  pillboxAutoFire() {
    const pillboxes = this.forts.filter(f => f.type === 'Pillbox' && (f.atk || 0) > 0);
    for (const f of pillboxes) {
      const range = f.range ?? 2;
      for (const u of this.units) {
        if (u.player === f.player) continue; // only enemies
        const d = Math.abs(u.x - f.x) + Math.abs(u.y - f.y);
        if (d <= range) {
          // Use attack path with suppressCounter to avoid units damaging pillbox back
          // Temporarily give fort an atk field if absent
          const atkVal = f.atk ?? 0;
          if (atkVal <= 0) continue;
          const temp = { ...f, atk: atkVal, acted: false };
          this.attack(temp, u, { suppressCounter: true });
        }
      }
    }
  }

  // Compute reachable tiles using BFS over orthogonal neighbors, up to unit.move steps.
  // Blocks through any occupied tile (units or forts). Does not include the origin tile.
  getMoveRange(unit) {
    const maxSteps = unit.move;
    const visited = new Set([`${unit.x},${unit.y}`]);
    const result = new Set();
    let frontier = [{ x: unit.x, y: unit.y, d: 0 }];
    const push = (nx, ny, d) => {
      const key = `${nx},${ny}`;
      if (visited.has(key)) return;
      visited.add(key);
      // If occupied, we cannot enter or pass through
      if (this.tileOccupied(nx, ny)) return;
      result.add(key);
      frontierNext.push({ x: nx, y: ny, d });
    };
    for (let step = 0; step < maxSteps; step++) {
      const frontierNext = [];
      for (const { x, y } of frontier) {
        const nbs = [
          { x: x + 1, y },
          { x: x - 1, y },
          { x, y: y + 1 },
          { x, y: y - 1 },
        ];
        for (const nb of nbs) {
          if (!this.isInside(nb.x, nb.y)) continue;
          push(nb.x, nb.y, step + 1);
        }
      }
      frontier = frontierNext;
      if (frontier.length === 0) break;
    }
    return result; // Set of "x,y"
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
