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
  const expectedChunks = Math.ceil(file.size / CHUNK_SIZE);

  // 1. init — renvoie les chunks déjà reçus (reprise après coupure)
  const init = await fetch("/api/upload/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploadId,
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
      chunkSize: CHUNK_SIZE,
      expectedChunks,
    }),
  });
  if (!init.ok) throw new Error(`init échec (${init.status})`);
  const { receivedChunks } = await init.json();

  const have = new Set(receivedChunks);

  // 2. envoi des chunks manquants, séquentiel par fichier
  for (let i = 0; i < expectedChunks; i++) {
    if (have.has(i)) {
      onProgress(Math.round(((i + 1) / expectedChunks) * 100));
      continue;
    }
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const slice = file.slice(start, end);

    const buf = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(slice);
    });

    // retry local : 2 tentatives avec backoff
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        const res = await fetch(`/api/upload/${uploadId}/chunk/${i}`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: buf,
        });
        if (res.ok) ok = true;
        else if (res.status === 404) throw new Error("upload expiré");
      } catch (err) {
        if (attempt === 1) throw err;
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