export const UNIT_TYPES = {
  Infantry: { name: 'Infantry', hp: 10, atk: 4, move: 3, range: 1, cost: 50, color: '#58a6ff' },
  Tank: { name: 'Tank', hp: 18, atk: 7, move: 2, range: 1, cost: 100, color: '#1f6feb' },
  Artillery: { name: 'Artillery', hp: 12, atk: 5, move: 1, range: 3, cost: 120, color: '#79c0ff' },
};

export function makeUnit(id, unitType, player, x, y) {
  return {
    id,
    type: unitType.name,
    player,
    x, y,
    hp: unitType.hp,
    atk: unitType.atk,
    move: unitType.move,
    range: unitType.range,
    moved: false,
    acted: false,
    color: player === 0 ? '#58a6ff' : '#ffa657',
  };
}

