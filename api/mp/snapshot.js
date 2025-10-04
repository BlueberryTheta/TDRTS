export const config = { runtime: 'edge' };
export const runtime = 'edge';
import { setSnapshot } from './store.js';

function json(data, status=200){ return new Response(JSON.stringify(data), { status, headers:{'content-type':'application/json'} }); }

export default async function handler(req) {
  try {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const body = await req.json().catch(() => ({}));
    const { roomId, state } = body;
    if (!roomId || !state) return json({ error: 'Bad Request' }, 400);
    try { console.log('[MP/SNAPSHOT] room=', roomId, 'keys=', Object.keys(state || {})); } catch {}
    await setSnapshot(roomId, state);
    return json({ ok: true });
  } catch (e) {
    try { console.error('[MP/SNAPSHOT] error', e?.message || e); } catch {}
    return json({ error: 'Internal', message: String(e?.message || e) }, 500);
  }
}
