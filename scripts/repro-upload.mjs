/* Reproduit init -> chunk -> complete via les handlers réels. */
import { config } from "../src/config.js";
import { init as initStore } from "../src/store.js";
import { uploadHandlers } from "../src/uploads.js";

async function call(handler, req) {
  const res = { json: (v) => { res._json = v; }, status: (s) => { res._status = s; return res; } };
  await handler({ params: {}, body: {}, ...req }, res);
  return { status: res._status, body: res._json };
}

async function main() {
  await initStore();
  const h = uploadHandlers();

  const uploadId = crypto.randomUUID();
  const buf = Buffer.alloc(8 * 1024 * 1024, 65); // chunk exact de 8 Mo
  const r1 = await call(h.init, {
    body: { uploadId, name: "test.mkv", size: buf.length, mime: "video/x-matroska", chunkSize: 8 * 1024 * 1024, expectedChunks: 1 },
  });
  console.log("init:", r1.status, r1.body);

  const r2 = await call(h.chunk, { params: { uploadId, index: "0" }, chunk: buf });
  console.log("chunk/0:", r2.status, r2.body);

  const r3 = await call(h.complete, { params: { uploadId } });
  console.log("complete:", r3.status, r3.body && { id: r3.body.file?.id, size: r3.body.file?.size });
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(2); });