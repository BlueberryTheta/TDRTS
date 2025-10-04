export const config = { runtime: 'edge' };
export const runtime = 'edge';
import { getEventsSince, getSnapshot, getCurrentPlayer } from './store.js';

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const roomId = searchParams.get('room');
  const since = Number(searchParams.get('since') || 0);
  if (!roomId) return new Response('Bad Request', { status: 400 });
  const events = getEventsSince(roomId, since);
  const payload = { events, currentPlayer: getCurrentPlayer(roomId) };
  if (since === 0) {
    const snap = getSnapshot(roomId);
    if (snap) payload.snapshot = snap;
  }
  return Response.json(payload);
}

