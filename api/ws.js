export const config = { runtime: 'edge', regions: ['iad1'] };
export const runtime = 'edge';

import { GameState } from '../src/state.js';
import { UNIT_TYPES, FORT_TYPES } from '../src/units.js';

// In‑memory room store (ephemeral). For production, back with Vercel KV.
const rooms = new Map(); // roomId -> { game: GameState, sockets: Set<WebSocket>, players: Map<WebSocket, number> }

function rnd(n = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < n; i++) out += chars[(Math.random() * chars.length) | 0];
  return out;
}

function snapshot(game) {
  return {
    type: 'snapshot',
    state: {
      w: game.w,
      h: game.h,
      turn: game.turn,
      currentPlayer: game.currentPlayer,
      income: game.income,
      money: game.money,
      bases: game.bases,
      flags: game.flags,
      units: game.units,
      forts: game.forts,
      isGameOver: game.isGameOver,
      winner: game.winner,
    },
  };
}

function broadcast(room, msg) {
  const text = JSON.stringify(msg);
  for (const ws of room.sockets) try { ws.send(text); } catch {}
}

function applyAction(room, player, msg) {
  const g = room.game;
  if (g.isGameOver) return;
  if (player !== g.currentPlayer && msg.kind !== 'request_state') return;

  switch (msg.kind) {
    case 'endTurn':
      console.log('[WS] endTurn by', player);
      g.endTurn();
      break;
    case 'spawn': {
      const { spawnType, unitType, fortType, x, y } = msg;
      console.log('[WS] spawn', { player, spawnType, unitType, fortType, x, y });
      if (spawnType === 'unit') {
        const ut = UNIT_TYPES[unitType]; if (!ut) break;
        g.currentPlayer = player; g.queueSpawn(ut); g.trySpawnAt(x, y);
      } else if (spawnType === 'fort') {
        const ft = FORT_TYPES[fortType]; if (!ft) break;
        g.currentPlayer = player; g.queueFort(ft); g.trySpawnAt(x, y);
      }
      break;
    }
    case 'buildFort': {
      const { fortType, engineerId, x, y } = msg;
      console.log('[WS] buildFort', { player, fortType, engineerId, x, y });
      const ft = FORT_TYPES[fortType]; if (!ft) break;
      g.currentPlayer = player; g.selectedId = engineerId; g.queueFortBuild(ft); g.tryBuildAt(x, y);
      break;
    }
    case 'move': {
      const { unitId, x, y } = msg;
      console.log('[WS] move', { player, unitId, x, y });
      const u = g.getUnitById(unitId); if (!u || u.player !== player) break;
      g.moveUnitTo(u, x, y); g.checkFlagCapture(u);
      break;
    }
    case 'attack': {
      const { attackerId, x, y } = msg;
      console.log('[WS] attack', { player, attackerId, x, y });
      const a = g.getUnitById(attackerId); if (!a || a.player !== player) break;
      const enemy = g.getEnemyAt(x, y) || g.getFortAt(x, y); if (!enemy) break;
      g.attack(a, enemy);
      break;
    }
    default:
      break;
  }
}

export default async function handler(req) {
  if (req.headers.get('upgrade') !== 'websocket') {
    return new Response('Expected WebSocket', { status: 426 });
  }
  const { 0: client, 1: server } = new WebSocketPair();
  const ws = server;
  ws.accept();

  let roomId = null;
  let player = null;

  ws.addEventListener('message', (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'create') {
      roomId = rnd();
      const game = new GameState(12, 12);
      const room = { game, sockets: new Set([ws]), players: new Map([[ws, 0]]) };
      rooms.set(roomId, room);
      player = 0;
      console.log('[WS] create room', roomId, 'player', player);
      ws.send(JSON.stringify({ type: 'room', roomId, player }));
      ws.send(JSON.stringify(snapshot(game)));
    } else if (msg.type === 'join') {
      const room = rooms.get(msg.roomId);
      if (!room) { ws.send(JSON.stringify({ type: 'error', message: 'Room not found' })); return; }
      if (room.players.size >= 2) { ws.send(JSON.stringify({ type: 'error', message: 'Room full' })); return; }
      roomId = msg.roomId; player = 1;
      room.sockets.add(ws); room.players.set(ws, 1);
      console.log('[WS] join room', roomId, 'player', player);
      ws.send(JSON.stringify({ type: 'room', roomId, player }));
      broadcast(room, snapshot(room.game));
    } else if (msg.type === 'request_state') {
      console.log('[WS] request_state', roomId);
      const room = rooms.get(roomId); if (!room) return;
      ws.send(JSON.stringify(snapshot(room.game)));
    } else if (msg.type === 'action') {
      console.log('[WS] action', msg.kind, 'by', player);
      const room = rooms.get(roomId); if (!room) return;
      applyAction(room, player, msg);
      broadcast(room, snapshot(room.game));
    }
  });

  ws.addEventListener('close', () => {
    console.log('[WS] close', roomId, 'player', player);
    if (!roomId) return;
    const room = rooms.get(roomId); if (!room) return;
    room.sockets.delete(ws); room.players.delete(ws);
    if (room.sockets.size === 0) rooms.delete(roomId);
  });

  return new Response(null, { status: 101, webSocket: client });
}
