export const config = { runtime: 'edge' };
export const runtime = 'edge';
import { createRoom, joinRoom, getSnapshot, getCurrentPlayer } from './store.js';

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const body = await req.json().catch(() => ({}));
  if (body.action === 'create') {
    const room = createRoom();
    return Response.json({ roomId: room.id, player: 0, snapshot: room.lastSnapshot, currentPlayer: room.currentPlayer });
  }
  if (body.action === 'join') {
    const { roomId } = body;
    const res = joinRoom(roomId);
    if (res.error) return Response.json({ error: res.error }, { status: 400 });
    const { room, player } = res;
    return Response.json({ roomId: room.id, player, snapshot: getSnapshot(room.id), currentPlayer: getCurrentPlayer(room.id) });
  }
  return Response.json({ error: 'Bad Request' }, { status: 400 });
}

