export const config = { runtime: 'edge' };
export const runtime = 'edge';

import { hasNeon, initTables, getRoom, upsertRoom, createRoomRow, nextSeq, appendEventRow, listEventsSince } from './db.js';

// Simple in-memory store for fallback if Neon not configured
const memRooms = new Map();

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
  if (hasNeon()) {
    await initTables();
    let room = await getRoom(id);
    if (!room) room = await createRoomRow(id);
    // Normalize names between SQL and JS
    return { id: room.id, players: Number(room.players), currentPlayer: Number(room.current_player), lastSnapshot: room.last_snapshot, seq: Number(room.seq) };
  } else {
    if (!memRooms.has(id)) memRooms.set(id, { id, currentPlayer: 0, lastSnapshot: null, events: [], seq: 0, players: 0 });
    return memRooms.get(id);
  }
}

export async function createRoom() { return await getOrCreateRoom(null); }

export async function joinRoom(roomId) {
  if (hasNeon()) {
    let room = await getOrCreateRoom(roomId);
    if (room.players >= 2) return { error: 'Room full' };
    const player = room.players;
    room.players += 1;
    await upsertRoom({ id: room.id, players: room.players, current_player: room.currentPlayer, last_snapshot: room.lastSnapshot, seq: room.seq });
    return { room, player };
  } else {
    const room = await getOrCreateRoom(roomId);
    if (room.players >= 2) return { error: 'Room full' };
    const player = room.players; room.players += 1;
    return { room, player };
  }
}

export async function appendEvent(roomId, evt) {
  if (hasNeon()) {
    const room = await getOrCreateRoom(roomId);
    const seq = await nextSeq(room.id);
    const withSeq = { ...evt, seq };
    await appendEventRow(room.id, seq, withSeq);
    return withSeq;
  } else {
    const room = await getOrCreateRoom(roomId);
    room.seq += 1; const withSeq = { ...evt, seq: room.seq };
    room.events.push(withSeq); if (room.events.length > 500) room.events.splice(0, room.events.length - 500);
    return withSeq;
  }
}

export async function getEventsSince(roomId, since) {
  if (hasNeon()) {
    return await listEventsSince(roomId, since);
  } else {
    const room = await getOrCreateRoom(roomId);
    return room.events.filter(e => e.seq > since);
  }
}

export async function setSnapshot(roomId, state) {
  if (hasNeon()) {
    const room = await getOrCreateRoom(roomId);
    await upsertRoom({ id: room.id, players: room.players, current_player: room.currentPlayer, last_snapshot: state, seq: room.seq });
  } else {
    const room = await getOrCreateRoom(roomId);
    room.lastSnapshot = state;
  }
}

export async function getSnapshot(roomId) {
  if (hasNeon()) {
    const room = await getOrCreateRoom(roomId);
    return room.lastSnapshot;
  } else {
    const room = await getOrCreateRoom(roomId);
    return room.lastSnapshot;
  }
}

export async function setCurrentPlayer(roomId, cp) {
  if (hasNeon()) {
    const room = await getOrCreateRoom(roomId);
    await upsertRoom({ id: room.id, players: room.players, current_player: cp, last_snapshot: room.lastSnapshot, seq: room.seq });
  } else {
    const room = await getOrCreateRoom(roomId);
    room.currentPlayer = cp;
  }
}

export async function getCurrentPlayer(roomId) {
  if (hasNeon()) {
    const room = await getOrCreateRoom(roomId);
    return room.currentPlayer;
  } else {
    const room = await getOrCreateRoom(roomId);
    return room.currentPlayer;
  }
}
