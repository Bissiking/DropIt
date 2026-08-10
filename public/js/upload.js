/* Upload resumable par chunks.
   Reprise native : on interroge /status ; les chunks déjà reçus sautent.
   Renvoie le descripteur de fichier à rattacher à un partage. */

const CHUNK_SIZE = 8 * 1024 * 1024; // 8 Mo, aligné côté serveur

function makeUploadId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "u-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
}

export async function uploadFile(file, { onProgress = () => {} } = {}) {
  const uploadId = makeUploadId();

  // 1. init — le serveur impose sa propre taille de chunk ; on découpe selon sa réponse.
  const init = await fetch("/api/upload/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploadId,
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
      chunkSize: CHUNK_SIZE,
      expectedChunks: Math.ceil(file.size / CHUNK_SIZE),
    }),
  });
  if (!init.ok) throw new Error(`init échec (${init.status})`);
  const initData = await init.json();

  const chunkSize = initData.chunkSize || CHUNK_SIZE;
  const expectedChunks = initData.expectedChunks ?? Math.ceil(file.size / chunkSize);
  const have = new Set(initData.receivedChunks || []);

  // 2. envoi des chunks manquants, séquentiel par fichier
  for (let i = 0; i < expectedChunks; i++) {
    if (have.has(i)) {
      onProgress(Math.round(((i + 1) / expectedChunks) * 100));
      continue;
    }
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const slice = file.slice(start, end);

    const buf = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(slice);
    });

    // retry local : 2 tentatives avec backoff (pannes réseau uniquement).
    // Une réponse HTTP non-2xx est définitive : on remonte le message serveur.
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        const res = await fetch(`/api/upload/${uploadId}/chunk/${i}`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: buf,
        });
        if (res.ok) ok = true;
        else {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `chunk ${i} refusé (${res.status})`);
        }
      } catch (err) {
        const http = err && typeof err.message === "string" && /refusé|expiré/.test(err.message);
        if (http || attempt === 1) throw err;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    onProgress(Math.round(((i + 1) / expectedChunks) * 100));
  }

  // 3. complétion — concaténation serveur + empreinte
  const complete = await fetch(`/api/upload/${uploadId}/complete`, { method: "POST" });
  if (!complete.ok) throw new Error(`complétion échec (${complete.status})`);
  const { file: descriptor } = await complete.json();
  onProgress(100);
  return descriptor;
}