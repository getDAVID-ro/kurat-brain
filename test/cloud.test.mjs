// Brain-ul pe Vercel ține copia de referință în Neon: copia bazei (gzip + base64) se face și se încarcă fără să închidă conexiunea.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imported} from './helpers.mjs';
import {createStore} from '../src/core/store.mjs';
import {snapshot, loadInto, pack, unpack} from '../src/core/cloud.mjs';
import {openDb} from '../src/core/db.mjs';

test('copia bazei: împachetată, despachetată și încărcată în altă bază deschisă, cu tot conținutul și contoarele', () => {
  const {db} = imported();
  const ana = createStore(db, {user: {name: 'Ana', email: 'ana@kurat.ro'}});
  const firma = ana.singleton('firma');
  ana.update('firma', firma.id, {telefon: '0722 000 111'});
  const buf = unpack(pack(snapshot(db)));

  const other = openDb(':memory:');
  loadInto(other, buf);
  assert.equal(createStore(other).singleton('firma').telefon, '0722 000 111');
  const count = d => d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table'").get().n;
  assert.equal(count(other), count(db));
  // o înregistrare nouă primește următorul id, nu unul refolosit
  const last = db.prepare('SELECT MAX(id) n FROM change_events').get().n;
  createStore(other, {user: {name: 'Ana'}}).update('firma', firma.id, {telefon: '0722 000 222'});
  assert.ok(other.prepare('SELECT MAX(id) n FROM change_events').get().n > last);
  // a doua încărcare înlocuiește, nu adaugă
  loadInto(other, buf);
  assert.equal(createStore(other).singleton('firma').telefon, '0722 000 111');
  assert.equal(other.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('primul administrator: doar cu cheia din mediu și doar cât nu există niciun cont', async () => {
  const {setupKeyOk, needsSetup, createUser} = await import('../src/auth/auth.mjs');
  const {db} = imported();
  delete process.env.BRAIN_SETUP_KEY;
  assert.equal(needsSetup(db), false, 'fără cheie, nu există configurare');
  process.env.BRAIN_SETUP_KEY = 'cheie-de-test-1234567890';
  try {
    db.exec('DELETE FROM sessions; DELETE FROM users');
    assert.equal(needsSetup(db), true);
    assert.equal(setupKeyOk('greșit'), false);
    assert.equal(setupKeyOk('cheie-de-test-1234567890'), true);
    createUser(db, {email: 'ana@kurat.ro', name: 'Ana', role: 'admin', password: 'o-parola-lunga'});
    assert.equal(needsSetup(db), false, 'după primul cont, linkul nu mai funcționează');
  } finally { delete process.env.BRAIN_SETUP_KEY; }
});
