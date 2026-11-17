# kurat-brain

Brain `/manage` și site-ul public pentru kurat.ro: registru de entități, propagare, pagini randate din Brain (Node 24).

## Rulare locală

```bash
npm install
npm start          # http://localhost:3000, panoul la /manage (fără parolă local, cu BRAIN_DEV_LOGIN=1)
npm test
```

Conținutul pornește din `seed/brain.db` (copia publică, fără date personale), care se copiază în `data/brain.db` la prima rulare. Imaginile site-ului stau în `media/`.

## Pe Vercel

- **Baza Neon.** Conținutul și cererile din formular se păstrează în Neon (`DATABASE_URL`, `src/core/cloud.mjs`). Baza de lucru e tot SQLite, iar Neon ține copia de referință; fiecare salvare urcă o versiune nouă.
- **Imaginile încărcate din `/manage`** merg în Vercel Blob (`BLOB_READ_WRITE_TOKEN`). Cele din `media/` se publică odată cu codul.
- **`BRAIN_OPEN_ACCESS=1`** deschide panoul fără cont.
- **Starea:** `/api/stare` arată Blob-ul folosit și dacă site-ul e legat de Neon, fără să afișeze vreun token.

## Mutarea imaginilor în Blob-ul vostru

După transferul proiectului Vercel `kurat`, imaginile încărcate din panou sunt încă în Blob-ul DWF, dacă există, și trebuie mutate în Blob-ul vostru:

1. În proiectul de pe Vercel: Storage → Create → Blob, public, Frankfurt, legat de proiect. Dacă proiectul are deja variabila `BLOB_READ_WRITE_TOKEN`, ștergeți-o întâi: e de la depozitul DWF.
2. Cu Node 24 sau mai nou:
   - `git clone https://github.com/<cont-github>/kurat-brain.git`
   - `cd kurat-brain`
   - `npx vercel link` (alegeți proiectul `kurat`)
   - `npx vercel env pull .env.local`
   - `npm run blob:copy`

   Copierea durează câteva minute și la final confirmă fiecare fișier.
3. În Settings → Environment Variables ștergeți `DWF_BLOB_TOKEN`, apoi faceți Redeploy.
4. Rulați încă o dată `npm run blob:copy`, ca să prindă ce s-a încărcat între timp.

Verificare: https://kurat-eight.vercel.app/api/stare trebuie să arate `"blob":"BLOB_READ_WRITE_TOKEN"`.

- `<cont-github>` e contul vostru de GitHub, unde DWF a transferat repo-ul.
- Ce face DWF înainte și după: `docs/transfer-client.md`.
- Varianta ghidată, cu Claude Code: `/transfer-stocare`.
