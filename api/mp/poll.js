export const config = { runtime: 'edge' };
export const runtime = 'edge';
import { getEventsSince, getSnapshot, getCurrentPlayer, getPlayers } from './store.js';

function json(data, status=200){ return new Response(JSON.stringify(data), { status, headers:{'content-type':'application/json'} }); }

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const roomId = searchParams.get('room');
    const since = Number(searchParams.get('since') || 0);
    if (!roomId) return new Response('Bad Request', { status: 400 });
    const { hasNeon } = await import('./db.js');
    if (!hasNeon()) {
      try { console.error('[MP/POLL] Neon not configured'); } catch {}
      return json({ error: 'Service Unavailable', message: 'Neon database not configured.' }, 503);
    }
    try { console.log('[MP/POLL] room=', roomId, 'since=', since); } catch {}
    const events = await getEventsSince(roomId, since);
    const payload = { events, currentPlayer: await getCurrentPlayer(roomId), players: await getPlayers(roomId) };
    // Always include the latest snapshot to guarantee eventual consistency
    const snap = await getSnapshot(roomId);
    if (snap) payload.snapshot = snap;
    // Report the last seq available in this response for debugging
    if (Array.isArray(events) && events.length) payload.lastSeq = events[events.length - 1].seq;
    return json(payload);
  } catch (e) {
    try { console.error('[MP/POLL] error', e?.message || e); } catch {}
    return json({ error: 'Internal', message: String(e?.message || e) }, 500);
  }
}
