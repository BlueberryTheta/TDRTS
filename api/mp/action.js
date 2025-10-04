export const config = { runtime: 'edge' };
export const runtime = 'edge';
import { appendEvent, getCurrentPlayer, setCurrentPlayer } from './store.js';

function json(data, status=200){ return new Response(JSON.stringify(data), { status, headers:{'content-type':'application/json'} }); }

export default async function handler(req) {
  try {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const body = await req.json().catch(() => ({}));
    const { roomId, player, action } = body;
    // Require Neon
    // Import here to avoid circular
    const { hasNeon } = await import('./db.js');
    if (!hasNeon()) {
      try { console.error('[MP/ACTION] Neon not configured'); } catch {}
      return json({ error: 'Service Unavailable', message: 'Neon database not configured.' }, 503);
    }
    try { console.log('[MP/ACTION]', action?.kind, 'room=', roomId, 'by=', player); } catch {}
    if (!roomId || typeof player !== 'number' || !action) return json({ error: 'Bad Request' }, 400);

    // Enforce turn
    const turnActions = new Set(['spawn', 'buildFort', 'move', 'attack', 'endTurn']);
    const current = await getCurrentPlayer(roomId);
    if (turnActions.has(action.kind) && player !== current) return json({ error: 'Not your turn' }, 403);
    if (action.kind === 'endTurn') await setCurrentPlayer(roomId, (current + 1) % 2);

    const evt = await appendEvent(roomId, { type: 'event', player, action, currentPlayer: await getCurrentPlayer(roomId) });
    return json({ ok: true, event: evt });
  } catch (e) {
    try { console.error('[MP/ACTION] error', e?.message || e); } catch {}
    return json({ error: 'Internal', message: String(e?.message || e) }, 500);
  }
}
