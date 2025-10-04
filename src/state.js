import { UNIT_TYPES, makeUnit, FORT_TYPES, makeFort, rankForXP } from './units.js';

export class GameState {
  constructor(width, height) {
    this.w = width;
    this.h = height;
    this.turn = 1;
    this.currentPlayer = 0; // 0 or 1
    this.income = 10; // per-turn income
    this.money = [500, 500];

    // Bases near opposite corners, shifted diagonally 1 toward center; flags start on bases
    this.bases = [ { x: 1, y: 1 }, { x: this.w - 2, y: this.h - 2 } ];
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
    // Engineer build queue: build a fort adjacent to selected engineer
    this.buildQueue = null; // { fortType, engineerId }
    // Transient visual effects
    this.effects = [];
    // Aura/heal parameters
    this.auraRadius = 1; // Chebyshev distance
    this.medicHeal = 2; // HP per end of turn
    // Fog of war visibility cache per player
    this.visibility = [new Set(), new Set()];
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

  // --- Fog of War ---
  recomputeVisibility() {
    for (let p = 0; p < 2; p++) {
      const vis = new Set();
      for (const u of this.units) {
        if (u.player !== p) continue;
        const r = u.sight ?? 3;
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            const d = Math.abs(dx) + Math.abs(dy);
            if (d > r) continue;
            const x = u.x + dx, y = u.y + dy;
            if (!this.isInside(x, y)) continue;
            vis.add(`${x},${y}`);
          }
        }
      }
      // Always see own units' tiles
      for (const u of this.units) if (u.player === p) vis.add(`${u.x},${u.y}`);
      // Always see own base tile
      vis.add(`${this.bases[p].x},${this.bases[p].y}`);
      this.visibility[p] = vis;
    }
  }

  isTileVisibleTo(player, x, y) {
    const set = this.visibility[player] || new Set();
    return set.has(`${x},${y}`);
  }

  tileOccupiedByPlayer(x, y, player) {
    return this.units.some(u => u.x === x && u.y === y && u.player === player) ||
           this.forts.some(f => f.x === x && f.y === y && f.player === player);
  }

  tileOccupied(x, y) {
    return this.units.some(u => u.x === x && u.y === y) || this.forts.some(f => f.x === x && f.y === y);
  }

  isFriendlyBunkerAt(x, y, player) {
    const f = this.forts.find(ft => ft.x === x && ft.y === y && ft.type === 'Bunker');
    return !!(f && f.player === player);
  }

  // Passability for a specific unit: cannot pass through any unit or fort, except may enter
  // a tile with a friendly Bunker (stacking). Still cannot enter a tile with any unit present.
  isPassableForUnit(unit, x, y) {
    if (!this.isInside(x, y)) return false;
    if (this.units.some(u => u.x === x && u.y === y)) return false;
    const fort = this.forts.find(f => f.x === x && f.y === y);
    if (!fort) return true;
    return fort.type === 'Bunker' && fort.player === unit.player;
  }

  canSpawnAt(x, y) {
    const { x: bx, y: by } = this.bases[this.currentPlayer];
    const dx = Math.abs(x - bx), dy = Math.abs(y - by);
    const nearBase = Math.max(dx, dy) <= 1; // base tile or any adjacent (including diagonals)
    return this.isInside(x, y) && nearBase && !this.tileOccupied(x, y);
  }

  getSelectedUnit() {
    return this.getUnitById(this.selectedId);
  }

  getValidSpawnTiles() {
    const tiles = [];
    const { x: bx, y: by } = this.bases[this.currentPlayer];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = bx + dx, y = by + dy;
        if (!this.isInside(x, y)) continue;
        if (this.spawnQueue && this.spawnQueue.kind === 'unit') {
          // Allow spawn onto friendly bunker as well
          const unitTileBlocked = this.units.some(u => u.x === x && u.y === y);
          const fort = this.forts.find(f => f.x === x && f.y === y);
          if (!unitTileBlocked && (!fort || (fort.type === 'Bunker' && fort.player === this.currentPlayer))) {
            tiles.push({ x, y });
          }
        } else {
          if (this.canSpawnAt(x, y)) tiles.push({ x, y });
        }
      }
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

  queueFortBuild(fortType) {
    const eng = this.getSelectedUnit();
    if (!eng || eng.player !== this.currentPlayer) return;
    if (eng.type !== 'Engineer') return;
    if (eng.acted) return;
    if (this.money[this.currentPlayer] < fortType.cost) return;
    this.buildQueue = { fortType, engineerId: eng.id };
  }

  trySpawnAt(x, y) {
    if (!this.spawnQueue) return false;
    const id = this.nextId();
    if (this.spawnQueue.kind === 'unit') {
      // For units: allow spawning onto friendly bunker near base (including diagonals)
      const { x: bx, y: by } = this.bases[this.currentPlayer];
      const dx = Math.abs(x - bx), dy = Math.abs(y - by);
      const nearBase = Math.max(dx, dy) <= 1;
      if (!nearBase || !this.isInside(x, y)) return false;
      if (this.units.some(u => u.x === x && u.y === y)) return false;
      const fort = this.forts.find(f => f.x === x && f.y === y);
      if (fort && !(fort.type === 'Bunker' && fort.player === this.currentPlayer)) return false;
      const { unitType } = this.spawnQueue;
      const unit = makeUnit(id, unitType, this.currentPlayer, x, y);
      this.units.push(unit);
      this.money[this.currentPlayer] -= unitType.cost;
    } else if (this.spawnQueue.kind === 'fort') {
      if (!this.canSpawnAt(x, y)) return false;
      const { fortType } = this.spawnQueue;
      const fort = makeFort(id, fortType, this.currentPlayer, x, y);
      this.forts.push(fort);
      this.money[this.currentPlayer] -= fortType.cost;
    }
    this.spawnQueue = null;
    return true;
  }

  canEngineerBuildAt(x, y) {
    if (!this.buildQueue) return false;
    const eng = this.getUnitById(this.buildQueue.engineerId);
    if (!eng) return false;
    if (!this.isInside(x, y)) return false;
    if (this.tileOccupied(x, y)) return false;
    const dx = Math.abs(x - eng.x);
    const dy = Math.abs(y - eng.y);
    const cheb = Math.max(dx, dy);
    return cheb <= 1 && !(dx === 0 && dy === 0);
  }

  getValidEngineerBuildTiles() {
    if (!this.buildQueue) return [];
    const eng = this.getUnitById(this.buildQueue.engineerId);
    if (!eng) return [];
    const tiles = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const x = eng.x + dx, y = eng.y + dy;
        if (this.canEngineerBuildAt(x, y)) tiles.push({ x, y });
      }
    }
    return tiles;
  }

  tryBuildAt(x, y) {
    if (!this.buildQueue) return false;
    if (!this.canEngineerBuildAt(x, y)) return false;
    const eng = this.getUnitById(this.buildQueue.engineerId);
    const { fortType } = this.buildQueue;
    const id = this.nextId();
    const fort = makeFort(id, fortType, this.currentPlayer, x, y);
    this.forts.push(fort);
    this.money[this.currentPlayer] -= fortType.cost;
    if (eng) eng.acted = true;
    this.buildQueue = null;
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
    // Garrisoned units auto-attack nearby enemies (adjacent) while on friendly bunker
    this.garrisonAutoAttack();
    // Medics heal nearby friendlies
    this.medicAutoHeal();
    // Income (base income + SupplyDepot yield for the next player)
    const nextPlayer = (this.currentPlayer + 1) % 2;
    const supplyCount = this.forts.filter(f => f.type === 'SupplyDepot' && f.player === nextPlayer).length;
    const supplyIncome = supplyCount * 5; // each depot yields $5/turn
    this.money[nextPlayer] += this.income + supplyIncome;
    // Next player
    this.currentPlayer = (this.currentPlayer + 1) % 2;
    if (this.currentPlayer === 0) this.turn += 1;
    // Clear selection/spawn
    this.selectedId = null;
    this.spawnQueue = null;
    this.buildQueue = null;
  }

  // Units standing on a friendly bunker auto-attack adjacent enemy units
  garrisonAutoAttack() {
    const deltas = [
      {dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1},
      {dx:1,dy:1},{dx:1,dy:-1},{dx:-1,dy:1},{dx:-1,dy:-1},
    ];
    for (const u of this.units) {
      if (!this.isFriendlyBunkerAt(u.x, u.y, u.player)) continue;
      for (const d of deltas) {
        const tx = u.x + d.dx, ty = u.y + d.dy;
        if (!this.isInside(tx, ty)) continue;
        const enemy = this.units.find(e => e.player !== u.player && e.x === tx && e.y === ty);
        if (!enemy) continue;
        // Fire a suppressed counter attack using a temp attacker (does not consume the unit's action)
        const temp = { ...u, acted: false };
        this.attack(temp, enemy, { suppressCounter: true });
      }
    }
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

  // Spotting: check if any friendly Scout is within N (Manhattan) tiles of a target tile
  hasFriendlyScoutNearTile(x, y, player, radius = 5) {
    for (const u of this.units) {
      if (u.player !== player) continue;
      if (u.type !== 'Scout') continue;
      const d = Math.abs(u.x - x) + Math.abs(u.y - y);
      if (d <= radius) return true;
    }
    return false;
  }

  getArtillerySpottedTiles(unit) {
    if (unit.type !== 'Artillery') return new Set();
    const tiles = new Set();
    const baseRange = unit.range;
    const extendedRange = 10;
    const maxLoop = extendedRange;
    for (let dx = -maxLoop; dx <= maxLoop; dx++) {
      for (let dy = -maxLoop; dy <= maxLoop; dy++) {
        const cheb = Math.max(Math.abs(dx), Math.abs(dy));
        if (cheb === 0) continue;
        const x = unit.x + dx, y = unit.y + dy;
        if (!this.isInside(x, y)) continue;
        const minRange = 2;
        if (cheb > baseRange && cheb <= extendedRange && cheb >= minRange && this.hasFriendlyScoutNearTile(x, y, unit.player, 5)) {
          tiles.add(`${x},${y}`);
        }
      }
    }
    return tiles;
  }

  // --- Officer aura helpers ---
  hasFriendlyOfficerNearby(unit) {
    const rad = this.auraRadius;
    return this.units.some(o => o.type === 'Officer' && o.player === unit.player && Math.max(Math.abs(o.x - unit.x), Math.abs(o.y - unit.y)) <= rad);
  }

  getOfficerBonus(unit) {
    return this.hasFriendlyOfficerNearby(unit) ? 1 : 0;
  }

  moveUnitTo(unit, x, y) {
    if (!this.isPassableForUnit(unit, x, y)) return false;
    unit.x = x; unit.y = y; unit.moved = true;
    // If moved onto a flag
    this.pickupFlagIfAny(unit);
    return true;
  }

  pickupFlagIfAny(unit) {
    // Pick up any flag present on this tile that is not already carried
    for (let i = 0; i < this.flags.length; i++) {
      const flag = this.flags[i];
      if (flag.carriedBy == null && flag.x === unit.x && flag.y === unit.y) {
        flag.carriedBy = unit.id;
        flag.atBase = false;
      }
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
    let { suppressCounter = false } = opts;
    if (attacker.acted) return false;
    // Artillery cannot attack adjacent targets (range <= 1)
    const chebAT = Math.max(Math.abs(attacker.x - target.x), Math.abs(attacker.y - target.y));
    if (!attacker.fort && attacker.type === 'Artillery' && chebAT <= 1) return false;
    // Compute damage with bunker cover if target is a unit standing on friendly bunker
    const atkBonus = attacker.fort ? 0 : (rankForXP(attacker.xp || 0).level + this.getOfficerBonus(attacker)); // forts don't level
    let dmg = (attacker.atk || 0) + atkBonus;
    // Pillbox damage adjustments based on target armor
    if (attacker.fort && attacker.type === 'Pillbox' && !target.fort) {
      const armored = target.type === 'Tank' || target.type === 'MechanizedInfantry';
      if (armored) dmg = Math.max(1, dmg - 2); else dmg += 1;
    }
    // Engineer anti-tank bonus when attacking tanks
    if (!target.fort && attacker.type === 'Engineer' && target.type === 'Tank') {
      dmg += 2;
    }
    if (!target.fort) {
      if (this.isFriendlyBunkerAt(target.x, target.y, target.player)) {
        dmg = Math.max(1, dmg - 2); // bunker cover reduces incoming damage by 2
      }
    }
    target.hp -= dmg;
    if (!target.fort) {
      try { target.hitUntil = (performance && performance.now ? performance.now() : Date.now()) + 200; } catch (_) { target.hitUntil = Date.now() + 200; }
    }
    attacker.acted = true;
    // XP for attacker if it's a unit
    if (!attacker.fort) attacker.xp = (attacker.xp || 0) + 1;

    // Explosion effect for long-range spotted artillery fire
    if (!attacker.fort && attacker.type === 'Artillery') {
      const baseR = attacker.range;
      if (chebAT > baseR && chebAT <= 10 && this.hasFriendlyScoutNearTile(target.x, target.y, attacker.player, 5)) {
        this.spawnExplosion(target.x, target.y, 400);
      }
    }

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
      // Defender counterattacks if still alive (units only).
      // Artillery should not take counter damage when firing at range (> 1 tile)
      if (!attacker.fort && attacker.type === 'Artillery' && chebAT > 1) suppressCounter = true;
      if (!suppressCounter && !target.fort) {
        const defBonus = rankForXP(target.xp || 0).level + this.getOfficerBonus(target);
        let counter = Math.max(0, (target.def || 0) + defBonus);
        // Engineer anti-tank defensive bonus when engaged by tanks
        if (target.type === 'Engineer' && !attacker.fort && attacker.type === 'Tank') {
          counter += 2;
        }
        if (counter > 0) {
          attacker.hp -= counter;
          try { attacker.hitUntil = (performance && performance.now ? performance.now() : Date.now()) + 200; } catch (_) { attacker.hitUntil = Date.now() + 200; }
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
        // XP for defender for engaging in combat and surviving to counter
        if (target.hp > 0) target.xp = (target.xp || 0) + 1;
      }
    }

    // If attacker carries a flag and moved/attacked onto base, check capture
    this.checkFlagCapture(attacker);
    return true;
  }

  spawnExplosion(x, y, durationMs = 350) {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    this.effects.push({ type: 'explosion', x, y, start: now, until: now + durationMs });
  }

  // Auto-fire from pillboxes at end of turn: damages all enemy units in range
  pillboxAutoFire() {
    const pillboxes = this.forts.filter(f => f.type === 'Pillbox' && (f.atk || 0) > 0);
    for (const f of pillboxes) {
      const range = f.range ?? 2;
      for (const u of this.units) {
        if (u.player === f.player) continue; // only enemies
        const cheb = Math.max(Math.abs(u.x - f.x), Math.abs(u.y - f.y));
        if (cheb <= range) {
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

  // Medics heal adjacent friendly units (Chebyshev radius = this.auraRadius)
  medicAutoHeal() {
    const medics = this.units.filter(u => u.type === 'Medic');
    for (const m of medics) {
      for (const u of this.units) {
        if (u.player !== m.player) continue;
        if (u.id === m.id) continue; // optional: skip self-heal; remove to allow
        if (Math.max(Math.abs(u.x - m.x), Math.abs(u.y - m.y)) <= this.auraRadius) {
          if (u.hp > 0 && u.hp < u.maxHp) {
            u.hp = Math.min(u.maxHp, u.hp + this.medicHeal);
          }
        }
      }
    }
  }

  // Compute reachable tiles using BFS over 8-direction (including diagonals), up to unit.move steps.
  // Blocks through any occupied tile (units or forts). Does not include the origin tile.
  getMoveRange(unit) {
    const maxSteps = unit.move;
    const visited = new Set([`${unit.x},${unit.y}`]);
    const result = new Set();
    let frontier = [{ x: unit.x, y: unit.y }];
    for (let step = 0; step < maxSteps; step++) {
      const next = [];
      for (const { x, y } of frontier) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (!this.isInside(nx, ny)) continue;
            // Prevent corner cutting: for diagonal steps, both adjacent orthogonals must be passable
            if (dx !== 0 && dy !== 0) {
              const side1 = this.isPassableForUnit(unit, x + dx, y);
              const side2 = this.isPassableForUnit(unit, x, y + dy);
              if (!(side1 && side2)) continue;
            }
            const key = `${nx},${ny}`;
            if (visited.has(key)) continue;
            visited.add(key);
            if (!this.isPassableForUnit(unit, nx, ny)) continue; // cannot enter/pass
            result.add(key);
            next.push({ x: nx, y: ny });
          }
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
    return result; // Set of "x,y"
  }

  getAttackableTiles(unit) {
    const tiles = new Set();
    // Base attack range
    const baseRange = unit.range;
    const minRange = unit.type === 'Artillery' ? 2 : 1;
    // For artillery, allow extended range if tile is spotted by a friendly Scout
    const extendedRange = unit.type === 'Artillery' ? 10 : baseRange;
    const maxLoop = Math.max(baseRange, extendedRange);
    for (let dx = -maxLoop; dx <= maxLoop; dx++) {
      for (let dy = -maxLoop; dy <= maxLoop; dy++) {
        const cheb = Math.max(Math.abs(dx), Math.abs(dy));
        if (cheb === 0 || cheb > maxLoop) continue;
        const x = unit.x + dx, y = unit.y + dy;
        if (!this.isInside(x, y)) continue;
        // Within base range is always valid
        if (cheb <= baseRange && cheb >= minRange) {
          tiles.add(`${x},${y}`);
        } else if (unit.type === 'Artillery') {
          // Within extended range only if a friendly Scout is within 5 tiles of the target tile
          if (cheb <= extendedRange && cheb >= minRange && this.hasFriendlyScoutNearTile(x, y, unit.player, 5)) {
            tiles.add(`${x},${y}`);
          }
        }
      }
    }
    return tiles;
  }
}
