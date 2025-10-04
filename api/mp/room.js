export const config = { runtime: 'edge' };
export const runtime = 'edge';
import { createRoom, joinRoom, getSnapshot, getCurrentPlayer, getPlayers, setPlayers } from './store.js';
import { hasNeon } from './db.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

export default async function handler(req) {
  try {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const body = await req.json().catch(() => ({}));
    try { console.log('[MP/ROOM] request', body?.action, body?.roomId || ''); } catch {}
    if (!hasNeon()) {
      try { console.error('[MP/ROOM] Neon not configured'); } catch {}
      return json({ error: 'Service Unavailable', message: 'Neon database not configured. Set DATABASE_URL / POSTGRES_URL (HTTP) or PG* vars.' }, 503);
    }
    if (body.action === 'create') {
      const room = await createRoom();
      try { console.log('[MP/ROOM] created id', room.id); } catch {}
      // Ensure creator is Player 0 and players=1 atomically
      const set = await setPlayers(room.id, 1);
      const players = await getPlayers(room.id);
      try { console.log('[MP/ROOM] created', room.id, 'players=', players, 'set=', set); } catch {}
      return json({ roomId: room.id, player: 0, players, snapshot: room.lastSnapshot, currentPlayer: room.currentPlayer, using: hasNeon() ? 'neon' : 'memory' });
    }
    if (body.action === 'join') {
      let { roomId } = body;
      roomId = (roomId || '').toString().trim().toUpperCase();
      try { console.log('[MP/ROOM] normalized join code', roomId); } catch {}
      const res = await joinRoom(roomId);
      if (res.error) return json({ error: res.error }, 400);
      const { room, player } = res;
      const players = await getPlayers(room.id);
      try { console.log('[MP/ROOM] joined', room.id, 'assigned=', player, 'players=', players); } catch {}
      return json({ roomId: room.id, player, players, snapshot: await getSnapshot(room.id), currentPlayer: await getCurrentPlayer(room.id), using: hasNeon() ? 'neon' : 'memory' });
    }
    return json({ error: 'Bad Request' }, 400);
  } catch (e) {
    try { console.error('[MP/ROOM] error', e?.message || e); } catch {}
    return json({ error: 'Internal', message: String(e?.message || e) }, 500);
  }
}
