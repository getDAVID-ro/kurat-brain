// Brain-ul pe Vercel: SQLite rămâne motorul (sincron, rapid, aceleași interogări ca local), iar Neon ține copia de referință.
// Funcțiile Vercel pornesc dintr-un disc gol și pot rula în mai multe instanțe, deci:
//  • la pornire, instanța ia ultima copie din Neon (sau, la prima pornire, pornește din seed/brain.db și o urcă);
//  • înainte de o cerere care citește, verifică (cel mult o dată la câteva secunde) dacă altă instanță a scris între timp;
//  • o cerere care scrie ia lacătul din Neon, se aduce la zi, rulează, iar înainte să răspundă urcă noua copie (versiune + 1).
// Imaginile încărcate din panou merg în Vercel Blob (dacă e conectat); cele din depozit vin cu codul, din /media.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

export const databaseUrl = () => process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? null;
export const cloudEnabled = () => !!databaseUrl() && process.env.BRAIN_CLOUD !== '0';
export const blobEnabled = () => !!process.env.BLOB_READ_WRITE_TOKEN;

let client = null, clientUrl = null;
export async function sqlFor(url = databaseUrl()) {
  if (client && clientUrl === url) return client;
  const {neon} = await import('@neondatabase/serverless');
  clientUrl = url;
  return (client = neon(url));
}

export async function ensureSchema(sql) {
  await sql`CREATE TABLE IF NOT EXISTS brain_state (id int PRIMARY KEY, version bigint NOT NULL, data text NOT NULL, size int,
    updated_at timestamptz NOT NULL DEFAULT now(), updated_by text)`;
  await sql`CREATE TABLE IF NOT EXISTS brain_lock (id int PRIMARY KEY, holder text, until timestamptz NOT NULL DEFAULT 'epoch')`;
  await sql`INSERT INTO brain_lock (id) VALUES (1) ON CONFLICT DO NOTHING`;
}

// ———————————————————————————————————————————— copia bazei: SQLite ⇄ text (gzip + base64)

export function snapshot(db) {
  const tmp = path.join(os.tmpdir(), `kurat-snap-${process.pid}-${crypto.randomUUID()}.db`);
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  try { return fs.readFileSync(tmp); } finally { fs.rmSync(tmp, {force: true}); }
}
export const pack = buf => zlib.gzipSync(buf, {level: 9}).toString('base64');
export const unpack = text => zlib.gunzipSync(Buffer.from(text, 'base64'));

export async function pull(sql) {
  const [row] = await sql`SELECT version, data FROM brain_state WHERE id = 1`;
  return row ? {version: Number(row.version), buf: unpack(row.data)} : null;
}
export async function remoteVersion(sql) {
  const [row] = await sql`SELECT version FROM brain_state WHERE id = 1`;
  return row ? Number(row.version) : null;
}
// expect = versiunea pe care o știm; null = prima copie. Altă versiune în Neon = conflict (altcineva a scris între timp).
export async function push(sql, buf, {expect, by = null}) {
  const data = pack(buf);
  const rows = expect == null
    ? await sql`INSERT INTO brain_state (id, version, data, size, updated_by) VALUES (1, 1, ${data}, ${buf.length}, ${by}) ON CONFLICT DO NOTHING RETURNING version`
    : await sql`UPDATE brain_state SET version = version + 1, data = ${data}, size = ${buf.length}, updated_at = now(), updated_by = ${by}
        WHERE id = 1 AND version = ${expect} RETURNING version`;
  if (!rows.length) throw Object.assign(new Error('Copia din Neon s-a schimbat între timp.'), {conflict: true});
  return Number(rows[0].version);
}
export async function forcePush(sql, buf, by = null) {
  const data = pack(buf);
  const [row] = await sql`INSERT INTO brain_state (id, version, data, size, updated_by) VALUES (1, 1, ${data}, ${buf.length}, ${by})
    ON CONFLICT (id) DO UPDATE SET version = brain_state.version + 1, data = EXCLUDED.data, size = EXCLUDED.size, updated_at = now(), updated_by = EXCLUDED.updated_by
    RETURNING version`;
  return Number(row.version);
}

// Lacăt cu termen: dacă instanța care îl ține moare, expiră singur.
async function lock(sql, holder, {ttl = 30, wait = 20_000} = {}) {
  const until = Date.now() + wait;
  for (let pause = 80; ; pause = Math.min(pause * 1.6, 800)) {
    const rows = await sql`UPDATE brain_lock SET holder = ${holder}, until = now() + make_interval(secs => ${ttl})
      WHERE id = 1 AND (until < now() OR holder = ${holder}) RETURNING id`;
    if (rows.length) return;
    if (Date.now() > until) throw Object.assign(new Error('Altă modificare e în curs. Încearcă din nou peste câteva secunde.'), {status: 503});
    await new Promise(r => setTimeout(r, pause));
  }
}
const unlock = (sql, holder) => sql`UPDATE brain_lock SET holder = NULL, until = 'epoch' WHERE id = 1 AND holder = ${holder}`;

// Înlocuiește conținutul bazei deschise cu o copie, fără să închidă conexiunea (toate modulele țin același obiect db).
export function loadInto(db, buf) {
  const tmp = path.join(os.tmpdir(), `kurat-load-${process.pid}-${crypto.randomUUID()}.db`);
  fs.writeFileSync(tmp, buf);
  try {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`ATTACH DATABASE '${tmp.replace(/'/g, "''")}' AS src`);
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        const tables = db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
        const inSrc = new Set(db.prepare("SELECT name FROM src.sqlite_master WHERE type = 'table'").all().map(r => r.name));
        for (const t of tables) {
          const q = `"${t.replace(/"/g, '""')}"`;
          db.exec(`DELETE FROM main.${q}`);
          if (!inSrc.has(t)) continue;
          const cols = db.prepare(`SELECT name FROM pragma_table_info('${t.replace(/'/g, "''")}', 'src')`).all().map(r => `"${r.name.replace(/"/g, '""')}"`);
          const mine = new Set(db.prepare(`SELECT name FROM pragma_table_info('${t.replace(/'/g, "''")}', 'main')`).all().map(r => `"${r.name.replace(/"/g, '""')}"`));
          const common = cols.filter(c => mine.has(c)).join(', ');
          if (common) db.exec(`INSERT INTO main.${q} (${common}) SELECT ${common} FROM src.${q}`);
        }
        if (inSrc.has('sqlite_sequence')) { db.exec('DELETE FROM main.sqlite_sequence'); db.exec('INSERT INTO main.sqlite_sequence SELECT * FROM src.sqlite_sequence'); }
        db.exec('COMMIT');
      } catch (err) { db.exec('ROLLBACK'); throw err; }
    } finally { db.exec('DETACH DATABASE src'); }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    fs.rmSync(tmp, {force: true});
  }
}

// ———————————————————————————————————————————— imaginile încărcate pe Vercel → Blob

const written = new Set();
// api.mjs anunță fiecare fișier scris în /media; cererea care scrie le urcă în Blob înainte să răspundă.
export const noteMediaWrite = file => { if (cloudEnabled()) written.add(file); };
export function assertMediaWritable() {
  if (process.env.VERCEL && !blobEnabled())
    throw Object.assign(new Error('Pe Vercel, imaginile noi au nevoie de Vercel Blob (încă neconectat). Încarcă imaginea din panoul local sau conectează Blob.'), {status: 503});
}
async function uploadMedia(db, mediaDir) {
  if (!written.size || !blobEnabled()) { written.clear(); return; }
  const {put} = await import('@vercel/blob');
  for (const file of [...written]) {
    written.delete(file);
    if (!fs.existsSync(file)) continue;
    const key = `media/${path.relative(mediaDir, file).split(path.sep).join('/')}`;
    const r = await put(key, fs.readFileSync(file), {access: 'public', addRandomSuffix: false, allowOverwrite: true});
    const base = r.url.slice(0, r.url.length - key.length);
    db.prepare("INSERT INTO meta (key, value) VALUES ('blob_base', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(base);
  }
}
export const blobBase = db => db.prepare("SELECT value FROM meta WHERE key = 'blob_base'").get()?.value ?? null;

// ———————————————————————————————————————————— sincronizarea unei instanțe cu Neon

// La transfer: baza nouă (goală) se umple singură din baza veche, dacă BRAIN_IMPORT_DATABASE_URL e setat; altfel din seed.
export async function openCloud(openDb, {file, seedFile, log = console.log}) {
  const sql = await sqlFor();
  await ensureSchema(sql);
  let remote = await pull(sql), origin = null;
  if (!remote && process.env.BRAIN_IMPORT_DATABASE_URL) {
    const {neon} = await import('@neondatabase/serverless');
    const old = await pull(neon(process.env.BRAIN_IMPORT_DATABASE_URL)).catch(err => { log('Neon: baza veche nu a putut fi citită:', err.message); return null; });
    if (old) { fs.writeFileSync(file, old.buf); origin = 'import din baza veche'; }
  }
  if (remote) fs.writeFileSync(file, remote.buf);
  else if (!origin) { fs.copyFileSync(seedFile, file); origin = 'prima pornire (seed)'; }
  for (const ext of ['-wal', '-shm']) fs.rmSync(file + ext, {force: true});
  const db = openDb(file);
  let version = remote?.version ?? null;
  if (version == null) {
    try { version = await push(sql, snapshot(db), {expect: null, by: origin}); log(`Neon: prima copie urcată (${origin})`); }
    catch { remote = await pull(sql); if (remote) { loadInto(db, remote.buf); version = remote.version; } }
  }
  const sync = Object.assign(createCloudSync(db, sql, {version, log}), {db});
  await importBlobs(db, sync, {log}).catch(err => log('Blob: importul din magazinul vechi a eșuat:', err.message));
  return sync;
}

// La transfer: imaginile încărcate din panou se copiază din Blob-ul vechi (BRAIN_IMPORT_BLOB_TOKEN) în cel nou, o singură dată.
async function importBlobs(db, sync, {log}) {
  const oldToken = process.env.BRAIN_IMPORT_BLOB_TOKEN;
  if (!oldToken || !blobEnabled() || oldToken === process.env.BLOB_READ_WRITE_TOKEN) return;
  if (db.prepare("SELECT value FROM meta WHERE key = 'blob_imported'").get()) return;
  const {list, put} = await import('@vercel/blob');
  let cursor, n = 0, base = null;
  do {
    const page = await list({token: oldToken, cursor, limit: 1000});
    for (const b of page.blobs) {
      const res = await fetch(b.url);
      if (!res.ok) continue;
      const r = await put(b.pathname, Buffer.from(await res.arrayBuffer()), {access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: res.headers.get('content-type') ?? undefined});
      base ??= r.url.slice(0, r.url.length - b.pathname.length);
      n++;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  if (base) db.prepare("INSERT INTO meta (key, value) VALUES ('blob_base', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(base);
  db.prepare("INSERT INTO meta (key, value) VALUES ('blob_imported', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(new Date().toISOString());
  await sync.save('import Blob');
  log(`Blob: ${n} fișiere copiate din magazinul vechi`);
}

export function createCloudSync(db, sql, {version, log = console.log, onReload = () => {}, mediaDir = null}) {
  let checkedAt = Date.now(), queue = Promise.resolve();
  const changes = () => db.prepare('SELECT total_changes() n').get().n;
  const self = {
    get version() { return version; },
    onReload: fn => { onReload = fn; },
    setMediaDir: d => { mediaDir = d; },
    // o scriere făcută în afara unei cereri (la pornire): urcată sub lacăt
    async save(by) {
      const holder = crypto.randomUUID();
      await lock(sql, holder);
      try { version = await push(sql, snapshot(db), {expect: version, by}); }
      catch (err) { if (!err.conflict) throw err; version = await forcePush(sql, snapshot(db), by); }
      finally { await unlock(sql, holder).catch(() => {}); }
    },
    // adusă la zi dacă altă instanță a scris (cel mult o verificare la `every` ms)
    async fresh({force = false, every = 3000} = {}) {
      if (!force && Date.now() - checkedAt < every) return false;
      checkedAt = Date.now();
      const v = await remoteVersion(sql);
      if (v == null || v === version) return false;
      const r = await pull(sql);
      loadInto(db, r.buf);
      version = r.version;
      onReload();
      log(`Neon: copia v${version} adusă (scrisă de altă instanță)`);
      return true;
    },
    // o cerere care poate scrie: una câte una în instanță, cu lacăt între instanțe; răspunsul pleacă după ce copia e urcată
    write(req, res, handler) {
      const run = async () => {
        const holder = crypto.randomUUID();
        await lock(sql, holder);
        const realEnd = res.end.bind(res);
        let release;
        const ended = new Promise(r => { release = r; });
        res.end = (...args) => { release(args); return res; };
        let args;
        try {
          await self.fresh({force: true});
          const before = changes();
          const work = Promise.resolve(handler(req, res)).catch(err => { log('eroare în cerere:', err); if (!res.headersSent) res.writeHead(500); release([]); });
          args = await Promise.race([ended, work.then(() => ended)]);
          if (changes() !== before || written.size) {
            if (mediaDir) await uploadMedia(db, mediaDir);
            version = await push(sql, snapshot(db), {expect: version, by: req.url?.split('?')[0] ?? null});
          }
        } catch (err) {
          log('Neon: copia nu a putut fi urcată:', err);
          if (!res.headersSent) { res.writeHead(err.status ?? 503, {'content-type': 'application/json; charset=utf-8'}); args = [JSON.stringify({error: err.message})]; }
        } finally {
          await unlock(sql, holder).catch(() => {});
          res.end = realEnd;
          realEnd(...(args ?? []));
        }
      };
      const p = queue.then(run, run);
      queue = p.catch(() => {});
      return p;
    }
  };
  return self;
}
