// /api/stare: ce token Blob folosește site-ul și dacă e legat de Neon (docs/transfer-client.md, README „Mutarea imaginilor în Blob-ul vostru”).
// Cât timp există DWF_BLOB_TOKEN, imaginile sunt încă în Blob-ul DWF; după ce clientul îl șterge și republică, trebuie să
// arate "blob":"BLOB_READ_WRITE_TOKEN". Nu afișează niciun token.
// Id-urile magazinelor Blob ale DWF pentru Kurat (se completează când DWF creează unul; azi Kurat n-are Blob la DWF).
export const DWF_BLOB_STORES = [];
const storeId = token => token?.split('_')[3] ?? '';

export function stare(env = process.env) {
  const dwf = env.DWF_BLOB_TOKEN?.trim();
  const own = env.BLOB_READ_WRITE_TOKEN?.trim();
  let blob = null;
  if (dwf) blob = 'DWF_BLOB_TOKEN';
  else if (own) blob = DWF_BLOB_STORES.includes(storeId(own)) ? 'BLOB_READ_WRITE_TOKEN (încă depozitul DWF)' : 'BLOB_READ_WRITE_TOKEN';
  return {blob, neon: Boolean(env.DATABASE_URL ?? env.POSTGRES_URL), import: Boolean(env.BRAIN_IMPORT_DATABASE_URL), accesLiber: env.BRAIN_OPEN_ACCESS === '1'};
}
