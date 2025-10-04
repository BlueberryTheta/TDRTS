export const config = { runtime: 'edge' };
export const runtime = 'edge';

let sqlPromise = null;
let inited = false;

export function hasNeon() { return !!pickDatabaseUrl(); }

function buildConnStringFromParts() {
  const user = process.env.PGUSER || process.env.POSTGRES_USER;
  const pass = process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD;
  const host = process.env.PGHOST_UNPOOLED || process.env.POSTGRES_HOST || process.env.PGHOST;
  const db   = process.env.PGDATABASE || process.env.POSTGRES_DATABASE;
  if (!user || !pass || !host || !db) return null;
  let url = `postgres://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}/${db}`;
  if (!/\?/.test(url)) url += '?sslmode=require';
  else if (!/sslmode=/.test(url)) url += '&sslmode=require';
  try { console.log('[MP/DB] buildConnStringFromParts host=', host, 'db=', db, 'user=', user ? '[set]' : ''); } catch {}
  return url;
}

function pickDatabaseUrl() {
  // Prefer explicit vars, then Vercel/Neon defaults, then assemble from parts
  const candidates = [
    process.env.NEON_DATABASE_URL,
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL_NO_SSL,
  ].filter(Boolean);
  for (const c of candidates) {
    if (/^postgres(ql)?:\/\//i.test(c)) {
      // Ensure sslmode=require
      if (!/sslmode=/.test(c)) {
        const url = c + (c.includes('?') ? '&' : '?') + 'sslmode=require';
        try { console.log('[MP/DB] picked URL from env (added sslmode)'); } catch {}
        return url;
      }
      try { console.log('[MP/DB] picked URL from env'); } catch {}
      return c;
    }
  }
  return buildConnStringFromParts();
}

async function getSql() {
  if (sqlPromise) return sqlPromise;
  sqlPromise = (async () => {
    try {
      const { neon } = await import('@neondatabase/serverless');
      const url = pickDatabaseUrl();
      if (!url) return null;
      try { console.log('[MP/DB] initializing Neon client'); } catch {}
      return neon(url);
    } catch {
      try { console.error('[MP/DB] failed to import or initialize Neon client'); } catch {}
      return null;
    }
  })();
  return sqlPromise;
}

export async function isSqlAvailable() { return !!(await getSql()); }

export async function initTables() {
  const sql = await getSql();
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
  try { console.log('[MP/DB] ensured tables'); } catch {}
}

export async function getRoom(id) {
  const sql = await getSql(); if (!sql) return null;
  await initTables();
  const rows = await sql`SELECT id, players, current_player, last_snapshot, seq FROM rooms WHERE id = ${id}`;
  return rows[0] || null;
}

export async function upsertRoom(room) {
  const sql = await getSql(); if (!sql) return;
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
  const sql = await getSql(); if (!sql) return null;
  await initTables();
  await sql`INSERT INTO rooms (id, players, current_player, last_snapshot, seq)
            VALUES (${id}, 0, 0, NULL, 0)
            ON CONFLICT (id) DO NOTHING`;
  return await getRoom(id);
}

export async function nextSeq(id) {
  const sql = await getSql(); if (!sql) return 0;
  await initTables();
  const rows = await sql`UPDATE rooms SET seq = seq + 1 WHERE id = ${id} RETURNING seq`;
  return rows[0]?.seq || 0;
}

export async function appendEventRow(id, seq, data) {
  const sql = await getSql(); if (!sql) return;
  await initTables();
  await sql`INSERT INTO events (room_id, seq, data) VALUES (${id}, ${seq}, ${data})`;
}

export async function listEventsSince(id, since) {
  const sql = await getSql(); if (!sql) return [];
  await initTables();
  const rows = await sql`SELECT seq, data FROM events WHERE room_id = ${id} AND seq > ${since} ORDER BY seq ASC LIMIT 500`;
  return rows.map(r => ({ seq: Number(r.seq), ...r.data }));
}
