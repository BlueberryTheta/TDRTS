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
  console.log('[MP/STORE] joinRoom start', roomId);
  // Fetch existing room only; do not create on join
  let r = await getRoom(roomId);
  if (!r) return { error: 'Invalid code' };
  // Wait briefly if creator has not finalized players=1 yet
  let attempts = 0;
  while (Number(r.players) === 0 && attempts < 10) {
    console.log('[MP/STORE] joinRoom wait players=0 attempt', attempts);
    await new Promise(res => setTimeout(res, 100));
    r = await getRoom(roomId);
    attempts++;
  }
  const room = { id: r.id, players: Number(r.players), currentPlayer: Number(r.current_player), lastSnapshot: r.last_snapshot, seq: Number(r.seq) };
  console.log('[MP/STORE] joinRoom observed players=', room.players);
  if (room.players === 0) return { error: 'Room not ready' };
  if (room.players >= 2) return { error: 'Room full' };
  // players must be 1 here; try atomic increment
  const after = await incPlayersIf(room.id, 1);
  console.log('[MP/STORE] joinRoom incPlayersIf result', after);
  if (after === 2) {
    return { room: { ...room, players: after }, player: 1 };
  }
  // Race: re-check once
  const check = await getRoom(roomId);
  const cPlayers = Number(check?.players || 0);
  console.log('[MP/STORE] joinRoom recheck players=', cPlayers);
  if (cPlayers >= 2) return { room: { ...room, players: cPlayers }, player: 1 };
  return { error: 'Busy, try again' };
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
  // atomic set only when transitioning from 0 to 1 on create
  if (n === 1) {
    const set = await setPlayersIf(roomId, 0, 1);
    console.log('[MP/STORE] setPlayersIf 0->1 result', set);
    if (set !== 1) {
      // fallback: ensure exists and update
      const room = await getOrCreateRoom(roomId);
      await upsertRoom({ id: room.id, players: n, current_player: room.currentPlayer, last_snapshot: room.lastSnapshot, seq: room.seq });
      console.log('[MP/STORE] setPlayers fallback upsert done');
    }
  } else {
    const room = await getOrCreateRoom(roomId);
    await upsertRoom({ id: room.id, players: n, current_player: room.currentPlayer, last_snapshot: room.lastSnapshot, seq: room.seq });
  }
}

export async function getPlayers(roomId) {
  const r = await getRoom(roomId);
  return Number(r?.players || 0);
}
