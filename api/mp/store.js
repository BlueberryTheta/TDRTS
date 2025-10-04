export const config = { runtime: 'edge' };
export const runtime = 'edge';

import { hasNeon, isSqlAvailable, initTables, getRoom, upsertRoom, createRoomRow, nextSeq, appendEventRow, listEventsSince, setPlayersIf, incPlayersIf } from './db.js';

function rnd(n = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < n; i++) out += chars[(Math.random() * chars.length) | 0];
  return out;
}

async function kvGet(key, def) { if (!kv) return def; try { const v = await kv.get(key); return v ?? def; } catch { return def; } }
async function kvSet(key, val) { if (!kv) return; try { await kv.set(key, val); } catch {} }

export async function getOrCreateRoom(id) {
  if (!id) id = rnd();
  if (!hasNeon() || !(await isSqlAvailable())) throw new Error('Neon database not configured');
  await initTables();
  let room = await getRoom(id);
  if (!room) room = await createRoomRow(id);
  if (!room) throw new Error('Failed to create room');
  return { id: room.id, players: Number(room.players), currentPlayer: Number(room.current_player), lastSnapshot: room.last_snapshot, seq: Number(room.seq) };
}

export async function createRoom() { return await getOrCreateRoom(null); }

export async function joinRoom(roomId) {
  let room = await getOrCreateRoom(roomId);
  if (room.players === 0) return { error: 'Room not ready' };
  if (room.players >= 2) return { error: 'Room full' };
  // players must be 1 here; try atomic increment
  const after = await incPlayersIf(room.id, 1);
  if (after === 2) {
    // assigned player index 1
    return { room: { ...room, players: after }, player: 1 };
  }
  // If concurrent update happened, refetch and decide
  room = await getOrCreateRoom(roomId);
  if (room.players >= 2) return { room, player: 1 };
  return { error: 'Room state changed, try again' };
}

export async function appendEvent(roomId, evt) {
  const room = await getOrCreateRoom(roomId);
  const seq = await nextSeq(room.id);
  const withSeq = { ...evt, seq };
  await appendEventRow(room.id, seq, withSeq);
  return withSeq;
}

export async function getEventsSince(roomId, since) {
  return await listEventsSince(roomId, since);
}

export async function setSnapshot(roomId, state) {
  const room = await getOrCreateRoom(roomId);
  await upsertRoom({ id: room.id, players: room.players, current_player: room.currentPlayer, last_snapshot: state, seq: room.seq });
}

export async function getSnapshot(roomId) {
  const room = await getOrCreateRoom(roomId);
  return room.lastSnapshot;
}

export async function setCurrentPlayer(roomId, cp) {
  const room = await getOrCreateRoom(roomId);
  await upsertRoom({ id: room.id, players: room.players, current_player: cp, last_snapshot: room.lastSnapshot, seq: room.seq });
}

export async function getCurrentPlayer(roomId) {
  const room = await getOrCreateRoom(roomId);
  return room.currentPlayer;
}

export async function setPlayers(roomId, n) {
  const room = await getOrCreateRoom(roomId);
  await upsertRoom({ id: room.id, players: n, current_player: room.currentPlayer, last_snapshot: room.lastSnapshot, seq: room.seq });
}

export async function getPlayers(roomId) {
  const room = await getOrCreateRoom(roomId);
  return room.players;
}
