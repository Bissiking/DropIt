// public/js/integrations.js
const status = document.querySelector("#status");
async function api(url, method = "GET", body) {
  const r = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Action refusée");
  return data;
}
function error(e) {
  status.textContent = e.message;
}
async function load() {
  for (const kind of ["clients", "grants"]) {
    const { data } = await api("/api/integrations/" + kind);
    const box = document.querySelector("#" + kind);
    box.replaceChildren();
    if (!data.length) box.textContent = "Aucun accès pour le moment.";
    for (const item of data) {
      const row = document.createElement("article"),
        text = document.createElement("p"),
        button = document.createElement("button");
      text.textContent = item.name + (item.revoked ? " · Révoquée" : "");
      button.textContent = "Révoquer";
      button.disabled = Boolean(item.revoked);
      button.onclick = async () => {
        if (!confirm("Révoquer cet accès ?")) return;
        try {
          await api("/api/integrations/" + kind + "/" + item.id, "DELETE");
          await load();
          status.textContent = "Accès révoqué.";
        } catch (e) {
          error(e);
        }
      };
      row.append(text, button);
      box.append(row);
    }
  }
}
document.querySelector("#create").onsubmit = async (e) => {
  e.preventDefault();
  const button = e.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    const data = await api(
      "/api/integrations/clients",
      "POST",
      Object.fromEntries(new FormData(e.currentTarget)),
    );
    document.querySelector("#secret").hidden = false;
    document.querySelector("#client-id").value = data.id;
    document.querySelector("#api-key").value = data.api_key;
    await load();
    status.textContent = "Application créée.";
  } catch (e) {
    error(e);
  } finally {
    button.disabled = false;
  }
};
load().catch(error);
