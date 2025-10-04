export const UNIT_TYPES = {
  Infantry: { name: 'Infantry', hp: 10, atk: 4, def: 2, move: 3, range: 1, sight: 4, cost: 50, color: '#58a6ff' },
  Scout: { name: 'Scout', hp: 8, atk: 2, def: 1, move: 4, range: 1, sight: 6, cost: 70, color: '#94e2ff' },
  Engineer: { name: 'Engineer', hp: 10, atk: 3, def: 1, move: 3, range: 1, sight: 3, cost: 80, color: '#7ee787' },
  Medic: { name: 'Medic', hp: 8, atk: 1, def: 1, move: 3, range: 1, sight: 3, cost: 90, color: '#56d364' },
  Officer: { name: 'Officer', hp: 10, atk: 4, def: 2, move: 2, range: 2, sight: 3, cost: 120, color: '#a5d6ff' },
  MechanizedInfantry: { name: 'MechanizedInfantry', hp: 14, atk: 5, def: 2, move: 3, range: 1, sight: 4, cost: 160, color: '#4aa3ff' },
  Tank: { name: 'Tank', hp: 18, atk: 7, def: 3, move: 2, range: 1, sight: 4, cost: 180, color: '#1f6feb' },
  Artillery: { name: 'Artillery', hp: 12, atk: 5, def: 1, move: 1, range: 3, sight: 3, cost: 180, color: '#79c0ff' },
};

export function makeUnit(id, unitType, player, x, y) {
  return {
    id,
    type: unitType.name,
    player,
    x, y,
    hp: unitType.hp,
    maxHp: unitType.hp,
    atk: unitType.atk,
    def: unitType.def ?? 0,
    move: unitType.move,
    range: unitType.range,
    sight: unitType.sight ?? 3,
    moved: false,
    acted: false,
    hitUntil: 0,
    xp: 0,
    color: player === 0 ? '#58a6ff' : '#ffa657',
  };
}

export const FORT_TYPES = {
  Pillbox: { name: 'Pillbox', hp: 20, cost: 80, color: '#8b949e', atk: 4, range: 2 },
  Bunker: { name: 'Bunker', hp: 30, cost: 120, color: '#6e7681', atk: 0, range: 0 },
  BarbedWire: { name: 'BarbedWire', hp: 8, cost: 30, color: '#9e6b41', atk: 0, range: 0 },
};

export function makeFort(id, fortType, player, x, y) {
  return {
    id,
    type: fortType.name,
    fort: true,
    player,
    x, y,
    hp: fortType.hp,
    maxHp: fortType.hp,
    atk: fortType.atk ?? 0,
    range: fortType.range ?? 0,
    color: fortType.color,
  };
}

// Simple abilities metadata for display only
export const UNIT_ABILITIES = {
  Infantry: ['Generalist'],
  Tank: ['Armored'],
  Artillery: ['Long Range'],
  Engineer: ['Build Fortifications', 'Anti-Tank'],
  Officer: ['Leadership'],
  Medic: ['Field Medic'],
  Scout: ['Recon'],
  MechanizedInfantry: ['Transported'],
};

export function rankForXP(xp) {
  const lvl = xp >= 6 ? 2 : xp >= 3 ? 1 : 0;
  const label = lvl === 2 ? 'Sergeant' : lvl === 1 ? 'Corporal' : 'Private';
  return { level: lvl, label };
}
