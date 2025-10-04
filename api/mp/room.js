export const config = { runtime: 'edge' };
export const runtime = 'edge';
import { createRoom, joinRoom, getSnapshot, getCurrentPlayer, getPlayers } from './store.js';
import { hasNeon } from './db.js';

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const body = await req.json().catch(() => ({}));
  if (body.action === 'create') {
    const room = await createRoom();
    const players = await getPlayers(room.id);
    return Response.json({ roomId: room.id, player: 0, players, snapshot: room.lastSnapshot, currentPlayer: room.currentPlayer, using: hasNeon() ? 'neon' : 'memory' });
  }
  if (body.action === 'join') {
    const { roomId } = body;
    const res = await joinRoom(roomId);
    if (res.error) return Response.json({ error: res.error }, { status: 400 });
    const { room, player } = res;
    const players = await getPlayers(room.id);
    return Response.json({ roomId: room.id, player, players, snapshot: await getSnapshot(room.id), currentPlayer: await getCurrentPlayer(room.id), using: hasNeon() ? 'neon' : 'memory' });
  }
  return Response.json({ error: 'Bad Request' }, { status: 400 });
}
