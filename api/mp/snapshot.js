export const config = { runtime: 'edge' };
export const runtime = 'edge';
import { setSnapshot } from './store.js';

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const body = await req.json().catch(() => ({}));
  const { roomId, state } = body;
  if (!roomId || !state) return Response.json({ error: 'Bad Request' }, { status: 400 });
  setSnapshot(roomId, state);
  return Response.json({ ok: true });
}

