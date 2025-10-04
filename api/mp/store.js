export const config = { runtime: 'edge' };
export const runtime = 'edge';

// Simple in-memory store for rooms (Edge: best-effort, ephemeral)
const rooms = new Map();

function rnd(n = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < n; i++) out += chars[(Math.random() * chars.length) | 0];
  return out;
}

export function getOrCreateRoom(id) {
  if (!id) id = rnd();
  if (!rooms.has(id)) rooms.set(id, { id, currentPlayer: 0, lastSnapshot: null, events: [], seq: 0, players: 0 });
  return rooms.get(id);
}

export function createRoom() { return getOrCreateRoom(null); }

export function joinRoom(roomId) {
  const room = getOrCreateRoom(roomId);
  if (room.players >= 2) return { error: 'Room full' };
  const player = room.players; room.players += 1;
  return { room, player };
}

export function appendEvent(roomId, evt) {
  const room = getOrCreateRoom(roomId);
  room.seq += 1;
  const withSeq = { ...evt, seq: room.seq };
  room.events.push(withSeq);
  if (room.events.length > 500) room.events.splice(0, room.events.length - 500);
  return withSeq;
}

export function getEventsSince(roomId, since) {
  const room = getOrCreateRoom(roomId);
  return room.events.filter(e => e.seq > since);
}

export function setSnapshot(roomId, state) {
  const room = getOrCreateRoom(roomId);
  room.lastSnapshot = state;
}

export function getSnapshot(roomId) {
  const room = getOrCreateRoom(roomId);
  return room.lastSnapshot;
}

export function setCurrentPlayer(roomId, cp) {
  const room = getOrCreateRoom(roomId);
  room.currentPlayer = cp;
}

export function getCurrentPlayer(roomId) {
  const room = getOrCreateRoom(roomId);
  return room.currentPlayer;
}

