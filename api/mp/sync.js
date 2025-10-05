export const config = { runtime: 'edge' };
export const runtime = 'edge';

import { setSnapshot, appendEvent, getCurrentPlayer } from './store.js';

function json(data, status=200){ return new Response(JSON.stringify(data), { status, headers:{'content-type':'application/json'} }); }

export default async function handler(req) {
  try {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const body = await req.json().catch(() => ({}));
    const { roomId, player, state } = body;
    const { hasNeon } = await import('./db.js');
    if (!hasNeon()) return json({ error: 'Service Unavailable', message: 'Neon database not configured.' }, 503);
    if (!roomId || typeof player !== 'number' || !state) return json({ error: 'Bad Request' }, 400);

    // Persist snapshot
    await setSnapshot(roomId, state);
    // Also append a lightweight sync event so pollers can advance seq
    const evt = await appendEvent(roomId, { type: 'event', player, action: { kind: 'sync', rev: state.rev }, currentPlayer: await getCurrentPlayer(roomId) });
    return json({ ok: true, rev: state.rev, event: { seq: evt.seq, rev: state.rev } });
  } catch (e) {
    return json({ error: 'Internal', message: String(e?.message || e) }, 500);
  }
}

