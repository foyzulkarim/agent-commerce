// Plain JS, no build step. Reads /emails; each action is a plain HTML form that posts to the orders service.
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
let lastJson = "";

function action(a) {
  if (a.kind === "address_form") {
    return `<form method="post" action="${esc(a.url)}" class="row">
      <input name="line1" placeholder="Street and number" required>
      <input name="city" placeholder="City" required>
      <input name="postcode" placeholder="Postcode" pattern="\\d{4}" required size="6">
      <button type="submit">${esc(a.label)}</button></form>`;
  }
  const secondary = /reject/i.test(a.label) ? " secondary" : "";
  return `<form method="post" action="${esc(a.url)}" style="display:inline"><button class="${secondary.trim()}" type="submit">${esc(a.label)}</button></form>`;
}

async function load() {
  const id = $("customer").value;
  if (!id) return;
  const emails = await (await fetch(`/emails?customer_id=${encodeURIComponent(id)}`)).json();
  const json = JSON.stringify(emails);
  if (json === lastJson) return;
  lastJson = json;
  $("list").innerHTML =
    emails.length === 0
      ? `<p class="muted">No email yet for ${esc(id)}.</p>`
      : emails
          .map(
            (e) => `<div class="card">
        <div class="row"><h2>${esc(e.subject)}</h2><span class="tag">${esc(e.reason)}</span></div>
        <div class="muted">to ${esc(e.to_address)} · ${new Date(e.created_at).toLocaleString()} · draft ${esc(e.draft_id.slice(0, 8))}</div>
        <pre>${esc(e.body)}</pre>
        <div class="row">${e.actions.map(action).join(" ")}</div>
        <div class="muted">decision records: ${e.decision_ids.length ? e.decision_ids.map((d) => esc(d.slice(0, 8))).join(", ") : "none"}</div>
      </div>`,
          )
          .join("");
}

async function init() {
  const customers = await (await fetch("/customers")).json();
  const select = $("customer");
  const saved = localStorage.getItem("ac-customer");
  for (const c of customers) {
    const o = document.createElement("option");
    o.value = c.customer_id;
    o.textContent = `${c.name} (${c.customer_id})`;
    if (c.customer_id === saved) o.selected = true;
    select.appendChild(o);
  }
  select.onchange = () => {
    localStorage.setItem("ac-customer", select.value);
    lastJson = "";
    load();
  };
  load();
  setInterval(load, 3000);
}
init();
