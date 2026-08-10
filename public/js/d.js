import { renderBank, setBank, setBankState, formatBytes, plural, formatCountdown } from "./nixie.js";

const $ = (sel) => document.querySelector(sel);

const slug = location.pathname.split("/").filter(Boolean)[1] || "";

async function load() {
  $("#slug").textContent = slug ? "/" + slug : "";
  if (!slug) return renderState("introuvable", "Lien incomplet", "Ce lien de partage n'est pas valide.");

  try {
    const res = await fetch(`/api/d/${slug}`);
    const data = await res.json().catch(() => null);

    if (res.status === 404) {
      return renderState("introuvable", "Partage introuvable", "Ce lien n'existe pas ou a été régénéré.");
    }
    if (!data) return renderState("erreur", "Erreur serveur", "Impossible de lire ce partage.");

    const { share, status } = data;

    if (status.state === "expired") {
      return renderState("expiré", "Ce partage a expiré", "La durée de vie du dépôt est écoulée, les fichiers ne sont plus accessibles.");
    }
    if (share.deletedAt) {
      return renderState("supprimé", "Ce partage a été supprimé", "L'expéditeur l'a retiré. Demandez-lui d'en créer un nouveau.");
    }

    renderShare(share, status);
  } catch {
    renderState("erreur", "Réessayez", "La connexion a échoué. Vérifiez votre réseau.");
  }
}

function renderState(tag, title, sub, cta) {
  $("#pageTitle").textContent = `DropIt — ${title}`;
  $("#content").innerHTML = `
    <div class="state-plate">
      <div class="state-badge">${tag}</div>
      <h1>${title}</h1>
      <p>${sub}</p>
      ${cta || ""}
    </div>`;
}

let ticker;

function renderShare(share, status) {
  document.title = `${share.fileCount} ${plural(share.fileCount, "fichier", "fichiers")} — DropIt`;
  const cd = formatCountdown(status.remaining);
  const rows = share.files.map((f) => `
    <div class="public-file">
      <div class="pf-info">
        <div class="pf-name" title="${f.name.replace(/[<>&"]/g, "")}">${f.name}</div>
        <div class="pf-meta">${formatBytes(f.size)} · <span data-hash="${f.sha256 ? "1" : "0"}">${f.sha256 ? f.sha256.slice(0, 10) + "…" : ""}</span></div>
      </div>
      <button class="btn btn-primary" data-dl="${f.id}" type="button" ${status.state === "expired" ? "disabled" : ""}>
        <span class="btn-icon" aria-hidden="true">▼</span> Télécharger
      </button>
    </div>`).join("");

  $("#content").innerHTML = `
    <div class="public-hero">
      <div class="hero-count">${share.fileCount} ${plural(share.fileCount, "fichier", "fichiers")} · ${formatBytes(share.totalSize)}</div>
      <div class="hero-sub">${status.label}${status.state === "active" ? " — lien actif" : ""}</div>
      <div class="bank-row hero-bank" data-count="cd" role="img" aria-label="${formatCountdown(status.remaining).text}"></div>
      <div class="cap" style="margin-top:10px">temps restant avant expiration</div>
    </div>
    <div class="file-list">${rows}</div>
    <div class="cap" style="margin-top:18px">télécharger = lien envoyé par ${share.owner.name || "un collègue"}</div>
  `;

  const bank = $("[data-count='cd']");
  renderBank(bank, { keys: cd.keys, aria: cd.text });
  setBank(bank, cd.text);
  setBankState(bank, status.state === "expiring" ? "flicker" : status.state === "expired" ? "off" : "on");

  // countdown en direct
  clearInterval(ticker);
  let currentKeyCount = cd.keys.length;
  ticker = setInterval(() => {
    const remaining = share.expiresAt - Date.now();
    if (remaining <= 0) return renderState("expiré", "Ce partage a expiré", "La durée de vie du dépôt est écoulée.");
    const c = formatCountdown(remaining);
    if (c.keys.length !== currentKeyCount) {
      currentKeyCount = c.keys.length;
      renderShare(share, { ...status, remaining });
      return;
    }
    setBank($("[data-count='cd']"), c.text);
  }, 1000);

  // téléchargement
  $("#content").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-dl]");
    if (!btn) return;
    window.location.href = `/dl/${slug}/${btn.dataset.dl}`;
  });
}

load();