// Plain JS, no build step. One SSE stream per selected customer.
const $ = (id) => document.getElementById(id);
const logEl = $("log");
const status = $("status");
let stream = null;

function add(kind, text, meta) {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  div.textContent = text;
  if (meta) {
    const m = document.createElement("div");
    m.className = "meta";
    m.textContent = meta;
    div.appendChild(m);
  }
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function connect(customerId) {
  if (stream) stream.close();
  logEl.replaceChildren();
  stream = new EventSource(`/chat/stream?customer_id=${encodeURIComponent(customerId)}`);
  stream.onopen = () => {
    status.textContent = `listening as ${customerId}`;
  };
  stream.onerror = () => {
    status.textContent = "stream lost; reconnecting…";
  };
  stream.onmessage = (e) => {
    const reply = JSON.parse(e.data);
    add("bot", reply.text, `decision ${reply.decision_id ?? "-"}`);
  };
}

async function init() {
  const customers = await (await fetch("/customers")).json();
  const select = $("customer");
  for (const c of customers) {
    const o = document.createElement("option");
    o.value = c.customer_id;
    o.textContent = `${c.name} (${c.customer_id})`;
    select.appendChild(o);
  }
  select.onchange = () => connect(select.value);
  connect(select.value);

  $("form").onsubmit = async (e) => {
    e.preventDefault();
    const text = $("text").value.trim();
    if (!text) return;
    $("text").value = "";
    add("me", text);
    const res = await fetch("/chat/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customer_id: select.value, text }),
    });
    if (!res.ok) add("bot", `error: ${await res.text()}`);
  };
}

init();
