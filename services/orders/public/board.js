// Plain JS, no build step.
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const aud = (c) => (c == null ? "-" : `AUD ${(c / 100).toFixed(2)}`);
const time = (t) => new Date(t).toLocaleTimeString();
let selected = null;

async function tick(minutes) {
  const res = await fetch("/timer/tick", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ advance_minutes: minutes }),
  });
  const data = await res.json();
  document.getElementById("status").textContent =
    `tick at ${data.now}: expired ${JSON.stringify(data.expired)}`;
  load();
}

async function load() {
  const drafts = await (await fetch("/drafts")).json();
  document.getElementById("drafts").innerHTML = drafts
    .map(
      (d) => `<tr class="${d.draft_id === selected ? "sel" : ""}" onclick="select('${d.draft_id}')">
    <td>${esc(d.customer_id)}<div class="muted">${esc(d.quantity)} x ${esc(d.sku)} · ${esc(d.draft_id.slice(0, 8))}</div></td>
    <td><span class="tag">${esc(d.state)}</span></td><td>${esc(d.delivery_status ?? "")}</td><td>${esc(d.payment_status ?? "")}</td><td>${aud(d.total)}</td></tr>`,
    )
    .join("");
  if (selected) detail(selected);
}

function select(id) {
  selected = id;
  load();
}

async function detail(id) {
  const d = await (await fetch(`/drafts/${id}`)).json();
  const offers = d.offers
    .map(
      (o) =>
        `<li>v${o.version} <span class="tag">${esc(o.status)}</span> ${o.items.map((i) => `${i.quantity} x ${esc(i.sku)}`).join(", ")} + fee ${aud(o.shipping_fee)} = <b>${aud(o.total)}</b></li>`,
    )
    .join("");
  const hist = d.history
    .map(
      (h) =>
        `<li>${time(h.at)} ${esc(h.what)}${h.decision_id ? ` <span class="muted">decision ${esc(h.decision_id.slice(0, 8))}</span>` : ""}</li>`,
    )
    .join("");
  const decisions = d.decisions
    .map(
      (
        r,
      ) => `<div class="card"><div class="row"><b>${esc(r.agent)}</b><span class="tag">${esc(r.event_type)}</span><span class="tag">${esc(r.status)}</span><span class="muted">${esc(r.decision_id.slice(0, 8))} · ${esc(r.model)} · ${r.duration_ms} ms · ${r.tokens_in}/${r.tokens_out} tokens</span></div>
      <div class="muted">tools: ${r.tool_calls.map((t) => `${esc(t.name)}${t.ok ? "" : " (refused)"}`).join(", ") || "none"} · emitted: ${r.emitted_events.map((e) => esc(e.type)).join(", ") || "none"}</div>
      <pre>${esc(r.output_text)}</pre></div>`,
    )
    .join("");
  document.getElementById("detail").classList.remove("muted");
  document.getElementById("detail").innerHTML =
    `<h2>Draft ${esc(d.draft_id.slice(0, 8))} <span class="tag">${esc(d.state)}</span></h2>
    <div class="muted">${esc(d.customer_id)} · wants ${esc(d.quantity)} x ${esc(d.sku)}${d.max_price != null ? ` at max ${aud(d.max_price)}` : ""} · ship to ${esc(d.address.line1)}, ${esc(d.address.city)} ${esc(d.address.postcode)}</div>
    <h2 style="margin-top:10px">Offers</h2><ul>${offers || "<li class='muted'>none</li>"}</ul>
    <h2>History</h2><ul>${hist}</ul>
    <h2>Decision records</h2>${decisions || "<p class='muted'>none</p>"}`;
}

load();
setInterval(load, 3000);
