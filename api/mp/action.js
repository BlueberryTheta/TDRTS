export const config = { runtime: 'edge' };
export const runtime = 'edge';
import { appendEvent, getCurrentPlayer, setCurrentPlayer } from './store.js';

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const body = await req.json().catch(() => ({}));
  const { roomId, player, action } = body;
  if (!roomId || typeof player !== 'number' || !action) return Response.json({ error: 'Bad Request' }, { status: 400 });

  // Enforce turn
  const turnActions = new Set(['spawn', 'buildFort', 'move', 'attack', 'endTurn']);
  const current = getCurrentPlayer(roomId);
  if (turnActions.has(action.kind) && player !== current) return Response.json({ error: 'Not your turn' }, { status: 403 });
  if (action.kind === 'endTurn') setCurrentPlayer(roomId, (current + 1) % 2);

  const evt = appendEvent(roomId, { type: 'event', player, action, currentPlayer: getCurrentPlayer(roomId) });
  return Response.json({ ok: true, event: evt });
}

