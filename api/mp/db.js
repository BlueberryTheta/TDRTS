export const config = { runtime: 'edge' };
export const runtime = 'edge';

let sql = null;
let inited = false;

try {
  const { neon } = await import('@neondatabase/serverless');
  const url = process.env.NEON_DATABASE_URL;
  if (url) sql = neon(url);
} catch {}

export function hasNeon() { return !!sql; }

export async function initTables() {
  if (!sql || inited) return;
  await sql`CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    players INT NOT NULL DEFAULT 0,
    current_player INT NOT NULL DEFAULT 0,
    last_snapshot JSONB,
    seq BIGINT NOT NULL DEFAULT 0
  )`;
  await sql`CREATE TABLE IF NOT EXISTS events (
    room_id TEXT NOT NULL,
    seq BIGINT NOT NULL,
    data JSONB NOT NULL,
    PRIMARY KEY (room_id, seq)
  )`;
  inited = true;
}

export async function getRoom(id) {
  await initTables();
  const rows = await sql`SELECT id, players, current_player, last_snapshot, seq FROM rooms WHERE id = ${id}`;
  return rows[0] || null;
}

export async function upsertRoom(room) {
  await initTables();
  await sql`INSERT INTO rooms (id, players, current_player, last_snapshot, seq)
            VALUES (${room.id}, ${room.players}, ${room.current_player}, ${room.last_snapshot}, ${room.seq})
            ON CONFLICT (id) DO UPDATE SET
              players = EXCLUDED.players,
              current_player = EXCLUDED.current_player,
              last_snapshot = EXCLUDED.last_snapshot,
              seq = EXCLUDED.seq`;
}

export async function createRoomRow(id) {
  await initTables();
  await sql`INSERT INTO rooms (id, players, current_player, last_snapshot, seq)
            VALUES (${id}, 0, 0, NULL, 0)
            ON CONFLICT (id) DO NOTHING`;
  return await getRoom(id);
}

export async function nextSeq(id) {
  await initTables();
  const rows = await sql`UPDATE rooms SET seq = seq + 1 WHERE id = ${id} RETURNING seq`;
  return rows[0]?.seq || 0;
}

export async function appendEventRow(id, seq, data) {
  await initTables();
  await sql`INSERT INTO events (room_id, seq, data) VALUES (${id}, ${seq}, ${data})`;
}

export async function listEventsSince(id, since) {
  await initTables();
  const rows = await sql`SELECT seq, data FROM events WHERE room_id = ${id} AND seq > ${since} ORDER BY seq ASC LIMIT 500`;
  return rows.map(r => ({ seq: Number(r.seq), ...r.data }));
}

