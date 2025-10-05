import { WebSocketServer } from 'ws';
import { GameState } from '../src/state.js';
import { UNIT_TYPES, FORT_TYPES } from '../src/units.js';

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

const rooms = new Map(); // roomId -> { game, conns: Map(player->ws) }

const rnd = (n=6) => Array.from({length:n},()=>('ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random()*32)])).join('');

function snapshot(game) {
  return {
    type: 'snapshot',
    state: {
      w: game.w, h: game.h, turn: game.turn, currentPlayer: game.currentPlayer,
      income: game.income, money: game.money, bases: game.bases, flags: game.flags,
      units: game.units, forts: game.forts, isGameOver: game.isGameOver, winner: game.winner,
      rev: typeof game.rev === 'number' ? game.rev : 0,
    }
  };
}

function broadcast(room, msg) {
  const text = JSON.stringify(msg);
  for (const [,ws] of room.conns) try { ws.send(text); } catch {}
}

function applyAction(room, player, msg) {
  const g = room.game;
  if (g.isGameOver) return;
  if (player !== g.currentPlayer && msg.type !== 'request_state') return;

  switch (msg.kind) {
    case 'endTurn':
      g.endTurn();
      break;
    case 'spawn': {
      const { spawnType, unitType, fortType, x, y } = msg;
      if (spawnType === 'unit') {
        const ut = UNIT_TYPES[unitType]; if (!ut) return;
        g.currentPlayer = player; // ensure correctness
        g.queueSpawn(ut);
        g.trySpawnAt(x, y);
      } else if (spawnType === 'fort') {
        const ft = FORT_TYPES[fortType]; if (!ft) return;
        g.currentPlayer = player;
        g.queueFort(ft);
        g.trySpawnAt(x, y);
      }
      break;
    }
    case 'buildFort': {
      const { fortType, engineerId, x, y } = msg;
      const ft = FORT_TYPES[fortType]; if (!ft) return;
      g.currentPlayer = player;
      g.selectedId = engineerId;
      g.queueFortBuild(ft);
      g.tryBuildAt(x, y);
      break;
    }
    case 'move': {
      const { unitId, x, y } = msg;
      const u = g.getUnitById(unitId); if (!u || u.player !== player) return;
      g.moveUnitTo(u, x, y);
      g.checkFlagCapture(u);
      break;
    }
    case 'attack': {
      const { attackerId, x, y } = msg;
      const a = g.getUnitById(attackerId); if (!a || a.player !== player) return;
      const enemy = g.getEnemyAt(x, y) || g.getFortAt(x, y);
      if (!enemy) return;
      g.attack(a, enemy);
      break;
    }
    default:
      break;
  }
}

wss.on('connection', (ws) => {
  ws._roomId = null; ws._player = null;
  ws.on('message', (data) => {
    let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.type === 'create') {
      const roomId = rnd();
      const game = new GameState(12,12);
      const conns = new Map(); conns.set(0, ws);
      rooms.set(roomId, { game, conns });
      ws._roomId = roomId; ws._player = 0;
      ws.send(JSON.stringify({ type: 'room', roomId, player: 0 }));
      ws.send(JSON.stringify(snapshot(game)));
    } else if (msg.type === 'join') {
      const room = rooms.get(msg.roomId);
      if (!room) { ws.send(JSON.stringify({ type: 'error', message: 'Room not found' })); return; }
      if (room.conns.has(1)) { ws.send(JSON.stringify({ type: 'error', message: 'Room full' })); return; }
      ws._roomId = msg.roomId; ws._player = 1; room.conns.set(1, ws);
      ws.send(JSON.stringify({ type: 'room', roomId: msg.roomId, player: 1 }));
      // send snapshot to both
      broadcast(room, snapshot(room.game));
    } else if (msg.type === 'request_state') {
      const room = rooms.get(ws._roomId); if (!room) return;
      ws.send(JSON.stringify(snapshot(room.game)));
    } else if (msg.type === 'action') {
      const room = rooms.get(ws._roomId); if (!room) return;
      applyAction(room, ws._player, msg);
      broadcast(room, snapshot(room.game));
    }
  });
  ws.on('close', () => {
    const room = rooms.get(ws._roomId);
    if (!room) return;
    room.conns.delete(ws._player);
    // Optional: cleanup empty rooms
    if (room.conns.size === 0) rooms.delete(ws._roomId);
  });
});

console.log(`TDRTS WebSocket server running on ws://localhost:${PORT}`);
