import { renderBank, setBank, setBankState, formatBytes, plural, formatCountdown } from "./nixie.js";
import { uploadFile } from "./upload.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  share: null,
  files: [],           // fichiers sélectionnés (File)
  uploaded: new Map(), // uuid → { file, progress, }
  duration: "24h",
  createdUrl: null,
};

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("is-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-show"), 2600);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

function showView(name) {
  $$("#nav button").forEach((b) => {
    const active = b.dataset.view === name;
    b.toggleAttribute("aria-current", active);
  });
  $("#view-dashboard").hidden = name !== "dashboard";
  $("#view-upload").hidden = name !== "upload";
  if (name === "dashboard") renderShares();
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

async function fetchShares() {
  const res = await fetch("/api/shares");
  if (res.status === 401) { window.location.href = "/auth/login"; return []; }
  if (!res.ok) throw new Error("liste indisponible");
  return (await res.json()).shares;
}

function shareLink(share) {
  return `${location.origin}/d/${share.slug}`;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function deleteShareEl(id) {
  const panel = $(`#share-${id}`);
  if (panel) panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-in" }).onfinish = () => panel.remove();
}

function statusForSet(status) {
  if (status.state === "expired") return "off";
  if (status.state === "deleted") return "off";
  if (status.state === "expiring") return "flicker";
  return "on";
}

const D = "0123456789";
function countKeys(n) {
  const s = String(n);
  const padded = s.padStart(3, "0").slice(-3);
  return [...padded];
}

function panelMarkup(share) {
  const status = share.status;
  const cd = formatCountdown(status.remaining);
  const escName = share.files.map((f) => f.name.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])));

  const filesHtml = share.files.map((f, i) => `
    <div class="file-row">
      <span class="f-name" title="${escName[i]}">${escName[i]}</span>
      <span class="f-mime">${(f.mime.split("/")[1] && f.mime.split("/")[1].slice(0, 12)) || "?"}</span>
      <span class="f-size">${formatBytes(f.size)}</span>
    </div>`).join("");

  const recovered = status.state === "deleted";

  return `
  <article class="share-panel" id="share-${share.id}" data-state="${status.state}" data-expires="${share.expiresAt}" ${share.deletedAt ? `data-deleted="${share.deletedAt}"` : ""}>
    <div class="share-top">
      <div style="min-width:0">
        <div class="share-title">${share.fileCount} ${plural(share.fileCount, "fichier", "fichiers")} · ${formatBytes(share.totalSize)}</div>
        <div class="share-slug">${share.slug}</div>
      </div>
      <div class="status-lamp" data-state="${status.state}">
        <span class="lamp" aria-hidden="true"></span>
        <span>${status.label}</span>
      </div>
    </div>

    <div class="share-metrics">
      <div class="metric is-hero">
        <div class="metric-cap">${recovered ? "Récupérable pendant" : "Temps restant"}</div>
        <div class="bank-row tail" data-count="cd" role="img" aria-label="${status.label}"></div>
        <div class="cap" style="margin-top:6px">${recovered ? "réactivation libre" : status.state === "expired" ? "expiré, liens fermés" : status.state === "expiring" ? "en fin de vie" : "lien actif"}</div>
      </div>
      <div class="metric">
        <div class="metric-cap">Fichiers</div>
        <div class="bank-row tail" data-count="files" role="img" aria-label="${share.fileCount} fichiers"></div>
        <div class="cap" style="margin-top:6px">${formatBytes(share.totalSize)} au total</div>
      </div>
    </div>

    <div class="file-list">${filesHtml}</div>

    <div class="share-actions">
      <div class="action-group">
        <button class="btn btn-primary" data-act="copy" data-id="${share.id}" type="button">
          <span class="btn-icon" aria-hidden="true">⧉</span> Copier le lien
        </button>
        ${recovered
          ? `<button class="btn" data-act="restore" data-id="${share.id}" type="button">↩ Restaurer</button>`
          : `<button class="btn" data-act="regenerate" data-id="${share.id}" type="button" ${status.state === "expired" ? "disabled" : ""}>⟳ Régénérer</button>
             <button class="btn btn-danger" data-act="delete" data-id="${share.id}" type="button" ${status.state === "expired" ? "disabled" : ""}>✕ Supprimer</button>`}
      </div>
      <div class="cap">${shareLink(share).replace(location.origin, "")}</div>
    </div>
  </article>`;
}

async function renderShares() {
  const list = $("#shareList");
  try {
    const shares = await fetchShares();
    if (shares.length === 0) {
      list.innerHTML = `
        <div class="empty">
          <div class="empty-tube tube"><span class="tube-window"></span><span class="tube-ghost" aria-hidden="true">0</span><span class="tube-lit"></span></div>
          <h3>Aucun partage</h3>
          <p>Déposez un fichier pour générer votre premier lien court sécurisé.</p>
          <button class="btn btn-primary" data-go-upload type="button">Nouvel envoi</button>
        </div>`;
      return;
    }
    list.innerHTML = shares.map(panelMarkup).join("");
    requestAnimationFrame(() => {
      $$("[data-count='cd']", list).forEach((bankEl, i) => {
        const share = shares[i];
        const cd = formatCountdown(share.status.remaining);
        renderBank(bankEl, { keys: cd.keys, aria: cd.text });
        setBank(bankEl, cd.text);
        setBankState(bankEl, statusForSet(share.status));
      });
      $$("[data-count='files']", list).forEach((bankEl, i) => {
        const share = shares[i];
        renderBank(bankEl, { keys: countKeys(share.fileCount), aria: `${share.fileCount} fichiers` });
        setBank(bankEl, countKeys(share.fileCount).join(""));
      });
    });
    startCountdownTicker(list.querySelectorAll("[data-count='cd']"));
  } catch (err) {
    list.innerHTML = `<div class="empty"><h3>Erreur</h3><p>${err.message}</p><button class="btn" data-reload type="button">Réessayer</button></div>`;
  }
}

function startCountdownTicker(elements) {
  if (state._ticker) return;

  // tick local toutes les secondes, resync complète toutes les 30 s
  let lastSync = 0;
  state._ticker = setInterval(async () => {
    const now = Date.now();
    if (now - lastSync < 30_000) {
      const panels = document.querySelectorAll(".share-panel[data-state]");
      panels.forEach((el) => {
        const id = el.id.slice(6);
        const expiresAt = Number(el.dataset.expires);
        const deletedAt = el.dataset.deleted ? Number(el.dataset.deleted) : null;
        const remaining = deletedAt
          ? deletedAt + 24 * 60 * 60 * 1000 - now
          : expiresAt - now;
        const bank = el.querySelector("[data-count='cd']");
        if (bank) {
          const cd = formatCountdown(Math.max(0, remaining));
          setBank(bank, cd.text);
        }
      });
      return;
    }
    lastSync = now;
    renderShares().catch(() => {});
  }, 1000);
}

/* ------------------------------------------------------------------ */
/* Actions partages                                                    */
/* ------------------------------------------------------------------ */

async function actDelete(id) {
  const panel = $(`#share-${id}`);
  const status = panel?.querySelector(".status-lamp")?.dataset.state;
  if (status === "deleted") return;
  if (!confirm("Supprimer ce partage ? Il restera récupérable pendant 24 heures.")) return;
  try {
    deleteShareEl(id);
    await api(`/api/shares/${id}`, { method: "DELETE" });
    toast("Partage supprimé — récupérable 24 h");
    await renderShares();
  } catch (err) {
    toast("Échec de la suppression");
    await renderShares();
  }
}

async function actRestore(id) {
  try {
    await api(`/api/shares/${id}/restore`, { method: "POST" });
    toast("Partage restauré");
    await renderShares();
  } catch (err) {
    toast("Restauration impossible");
  }
}

async function actRegenerate(id) {
  try {
    const data = await api(`/api/shares/${id}/regenerate`, { method: "POST" });
    toast(`Nouveau lien : ${data.share.slug}`);
    await renderShares();
  } catch (err) {
    toast("Régénération impossible");
  }
}

async function actCopy(id) {
  const shares = await fetchShares().catch(() => []);
  const share = shares.find((s) => s.id === id);
  if (!share) return;
  if (await copyText(shareLink(share))) toast("Lien copié dans le presse-papier");
}

$("#shareList").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const { act, id } = btn.dataset;
  if (act === "copy") actCopy(id);
  if (act === "delete") actDelete(id);
  if (act === "restore") actRestore(id);
  if (act === "regenerate") actRegenerate(id);
});

$("#shareList").addEventListener("click", (e) => {
  if (e.target.closest("[data-go-upload]")) showView("upload");
  if (e.target.closest("[data-reload]")) renderShares();
});

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

async function uploadAll() {
  const input = $("#fileInput");
  const list = [...input.files];
  if (list.length === 0) return;
  state.files = list;
  $("#queueWrap").hidden = false;
  $("#createdCard").hidden = true;
  $("#dropZone").style.display = "none";
  renderQueue();
  await enqueueUploads(list);
}

function renderQueue() {
  const q = $("#queue");
  q.innerHTML = state.files.map((f) => {
    const inmap = [...state.uploaded.values()].find((u) => u.file.name === f.name && u.file.size === f.size);
    const prog = inmap ? inmap.progress : 0;
    return `
      <div class="w-row" data-uid="${f.name}:${f.size}">
        <span class="w-name" title="${f.name.replace(/[<>&"]/g, "")}">${f.name}</span>
        <span class="w-size">${formatBytes(f.size)}</span>
        <div class="w-state"><span class="w-pct">${Math.round(prog)}%</span></div>
        <div class="bar"><span style="width:${prog}%"></span></div>
      </div>`;
  }).join("");
}

function updateRow(uid, prog, done = false, note = "") {
  const row = document.querySelector(`[data-uid="${CSS.escape(uid)}"]`);
  if (!row) return;
  if (done) row.classList.add("done");
  const pct = row.querySelector(".w-pct");
  const bar = row.querySelector(".bar > span");
  if (pct) pct.textContent = note || `${Math.round(prog)}%`;
  if (bar) bar.style.setProperty("--bar-pct", prog / 100);
}

async function enqueueUploads(files) {
  const sendBtn = $("#sendBtn");
  sendBtn.disabled = true;
  const total = files.reduce((a, f) => a + f.size, 0);
  const sizes = files.map((f) => f.size + f.size);
  const progressClosure = { bytes: 0 };
  const results = [];

  // NB: progression globale simple — un seul fichier à la fois, reprise auto via status.
  const onProgress = () => {
    const doneBytes = [...state.uploaded.values()].reduce((a, u) => a + u.progress * u.file.size / 100, 0);
    $("#queueSummary").textContent = `${formatBytes(doneBytes)} / ${formatBytes(total)} — ${Math.round(doneBytes * 100 / total)}%`;
  };

  for (const file of files) {
    const uid = `${file.name}:${file.size}`;
    updateRow(uid, 0, false, "init");
    const result = await uploadFile(file, {
      onProgress: (p) => {
        state.uploaded.set(uid, { file, progress: p });
        updateRow(uid, p);
        onProgress();
      },
    });
    state.uploaded.set(uid, { file, progress: 100 });
    updateRow(uid, 100, true, "ok");
    results.push(result);
    onProgress();
  }

  if (results.length > 0) {
    sendBtn.disabled = false;
    toast("Envoi terminé — déposez le partage");
  } else {
    $("#dropZone").style.display = "";
    renderQueue();
  }
}

async function createShare() {
  const files = [...state.uploaded.values()].filter((u) => u.progress === 100);
  if (files.length === 0) return;
  try {
    const data = await api("/api/shares", {
      method: "POST",
      body: JSON.stringify({
        files: files.map((u) => ({
          id: u.file.id,
          name: u.file.name,
          size: u.file.size,
          mime: u.file.type || "application/octet-stream",
          sha256: u.file.sha256,
          path: u.file.path,
        })),
        duration: state.duration,
      }),
    });
    state.createdUrl = shareLinkFromShare(data.share);
    const urlEl = $("#createdUrl");
    urlEl.textContent = state.createdUrl.replace(location.origin, "");
    $("#createdCard").hidden = false;
    $("#sendBtn").disabled = true;
  } catch (err) {
    toast("Le partage n'a pas pu être créé");
  }
}

function shareLinkFromShare(share) {
  return `${location.origin}/d/${share.slug}`;
}

/* ------------------------------------------------------------------ */
/* Événements                                                          */
/* ------------------------------------------------------------------ */

function init() {
  $$("#nav button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));

  const dropZone = $("#dropZone");
  const input = $("#fileInput");

  dropZone.addEventListener("click", () => input.click());
  input.addEventListener("change", uploadAll);

  ["dragenter", "dragover"].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove("is-over"); }));
  dropZone.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) {
      input.files = e.dataTransfer.files;
      uploadAll();
    }
  });

  $("#durations").addEventListener("click", (e) => {
    const key = e.target.closest(".duration-key");
    if (!key) return;
    state.duration = key.dataset.duration;
    $$("#durations .duration-key").forEach((k) => {
      const on = k === key;
      k.toggleAttribute("aria-pressed", on);
      k.querySelector?.(".duration-dot");
      const dot = document.createElement("span");
      dot.className = "duration-dot";
      dot.setAttribute("aria-hidden", "true");
      if (on) {
        if (!k.querySelector(".duration-dot")) k.appendChild(dot);
      } else {
        k.querySelector(".duration-dot")?.remove();
      }
    });
  });

  $("#sendBtn").addEventListener("click", createShare);
  $("#copyCreated").addEventListener("click", async () => {
    if (state.createdUrl && await copyText(state.createdUrl)) toast("Lien copié");
  });
  $("#resetCreated").addEventListener("click", () => {
    state.files = [];
    state.uploaded.clear();
    state.createdUrl = null;
    $("#createdCard").hidden = true;
    $("#queueWrap").hidden = true;
    $("#dropZone").style.display = "";
    input.value = "";
  });

  renderUser();
  showView("dashboard");
}

async function renderUser() {
  try {
    const res = await fetch("/api/me");
    if (res.status === 401) { window.location.href = "/auth/login"; return; }
    const { user } = await res.json();
    $("#userName").textContent = user.name || user.email || user.sub || "";
    const initial = (user.name || user.email || "?").trim()[0].toUpperCase();
    $("#userAvatar").textContent = initial;
  } catch {
    /* silencieux */
  }
}

init();