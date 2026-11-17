# Transferul kurat.ro către client

> Pregătit pe 17.11.2026, după modelul boxe-depozitare.ro.
>
> - **Repo-ul** trece la client prin transferul de pe GitHub.
> - **Proiectul Vercel** trece printr-un link de claim, care mută odată cu proiectul și baza Neon.
> - **Fișierele din Vercel Blob** nu se mută: clientul își face Blob-ul lui și le copiază cu `npm run blob:copy`, apoi DWF îl șterge pe al lui.

## Ce există acum, la DWF

| Resursă | Unde | Detalii |
|---|---|---|
| Repo | GitHub `getDAVID-ro/kurat-brain` (trebuie făcut privat de un admin al organizației) | ramura de producție `main`; `main` publică singur pe Vercel |
| Proiect Vercel | echipa `dwf3`, proiectul `kurat` | producție: https://kurat-eight.vercel.app |
| Baza de date | Neon `kurat-db-fra`, prin Vercel Marketplace (resursa `store_eMmpoytY7y59hnCG`) | Frankfurt (`fra1`, `eu-central-1`; funcțiile sunt tot în `fra1`, din `vercel.json`), planul Free; `DATABASE_URL`, `POSTGRES_*`, `PG*`, `NEON_PROJECT_ID` doar pe Production |
| Fișiere | Vercel Blob: **încă niciunul** | echipa `dwf3` a atins limita de utilizare la 17.11.2026. Imaginile site-ului stau în repo (`media/`) și se publică odată cu codul. Încărcarea unei imagini noi din `/manage` de pe Vercel e refuzată, cu un mesaj clar, până există Blob |
| Copia tokenului Blob | variabila `DWF_BLOB_TOKEN`, pe toate mediile | se pune doar dacă DWF creează un Blob pentru Kurat înainte de transfer: același token ca `BLOB_READ_WRITE_TOKEN`, sub alt nume, ca `npm run blob:copy` să poată citi din Blob-ul DWF și după ce clientul șterge `BLOB_READ_WRITE_TOKEN`. Id-ul magazinului se trece și în `src/core/stare.mjs` (`DWF_BLOB_STORES`) |
| Panoul fără cont | variabila `BRAIN_OPEN_ACCESS=1`, pe Production | `/manage` se deschide oricui are adresa (cerut de DWF). Pentru a cere din nou autentificare, se șterge variabila. Primul administrator se creează atunci cu `BRAIN_SETUP_KEY` și `/manage/setup/?key=…` |

Cum folosește codul stocarea (`src/core/cloud.mjs`):
- **Neon.** Baza de lucru rămâne SQLite; Neon ține copia de referință (tabelul `brain_state`, versionat, cu lacăt între instanțe). Fiecare salvare din `/manage` și fiecare cerere din formular urcă o versiune nouă înainte de răspuns. O bază Neon goală se umple la prima pornire:
  - din baza veche, dacă e setat `BRAIN_IMPORT_DATABASE_URL`;
  - altfel din `seed/brain.db`.
- **Blob.** Site-ul folosește `DWF_BLOB_TOKEN` cât timp există, apoi `BLOB_READ_WRITE_TOKEN`. Adresa publică vine din id-ul magazinului, deci după mutare imaginile se cer singure de la Blob-ul nou.

**De ce contează Blob la transfer.** Vercel copiază variabilele de mediu odată cu proiectul, dar nu și magazinul Blob. Ordinea e:
1. transferul;
2. copierea la client;
3. confirmarea clientului;
4. abia apoi ștergerea la DWF.

## Ordinea transferului

### Înainte (o dată)

1. Clientul are un cont sau o organizație GitHub, un cont Vercel și, pe calculator, Node.js 24 și Git.
2. DWF își păstrează o copie a credențialelor vechi, pentru orice eventualitate. Fișierul stă în rădăcina repo-ului, unde `.env*` e ignorat de git, și nu se trimite pe email:
   ```bash
   npx vercel env pull .env.transfer-dwf --environment=production --yes
   ```

### Transferul (DWF)

1. **GitHub:** repo → Settings → Danger Zone → **Transfer ownership** → contul clientului. Sau:
   ```bash
   gh api -X POST repos/getDAVID-ro/kurat-brain/transfer -f new_owner=<cont-client>
   ```
2. **Vercel, cu link de claim.** Linkul e valabil 24 de ore și cine îl are poate lua proiectul, deci se trimite doar clientului. Codul se generează din rădăcina repo-ului:
   ```bash
   npx vercel api "/projects/kurat/transfer-request?teamId=team_qqACD63OhjkuSJknspI9l6iQ" -X POST --input - <<< '{}'
   ```
   Linkul:
   ```
   https://vercel.com/claim-deployment?code=<code>&returnUrl=https%3A%2F%2Fkurat-eight.vercel.app
   ```
   - Clientul îl deschide, intră în contul lui Vercel, alege echipa și apasă **Transfer**. Odată cu proiectul se mută baza Neon `kurat-db-fra` și variabilele de mediu.
   - Dacă linkul expiră, generați altul cu aceeași comandă.
   - **Varianta fără link:** Settings → General → **Transfer Project** (trebuie să fiți membru în echipa clientului). Atunci Neon nu se mută, iar clientul rulează `/transfer-stocare` (mai jos) în locul mesajului.
3. **Domeniul:** la 17.11.2026 proiectul are doar adresele `*.vercel.app`. Dacă între timp s-a adăugat `kurat.ro` în echipa DWF: Domains → ⋯ → **Move**.

### Mesajul pentru client (gata de trimis)

Linkul de claim se trimite separat, înainte. În mesaj, `<cont-github>` devine contul clientului:

> 1. În proiectul de pe Vercel: Storage → Create → Blob, public, Frankfurt, legat de proiect. Dacă proiectul are deja variabila `BLOB_READ_WRITE_TOKEN`, ștergeți-o întâi: e de la depozitul DWF.
> 2. Cu Node 24 sau mai nou:
>    - `git clone https://github.com/<cont-github>/kurat-brain.git`
>    - `cd kurat-brain`
>    - `npx vercel link` (alegeți proiectul `kurat`)
>    - `npx vercel env pull .env.local`
>    - `npm run blob:copy`
>
>    Copierea durează câteva minute și la final confirmă fiecare fișier.
> 3. În Settings → Environment Variables ștergeți `DWF_BLOB_TOKEN`, apoi faceți Redeploy.
> 4. Rulați încă o dată `npm run blob:copy`, ca să prindă ce s-a încărcat între timp.
>
> Verificare: https://kurat-eight.vercel.app/api/stare trebuie să arate `"blob":"BLOB_READ_WRITE_TOKEN"` și `"neon":true`. Pașii sunt și în README, la „Mutarea imaginilor în Blob-ul vostru”.

Cât timp DWF n-a avut Blob pentru Kurat, `npm run blob:copy` nu are ce copia. Pasul 1 rămâne totuși util: cu Blob-ul lor, clientul poate încărca imagini noi din `/manage` direct pe Vercel.

`/api/stare` (`src/core/stare.mjs`) nu afișează niciun token. Arată:
- `blob`: ce token Blob folosește site-ul;
- `neon`: dacă proiectul are `DATABASE_URL`;
- `import`: dacă importul din baza veche e încă setat;
- `accesLiber`: dacă panoul e deschis fără cont.

După transfer, Settings → Git din proiectul clientului trebuie să arate repo-ul lui (`<cont-github>/kurat-brain`, ramura `main`). Dacă nu, îl leagă cu Connect Git Repository.

### Varianta cu Claude Code: `/transfer-stocare`

Pentru transferul fără link de claim (Neon rămâne la DWF) sau dacă clientul preferă să fie ghidat. Se rulează în rădăcina repo-ului, în Claude Code, cu comanda `/transfer-stocare` (`.claude/commands/transfer-stocare.md`). Comanda:
1. verifică echipa, proiectul și legătura cu GitHub;
2. ia adresa bazei vechi, sau o cere;
3. scoate variabilele vechi și creează în echipa clientului Neon `kurat-db` și Blob `kurat-media`, conectate la proiect;
4. setează `BRAIN_IMPORT_DATABASE_URL`: la prima pornire, site-ul copiază singur baza veche în cea nouă;
5. copiază fișierele cu `npm run blob:copy`;
6. publică și verifică, apoi scoate variabilele de import și fișierele temporare;
7. dă mesajul de trimis la DWF.

Resursele vechi nu le atinge.

### După confirmarea clientului (DWF)

```bash
npx vercel switch dwf3
```

- **Blob**, dacă a existat: `npx vercel blob delete-store <store_id>`. Dacă refuză ștergerea pentru că magazinul e încă legat de proiect: Storage → magazinul → Projects → Disconnect, apoi din nou comanda.
- **Neon:** dacă s-a mutat cu linkul de claim, nu mai apare în `npx vercel integration list --all`. Dacă a rămas în `dwf3`: `npx vercel integration resource delete kurat-db-fra --disconnect-all`. Integrarea Neon din echipa `dwf3` rămâne: o folosesc și celelalte proiecte.
- DWF șterge copia locală `.env.transfer-dwf` și `.env.local`, care au credențialele vechi.
