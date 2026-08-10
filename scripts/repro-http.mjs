/* Reproduit la chaîne HTTP réelle : express.json(2mb) + getChunkUpload + chunk handler.
   Utilise les memes middlewares que server.js pour exposer le souci de transport. */
import express from "express";
import { uploadHandlers, getChunkUpload } from "../src/uploads.js";
import { init as initStore } from "../src/store.js";

const PORT = 3901;

async function main() {
  await initStore();
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  const h = uploadHandlers();
  app.post("/api/upload/init", h.init);
  app.post("/api/upload/:uploadId/chunk/:index", getChunkUpload(), h.chunk);
  app.post("/api/upload/:uploadId/complete", h.complete);
  app.listen(PORT, async () => {
    const uploadId = crypto.randomUUID();
    const chunkSize = 8 * 1024 * 1024;
    const buf = Buffer.alloc(chunkSize - 1000, 90); // un peu en dessous de 8 Mo
    const b = Buffer.from(JSON.stringify({ uploadId, name: "test.bin", size: buf.length, mime: "application/octet-stream", chunkSize, expectedChunks: 1 }));
    let r = await fetch(`http://localhost:${PORT}/api/upload/init`, { method: "POST", headers: { "Content-Type": "application/json" }, body: b });
    console.log("init:", r.status, await r.text());
    r = await fetch(`http://localhost:${PORT}/api/upload/${uploadId}/chunk/0`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: buf });
    console.log("chunk/0:", r.status, r.status === 400 ? await r.text() : "");
    process.exit(0);
  });
}

main().catch((e) => { console.error(e); process.exit(2); });