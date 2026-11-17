# Transferul proiectului Kurat către client

Site-ul rulează pe Vercel. Conținutul (Brain-ul) stă într-o bază **Neon**. Imaginile din depozit vin cu codul. Imaginile încărcate din panou merg în **Vercel Blob**, dacă e conectat; fără Blob, pe Vercel încărcarea e refuzată, cu un mesaj clar.

Cum funcționează (`src/core/cloud.mjs`):
- Baza de lucru e tot SQLite. Neon ține copia de referință (tabelul `brain_state`), iar fiecare modificare urcă o versiune nouă.
- La prima pornire, cu o bază Neon goală, aplicația se umple singură:
  - dacă e setat `BRAIN_IMPORT_DATABASE_URL`, din baza veche;
  - altfel, din `seed/brain.db`.
- La prima pornire cu un Blob nou conectat, dacă e setat `BRAIN_IMPORT_BLOB_TOKEN`, imaginile se copiază singure din Blob-ul vechi.

Variabile pe Vercel (Production):

| Variabilă | Rol |
|---|---|
| `DATABASE_URL` (+ `POSTGRES_*`, `PG*`) | baza Neon; o pune integrarea Neon |
| `BLOB_READ_WRITE_TOKEN` | Blob-ul; îl pune conectarea magazinului Blob |
| `BRAIN_OPEN_ACCESS=1` | panoul `/manage` fără cont (oricine are adresa poate edita) |
| `BRAIN_IMPORT_DATABASE_URL` | doar la transfer: adresa bazei Neon vechi |
| `BRAIN_IMPORT_BLOB_TOKEN` | doar la transfer: tokenul Blob-ului vechi |

## 1. La noi (DWF), înainte de transfer

1. Luăm adresa bazei Neon actuale (`kurat-db`): Vercel → Storage → kurat-db → **Open in Neon** → **Connect** → copiem connection string-ul (cel cu `-pooler`).
2. Dacă avem un Blob conectat: Vercel → Storage → magazinul Blob → `BLOB_READ_WRITE_TOKEN`.
3. Le trimitem clientului **privat** (nu în GitHub, nu pe email necriptat dacă se poate evita), împreună cu comanda de la pasul 3.
4. Transferăm depozitul GitHub: Settings → Transfer ownership.
5. Transferăm proiectul Vercel: Project → Settings → Transfer.

Până importă clientul, site-ul merge în continuare pe baza noastră. Ce se modifică între timp ajunge și la el, pentru că importul copiază starea din momentul primei lui porniri.

## 2. La client, după ce a acceptat ambele transferuri

Clientul deschide Claude Code în depozitul clonat și lipește comanda de mai jos, cu cele două valori primite de la noi.

## 3. Comanda pentru client (de lipit în Claude Code)

```text
Preiau proiectul Kurat (site + Brain) după transfer. Depozitul GitHub e clonat în folderul curent,
iar proiectul Vercel „kurat” e deja în echipa mea. Urmează docs/TRANSFER.md, secțiunea 4, pas cu pas:
creează-mi baza Neon și magazinul Blob în echipa mea, conectează-le la proiect (doar Production),
setează importul din baza veche, redeployează și verifică site-ul și panoul /manage.
Valorile vechi (secrete: nu le scrie în niciun fișier din depozit și nu le afișa înapoi):
BRAIN_IMPORT_DATABASE_URL=<connection string Neon primit de la DWF>
BRAIN_IMPORT_BLOB_TOKEN=<token Blob primit de la DWF, sau „nu există”>
La final spune-mi ce ai creat și ce trebuie să-i confirm agenției ca să-și șteargă copiile.
```

## 4. Pașii pe care îi face Claude la client

Toate comenzile rulează din folderul depozitului. `npx vercel` folosește contul clientului.

1. **Autentificare și legare**
   - `npx vercel@latest whoami`. Dacă nu e logat: `npx vercel login`.
   - `npx vercel link --yes --project kurat`. Dacă are mai multe echipe, se adaugă `--scope <echipa>`.
   - `npm install`
2. **Curăță variabilele vechi ale bazei**, dacă au rămas după transfer:
   - `npx vercel env ls production`
   - Dacă există `DATABASE_URL` / `POSTGRES_*` / `PG*` / `NEON_PROJECT_ID` de la integrarea noastră, le șterge cu `npx vercel env rm <NUME> production --yes`.
   - Nu se atinge `BRAIN_OPEN_ACCESS`.
3. **Baza Neon nouă**
   - `npx vercel integration add neon --help`: arată planurile; se alege planul Free.
   - `npx vercel integration add neon --name kurat-db --billing-plan <id-plan-free> -e production`
   - Regiunea: Washington (`iad1`), aceeași cu funcțiile site-ului.
   - Verificare: `npx vercel env ls production` arată `DATABASE_URL`.
4. **Blob nou**
   - `npx vercel blob create-store kurat-media --access public --region iad1 --environment production --yes`
   - Verificare: `BLOB_READ_WRITE_TOKEN` apare în `npx vercel env ls production`.
5. **Importul din copiile vechi.** Valorile se dau prin stdin, nu în linia de comandă:
   - `npx vercel env add BRAIN_IMPORT_DATABASE_URL production --sensitive`
   - `npx vercel env add BRAIN_IMPORT_BLOB_TOKEN production --sensitive` (doar dacă există)
6. **Deploy:** `npx vercel deploy --prod --yes`
7. **Verificare**
   - Pagina principală se încarcă: același conținut ca înainte.
   - `/manage/` se deschide. O modificare mică de test, salvată și apoi anulată, rămâne după reîncărcare.
   - În logurile funcției (`npx vercel logs <url>` sau dashboard → Logs) apare `Neon: prima copie urcată (import din baza veche)`, iar cu Blob vechi `Blob: N fișiere copiate din magazinul vechi`.
   - Formularul de rezervare trimite (nu mai răspunde 503).
8. **Curățenie**
   - Șterge `BRAIN_IMPORT_DATABASE_URL` și `BRAIN_IMPORT_BLOB_TOKEN`: `npx vercel env rm … production --yes`.
   - Redeploy: `npx vercel deploy --prod --yes`.
9. **Confirmare către agenție**: „importul e făcut, puteți șterge baza Neon `kurat-db` și Blob-ul vostru”.

## 5. La noi, după confirmarea clientului

- Vercel (echipa dwf3) → Storage → `kurat-db` → Settings → **Delete**. La fel pentru Blob, dacă există.
- Se dezactivează connection string-ul trimis: îl rotim în Neon înainte de ștergere, dacă ștergerea se amână.

## Notă de securitate

`BRAIN_OPEN_ACCESS=1` lasă panoul deschis oricui are adresa: poate edita site-ul și vede cererile clienților (nume, telefon). Pentru a cere din nou autentificare, se șterge variabila. Primul cont de administrator se creează cu `BRAIN_SETUP_KEY=<cheie lungă>` și linkul `/manage/setup/?key=<cheie>`.
