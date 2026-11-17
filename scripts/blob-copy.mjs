// npm run blob:copy — copiază fișierele din Blob-ul DWF în Blob-ul vostru.
//
// Citește din .env.local (îl aduce `npx vercel env pull .env.local`):
//   DWF_BLOB_TOKEN        depozitul vechi, al DWF (din el doar citește)
//   BLOB_READ_WRITE_TOKEN depozitul vostru, nou
//
// Se poate rula de oricâte ori: fișierele deja copiate (aceeași cale, aceeași mărime) sunt sărite.
// Nu are dependențe: folosește Vercel CLI prin npx.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

const ENV_FILE = '.env.local';
const PARALLEL = 4;

if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const OLD = (process.env.DWF_BLOB_TOKEN ?? '').trim();
const NEW = (process.env.BLOB_READ_WRITE_TOKEN ?? '').trim();
const storeId = token => token.split('_')[3] ?? '';

function stop(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!OLD) stop('Lipsește DWF_BLOB_TOKEN în .env.local. Rulați întâi: npx vercel env pull .env.local');
if (!NEW) stop('Lipsește BLOB_READ_WRITE_TOKEN în .env.local. Creați Blob-ul vostru (Storage → Create → Blob, legat de proiect, cu Development bifat), apoi: npx vercel env pull .env.local');
if (storeId(OLD) === storeId(NEW)) stop('BLOB_READ_WRITE_TOKEN este încă tokenul depozitului DWF. Ștergeți-l din proiect (Settings → Environment Variables), creați Blob-ul vostru, apoi: npx vercel env pull .env.local');

const WIN = process.platform === 'win32';
const quote = arg => `"${String(arg)}"`;
const hide = text => text.split(OLD).join('<DWF_BLOB_TOKEN>').split(NEW).join('<BLOB_READ_WRITE_TOKEN>')
  .replace(/^<claude-code-hint[^\n]*\n?/gm, '').trim();

// Vercel CLI prin npx; pe Windows npx e un .cmd, deci pornește prin shell, ca o singură linie de comandă.
function vercel(args) {
  return new Promise((resolve, reject) => {
    const cmd = ['--yes', 'vercel', ...args];
    const opts = {stdio: ['ignore', 'pipe', 'pipe']};
    // numele comenzii rămâne fără ghilimele: npx.cmd cu ghilimele nu-și mai găsește propriul folder
    const child = WIN ? spawn(['npx', ...cmd.map(quote)].join(' '), {...opts, shell: true}) : spawn('npx', cmd, opts);
    let out = '';
    let err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve(out) : reject(new Error(hide(err.trim() || out.trim() || `vercel a ieșit cu codul ${code}`)))));
  });
}

async function list(token) {
  const blobs = [];
  let next = null;
  do {
    const args = ['blob', 'list', '--json', '--limit', '1000', '--rw-token', token];
    if (next) args.push('--next', next);
    const out = await vercel(args);
    const page = JSON.parse(out.slice(out.indexOf('{')));
    blobs.push(...page.blobs);
    next = page.pagination?.next ?? null;
  } while (next);
  return blobs;
}

async function copy(blob, tmp) {
  const res = await fetch(blob.url, {cache: 'no-store'});
  if (!res.ok) throw new Error(`descărcarea a răspuns ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length !== blob.size) throw new Error(`am descărcat ${data.length} B în loc de ${blob.size} B`);
  const file = path.join(tmp, `${Math.random().toString(36).slice(2)}${path.extname(blob.pathname)}`);
  fs.writeFileSync(file, data);
  const args = ['blob', 'put', file, '--pathname', blob.pathname, '--access', 'public', '--force', '--rw-token', NEW];
  // o singură operație pe fișier: încărcarea în bucăți (multipart) costă mai multe operații din limita lunară a Blob-ului
  if (blob.size < 100 * 1048576) args.push('--no-multipart');
  const type = res.headers.get('content-type');
  if (type) args.push('--content-type', type);
  try {
    await vercel(args);
  } finally {
    fs.rmSync(file, {force: true});
  }
}

async function main() {
  console.log('Citesc fișierele din Blob-ul DWF…');
  const old = await list(OLD);
  if (!old.length) {
    console.log('\n✓ Blob-ul DWF e gol: nu e nimic de copiat.');
    return;
  }
  console.log(`Blob-ul DWF are ${old.length} fișiere. Citesc Blob-ul vostru…`);
  const have = new Map((await list(NEW)).map(b => [b.pathname, b.size]));
  const todo = old.filter(b => have.get(b.pathname) !== b.size);
  console.log(`De copiat: ${todo.length} (deja copiate: ${old.length - todo.length}).`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blob-copy-'));
  const queue = [...todo];
  let done = 0;
  try {
    await Promise.all(Array.from({length: Math.min(PARALLEL, queue.length)}, async () => {
      for (let b = queue.shift(); b; b = queue.shift()) {
        try {
          await copy(b, tmp);
          console.log(`  ↑ ${++done}/${todo.length} ${b.pathname}`);
        } catch (err) {
          console.error(`  ✗ ${b.pathname}: ${hide(err.message)}`);
        }
      }
    }));
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }

  console.log('\nVerific fiecare fișier în Blob-ul vostru…');
  const now = new Map((await list(NEW)).map(b => [b.pathname, b]));
  let ok = 0;
  for (const b of old) {
    const n = now.get(b.pathname);
    if (n && n.size === b.size) {
      ok++;
      console.log(`  ✓ ${b.pathname} (${b.size} B)`);
    } else {
      console.log(`  ✗ ${b.pathname}: ${n ? `are ${n.size} B în loc de ${b.size} B` : 'lipsește'}`);
    }
  }

  if (ok !== old.length) stop(`${old.length - ok} din ${old.length} fișiere nu s-au copiat. Rulați din nou: npm run blob:copy`);
  const sample = now.get(old[0].pathname);
  console.log(`\n✓ Gata: toate cele ${old.length} fișiere sunt în Blob-ul vostru.`);
  console.log(`  Adresa veche: ${new URL(old[0].url).origin}`);
  console.log(`  Adresa nouă:  ${new URL(sample.url).origin}`);
}

main().catch(err => stop(`Copierea s-a oprit: ${hide(String(err?.message ?? err))}`));
