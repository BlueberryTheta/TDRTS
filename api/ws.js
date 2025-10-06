export const config = { runtime: 'edge' };
export const runtime = 'edge';

// In‑memory room store (ephemeral). For production, back with Vercel KV.
// Thin relay server: no game logic. Clients apply actions locally.
// Room state: sockets, player mapping, currentPlayer, lastSnapshot (optional), host socket
const rooms = new Map(); // roomId -> { sockets:Set<WebSocket>, players:Map<WebSocket,number>, currentPlayer:number, lastSnapshot:any, host:WebSocket }

function rnd(n = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < n; i++) out += chars[(Math.random() * chars.length) | 0];
  return out;
}

// pass-through helper to broadcast a message to all sockets in a room

function broadcast(room, msg) {
  const text = JSON.stringify(msg);
  for (const ws of room.sockets) try { ws.send(text); } catch {}
}

function applyAction(room, player, msg) {
  // Enforce turn for state-changing actions
  const turnActions = new Set(['spawn', 'buildFort', 'move', 'attack', 'endTurn']);
  if (turnActions.has(msg.kind) && player !== room.currentPlayer) {
    console.log('[WS] reject action wrong turn', msg.kind, 'by', player, 'current', room.currentPlayer);
    return;
  }
  // Update server-side turn on endTurn
  if (msg.kind === 'endTurn') {
    room.currentPlayer = (room.currentPlayer + 1) % 2;
  }
  // Forward event to all
  broadcast(room, { type: 'event', player, action: msg, currentPlayer: room.currentPlayer });
}

export default async function handler(req) {
  try { console.log('[WS] handler start', req.url, 'upgrade=', req.headers.get('upgrade')); } catch {}
  if (req.headers.get('upgrade') !== 'websocket') {
    try { console.log('[WS] non-upgrade request', req.url); } catch {}
    return new Response('Expected WebSocket', { status: 426 });
  }
  const { 0: client, 1: server } = new WebSocketPair();
  const ws = server;
  ws.accept();
  try { console.log('[WS] accepted', req.url); } catch {}

  let roomId = null;
  let player = null;

  ws.addEventListener('message', (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'create') {
      roomId = rnd();
      const room = { sockets: new Set([ws]), players: new Map([[ws, 0]]), currentPlayer: 0, lastSnapshot: null, host: ws };
      rooms.set(roomId, room);
      player = 0;
      console.log('[WS] create room', roomId, 'player', player);
      ws.send(JSON.stringify({ type: 'room', roomId, player }));
      broadcast(room, { type: 'players', players: room.players.size });
      // Ask host to provide initial snapshot
      ws.send(JSON.stringify({ type: 'request_state' }));
    } else if (msg.type === 'join') {
      const room = rooms.get(msg.roomId);
      if (!room) { ws.send(JSON.stringify({ type: 'error', message: 'Room not found' })); return; }
      if (room.players.size >= 2) { ws.send(JSON.stringify({ type: 'error', message: 'Room full' })); return; }
      roomId = msg.roomId; player = 1;
      room.sockets.add(ws); room.players.set(ws, 1);
      console.log('[WS] join room', roomId, 'player', player);
      ws.send(JSON.stringify({ type: 'room', roomId, player }));
      // Send last snapshot to the joiner if available; otherwise request from host
      if (room.lastSnapshot) {
        ws.send(JSON.stringify({ type: 'snapshot', state: room.lastSnapshot }));
      } else if (room.host) {
        try { room.host.send(JSON.stringify({ type: 'request_state' })); } catch {}
      }
      broadcast(room, { type: 'players', players: room.players.size });
    } else if (msg.type === 'request_state') {
      console.log('[WS] request_state', roomId);
      // Clients should respond by sending a snapshot; server does not hold logic
    } else if (msg.type === 'action') {
      console.log('[WS] action', msg.kind, 'by', player);
      const room = rooms.get(roomId); if (!room) return;
      applyAction(room, player, msg);
    } else if (msg.type === 'snapshot') {
      const room = rooms.get(roomId); if (!room) return;
      room.lastSnapshot = msg.state;
      broadcast(room, { type: 'snapshot', state: msg.state });
    }
  });

  ws.addEventListener('close', () => {
    console.log('[WS] close', roomId, 'player', player);
    if (!roomId) return;
    const room = rooms.get(roomId); if (!room) return;
    room.sockets.delete(ws); room.players.delete(ws);
    broadcast(room, { type: 'players', players: room.players.size });
    if (room.sockets.size === 0) rooms.delete(roomId);
  });

  return new Response(null, { status: 101, webSocket: client });
}
