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
    if (body.action === 'create') {
      const room = await createRoom();
      // Ensure creator is Player 0 and players=1
      await setPlayers(room.id, 1);
      const players = await getPlayers(room.id);
      return json({ roomId: room.id, player: 0, players, snapshot: room.lastSnapshot, currentPlayer: room.currentPlayer, using: hasNeon() ? 'neon' : 'memory' });
    }
    if (body.action === 'join') {
      const { roomId } = body;
      const res = await joinRoom(roomId);
      if (res.error) return json({ error: res.error }, 400);
      const { room, player } = res;
      const players = await getPlayers(room.id);
      return json({ roomId: room.id, player, players, snapshot: await getSnapshot(room.id), currentPlayer: await getCurrentPlayer(room.id), using: hasNeon() ? 'neon' : 'memory' });
    }
    return json({ error: 'Bad Request' }, 400);
  } catch (e) {
    return json({ error: 'Internal', message: String(e?.message || e) }, 500);
  }
}
