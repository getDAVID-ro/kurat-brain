---
description: Mută baza de date (Neon) și fișierele (Vercel Blob) ale site-ului kurat.ro în contul vostru Vercel, după ce DWF v-a transferat repo-ul GitHub și proiectul Vercel
---

# Transferul stocării kurat.ro

Rulezi asta pentru clientul kurat.ro, după ce DWF i-a transferat repo-ul GitHub `kurat-brain` și proiectul Vercel `kurat`. Baza Neon `kurat-db` (și magazinul Blob, dacă DWF a avut unul) au rămas în echipa Vercel a DWF (`dwf3`). Variabilele lor (`DATABASE_URL`, `BLOB_READ_WRITE_TOKEN` …) au venit cu proiectul și arată încă spre resursele DWF. Dacă ar rămâne așa, site-ul clientului ar scrie în continuare în contul DWF și ar pierde totul când DWF le șterge.

Creezi echivalentele în echipa clientului, muți datele, legi site-ul de ele și verifici. **DWF șterge apoi resursele vechi; tu nu le ștergi niciodată.**

Contextul complet e în `docs/transfer-client.md`. Vorbește cu utilizatorul în română, pe scurt, și confirmă cu el înainte de fiecare pas care creează sau schimbă ceva în contul lui.

## Reguli

- Nu afișa niciodată în întregime o parolă, un token sau o adresă de bază de date. Arată doar începutul și finalul, de exemplu `postgres://…@ep-…us-east-1…`.
- Nu șterge și nu modifica resursele vechi ale DWF (Neon `kurat-db` și Blob-ul din echipa `dwf3`). Din ele doar citești.
- Credențialele stau temporar în `.env.transfer-vechi` și `.env.transfer-nou`, în rădăcina repo-ului (ignorate de git prin `.env*`). Le ștergi la final și nu le pui niciodată în git.
- Publici doar cu `vercel redeploy` sau cu `git push`, niciodată cu `vercel --prod` din folder: acela ar urca și fișierele locale cu credențiale.
- Dacă un pas nu merge cum e descris, oprește-te, spune ce ai văzut și întreabă. Nu improviza ocolișuri peste date.
- Datele includ date personale din formulare (cereri de ofertă: nume, telefon). Noile resurse se creează în UE, Frankfurt (`fra1`), dacă utilizatorul nu cere altceva.

## Pașii

### 1. Verificări

1. Lucrezi în rădăcina repo-ului, unde sunt `package.json` și `vercel.json`.
2. `vercel --version` (cel puțin 65) și `vercel whoami`. Dacă CLI-ul lipsește: `npm i -g vercel`. Dacă nu e logat: `vercel login`.
3. `vercel teams ls`, apoi `vercel switch <echipa clientului>`. Confirmă cu utilizatorul echipa.
4. `vercel link --project kurat --yes`, apoi `vercel project ls`: proiectul e în echipa clientului.
5. Legătura cu GitHub:
   - `git remote get-url origin` arată repo-ul clientului, nu `getDAVID-ro/kurat-brain`;
   - `vercel git connect <adresa repo-ului> --yes`. Dacă spune că e deja legat, e bine.
   - Dacă cere aplicația Vercel pe GitHub, utilizatorul o instalează pe contul lui, cu acces la repo, apoi repeți.

### 2. Credențialele vechi (doar citire)

1. `vercel env pull .env.transfer-vechi --environment=production --yes`.
2. Ai nevoie de:
   - `DATABASE_URL`: baza veche;
   - `DWF_BLOB_TOKEN` sau `BLOB_READ_WRITE_TOKEN`: magazinul Blob vechi, dacă există.
3. Variabilele Neon sunt „sensitive” și pot veni goale. Atunci cere-i utilizatorului `OLD_DATABASE_URL` (DWF i-o trimite separat) și pune-o în `.env.transfer-vechi`.
4. Verifică dacă magazinul vechi are fișiere: `vercel blob list --json --limit 1000 --rw-token <vechi>`.
5. Spune-i utilizatorului ce ai găsit.

### 3. Variabilele vechi scoase din proiect

Noile resurse adaugă variabile cu aceleași nume. Le scoți pe cele vechi din toate mediile, după ce le-ai salvat la pasul 2:
- `DATABASE_URL`, `DATABASE_URL_UNPOOLED`;
- `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL_NO_SSL`, `POSTGRES_PRISMA_URL`, `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`;
- `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`;
- `NEON_PROJECT_ID`;
- `BLOB_READ_WRITE_TOKEN`.

Folosești `vercel env rm <NUME> <mediu> --yes`. Site-ul publicat nu se oprește: variabilele schimbate contează abia la următoarea publicare.

**Nu atinge:**
- `BRAIN_OPEN_ACCESS` și celelalte variabile ale site-ului;
- `DWF_BLOB_TOKEN`, care rămâne până la pasul 7, pentru că din el citește `npm run blob:copy`.

### 4. Resursele noi, în echipa clientului

1. Neon, după ce ai confirmat cu utilizatorul:
   ```
   vercel integration add neon --name kurat-db --meta region=fra1 -e production --no-env-pull
   ```
   Dacă Neon nu e instalat în echipa clientului, Vercel îi cere să accepte termenii. Planul gratuit ajunge.
2. Blob:
   ```
   vercel blob create-store kurat-media --access public --region fra1 --yes -e production -e preview -e development
   ```
3. Dacă Neon e în `fra1`, pune funcțiile tot acolo, cu acordul utilizatorului: `"regions": ["fra1"]` în `vercel.json`, apoi commit.
4. `vercel env pull .env.transfer-nou --environment=production --yes`. Verifici că apar noile `DATABASE_URL` și `BLOB_READ_WRITE_TOKEN`, diferite de cele vechi.

### 5. Baza de date

Nu e nevoie de `pg_dump`: site-ul copiază singur baza veche la prima pornire cu o bază Neon goală.
1. `vercel env add BRAIN_IMPORT_DATABASE_URL production --sensitive`, cu valoarea veche (prin stdin, nu în linia de comandă).
2. Importul se face la publicarea de la pasul 7.

### 6. Fișierele din Blob (doar dacă magazinul vechi are fișiere)

1. `npm run blob:copy`. Scriptul citește din `.env.local`:
   - `DWF_BLOB_TOKEN`: magazinul vechi;
   - `BLOB_READ_WRITE_TOKEN`: magazinul nou.

   Dacă `DWF_BLOB_TOKEN` lipsește din `.env.local`, îl adaugi cu tokenul vechi din `.env.transfer-vechi`.
2. Scriptul copiază fiecare fișier cu aceeași cale și sare peste cele deja copiate. La final verifică fiecare fișier și spune „✓ Gata: toate cele … fișiere sunt în Blob-ul vostru”. Dacă lipsesc fișiere, îl rulezi din nou.
3. Adresele nu trebuie rescrise: site-ul își calculează adresa Blob din token.

### 7. Publicarea și verificarea

1. Scoate `DWF_BLOB_TOKEN` din proiect, din toate mediile.
2. Republică pentru noile variabile: iei adresa ultimei publicări de producție din `vercel ls --prod`, apoi `vercel redeploy <adresa> --environment production`.
3. Verifici:
   - `/`, `/manage/` și `/robots.txt` răspund 200;
   - `/api/stare` arată `"blob":"BLOB_READ_WRITE_TOKEN"` și `"neon":true`;
   - în `vercel logs <adresa>` apare `Neon: prima copie urcată (import din baza veche)`;
   - conținutul din `/manage` e cel vechi (de exemplu, numărul de cereri de ofertă).
4. Scoate `BRAIN_IMPORT_DATABASE_URL` (`vercel env rm BRAIN_IMPORT_DATABASE_URL production --yes`) și republică.
5. Rulează încă o dată `npm run blob:copy`, ca să prindă ce s-a încărcat între timp.

### 8. Finalul

1. Șterge `.env.transfer-vechi` și `.env.transfer-nou`.
2. Scrie-i utilizatorului un rezumat: ce s-a mutat, unde sunt resursele noi (numele, echipa, regiunea) și ce a rămas de făcut.
3. Dă-i mesajul de trimis la DWF, gata de copiat:
   > Transferul stocării kurat.ro e gata: baza Neon și fișierele Blob sunt în contul nostru și site-ul folosește resursele noi (verificat pe <data>). Puteți șterge din echipa DWF baza Neon „kurat-db” și magazinul Blob al Kurat, dacă există.
