"""Layer view v7. Only short arrows between adjacent bands."""
import sys, html

W, H = 1390, 960
X0 = 210  # content start; band titles at the left
STYLE = {
    "agent": ('#dbeafe', '#1d4ed8', None),
    "code": ('#f3f4f6', '#374151', None),
    "mock": ('#fef3c7', '#b45309', '5 3'),
    "cust": ('#dcfce7', '#15803d', None),
    "bus": ('#ede9fe', '#6d28d9', None),
}
BANDS = [  # (title, subtitle, y, h)
    ("1. Actors", "start every chain", 70, 100),
    ("2. Entry points", "plain code, HTTP", 190, 100),
    ("3. Event bus", "RabbitMQ", 310, 80),
    ("4. Reactors", "one turn per event", 410, 150),
    ("5. MCP servers", "guard code", 580, 120),
    ("6. Services and data", "Postgres, mocks", 720, 120),
]
out, boxes = [], []

def box(x, y, w, h, st, lines, fs=12):
    fill, stroke, dash = STYLE[st]
    da = f' stroke-dasharray="{dash}"' if dash else ""
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{fill}" stroke="{stroke}" stroke-width="1.5"{da}/>')
    n = len(lines); top = y + h / 2 - (n - 1) * 7.5 + 4
    for i, (t, small) in enumerate(lines):
        size = 10 if small else fs
        col = "#4b5563" if small else "#111827"
        out.append(f'<text x="{x+w/2}" y="{top+i*15}" font-size="{size}" fill="{col}" text-anchor="middle">{html.escape(t)}</text>')
    boxes.append((x, y, x + w, y + h))
    return (x, y, x + w, y + h)

def arrow(d, both=False, dash=False):
    ms = ' marker-start="url(#a)"' if both else ""
    da = ' stroke-dasharray="5 4"' if dash else ""
    out.append(f'<path d="{d}" fill="none" stroke="#374151" stroke-width="1.4"{da}{ms} marker-end="url(#a)"/>')

def label(x, y, t, anchor="start"):
    out.append(f'<text x="{x}" y="{y}" font-size="10.5" fill="#1f2937" text-anchor="{anchor}">{html.escape(t)}</text>')

# band backgrounds and titles
for t, sub, y, h in BANDS:
    out.append(f'<rect x="15" y="{y}" width="{W-30}" height="{h}" rx="10" fill="#fafafa" stroke="#e5e7eb"/>')
    out.append(f'<text x="30" y="{y+h/2-2}" font-size="13" font-weight="bold" fill="#111827">{t}</text>')
    out.append(f'<text x="30" y="{y+h/2+14}" font-size="10.5" fill="#6b7280">{sub}</text>')

# band 2: entry points (5)
EW, EG = 200, 30
ex = [X0 + i * (EW + EG) for i in range(5)]
ey = 212
entries = [
    [("Chat page", False), ("chat-ui", True)],
    [("Response endpoints", False), ("inbox links, in orders", True)],
    [("Manager page", False), ("in catalogue-mock", True)],
    [("Courier page", False), ("in shipping-mock", True)],
    [("Timer", False), ("in orders, writes drafts", True)],
]
E = [box(ex[i], ey, EW, 56, "code", entries[i]) for i in range(5)]

# band 1: actors
ay = 92
mia_cx = (ex[0] + ex[1] + EW) / 2
A_mia = box(mia_cx - 100, ay, 200, 56, "cust", [("Mia", False), ("customer", True)])
A_mgr = box(ex[2], ay, EW, 56, "cust", [("Shop manager", False), ("page or curl", True)])
A_cou = box(ex[3], ay, EW, 56, "cust", [("Courier", False), ("page or curl", True)])
A_clk = box(ex[4], ay, EW, 56, "cust", [("Clock", False), ("schedule or curl", True)])
# actor -> entry arrows
cx0, cx1 = ex[0] + EW / 2, ex[1] + EW / 2
arrow(f"M{mia_cx-40} 148 V170 H{cx0} V{ey-2}")
arrow(f"M{mia_cx+40} 148 V170 H{cx1} V{ey-2}")
for i in (2, 3, 4):
    arrow(f"M{ex[i]+EW/2} 148 V{ey-2}")
label(cx0 + 8, 184, "chat")
label(cx1 + 8, 184, "approve, reject, address")
label(ex[2] + EW / 2 + 8, 184, "restock, set price")
label(ex[3] + EW / 2 + 8, 184, "dispatch, deliver")
label(ex[4] + EW / 2 + 8, 184, "tick")

# band 3: bus
by0, by1 = 330, 370
out.append(f'<rect x="{X0}" y="{by0}" width="{ex[4]+EW-X0}" height="{by1-by0}" rx="8" fill="#ede9fe" stroke="#6d28d9" stroke-width="1.5"/>')
out.append(f'<text x="{(X0+ex[4]+EW)/2}" y="{by0+17}" font-size="13" fill="#111827" text-anchor="middle">Topic exchange "events"</text>')
out.append(f'<text x="{(X0+ex[4]+EW)/2}" y="{by0+32}" font-size="10" fill="#4b5563" text-anchor="middle">routing key = event type. One durable queue per consumer. Manual ack, prefetch 1</text>')
# entry -> bus (all except timer: it writes drafts, the outbox publishes)
for i in range(4):
    arrow(f"M{ex[i]+EW/2} {ey+56} V{by0-2}")
label(ex[0] + EW / 2 + 8, 304, "publish")
label(ex[4] + EW / 2, 304, "no publish: the outbox does it", "middle")

# band 4: reactors
RW, RG = 118, 8
ry = 470
out.append(f'<text x="{X0+2*(RW+RG)+59}" y="{ry+76}" font-size="11" font-weight="bold" fill="#1d4ed8" text-anchor="middle">Agents (LLM)</text>')
agents = [("Shopping", "agent"), ("Offer", "agent"), ("Inventory", "agent"),
          ("Notification", "agent"), ("Shipping", "agent"), ("Payment", "agent")]
rx = []
for i, (a, b) in enumerate(agents):
    x = X0 + i * (RW + RG); rx.append(x)
    box(x, ry, RW, 56, "agent", [(a, False), (b, False)], fs=12)
gx = X0 + 6 * (RW + RG) - RG + 24

plain = [("Gate", "matches watches"), ("Status updater", "draft + outbox"), ("Outbox relay", "outbox to bus")]
for i, (a, b) in enumerate(plain):
    x = gx + i * (RW + RG); rx.append(x)
    box(x, ry, RW, 56, "code", [(a, False), (b, True)], fs=12)
for i, x in enumerate(rx):
    if i == 8:   # outbox relay only publishes
        arrow(f"M{x+RW/2} {ry-2} V{by1+2}".replace(f"M{x+RW/2} {ry-2} V{by1+2}", f"M{x+RW/2} {ry} V{by1+2}"))
    elif i == 6:  # gate consumes and publishes
        arrow(f"M{x+RW/2} {by1} V{ry-2}", both=True)
    else:
        arrow(f"M{x+RW/2} {by1} V{ry-2}", both=True)
label(rx[0] + RW / 2 + 6, 418, "consume, publish")
label(rx[8] + RW / 2 + 6, 418, "publish")

# band 5: MCP servers (6 columns) ; band 6 services and data
MW, MG = 150, 15
mx = [X0 + i * (MW + MG) for i in range(6)]
my, dy = 610, 742
mcp = [  # tools per server (design §6 and §14). (code) = called only by other servers or endpoints
    ("orders", "create_draft_order,", "register_watch,", "propose_offer, get_draft"),
    ("customers", "get_customer,", "get_customer_email", ""),
    ("catalogue", "search_products,", "reserve_stock (code),", "get_products (code)"),
    ("email", "send_email", "", ""),
    ("shipping", "geocode, quote, book,", "get_quote, get_booking", "(code)"),
    ("payment", "authorize, capture,", "void, get_authorization", "(code)"),
]
data = [
    ("orders DB", "drafts, offers, watches,", "outbox"),
    ("customers DB", "customers, addresses", ""),
    ("Catalogue mock", "catalogue DB: products,", "stock, reservations"),
    ("Email store", "email DB: emails", "inbox page reads it"),
    ("Shipping mock", "shipping DB:", "quotes, bookings"),
    ("Payment mock", "payment DB:", "authorizations"),
]
for i in range(6):
    n, *tools = mcp[i]
    ls = [(n + " MCP", False)] + [(t, True) for t in tools if t]
    box(mx[i], my, MW, 70, "code", ls)
    n, a, b = data[i]
    st = "mock" if "mock" in n else "code"
    ls = [(n, False), (a, True)] + ([(b, True)] if b else [])
    box(mx[i], dy, MW, 76, st, ls)
    arrow(f"M{mx[i]+MW/2} {my+70} V{dy-2}")
label(mx[0] + MW / 2 + 6, 732, "read, write")
dx = mx[5] + MW + 30
box(dx, dy, ex[4] + EW - dx, 76, "code", [("decisions DB", False), ("decision_records", True), ("one per agent turn", True)])
# agents -> MCP band (band-level arrow)
c = lambda i: mx[i] + MW / 2
B = ry + 56
arrow(f"M{rx[0]+59} {B} V{my-2}")                                  # Shopping -> orders
arrow(f"M{rx[1]+59} {B} V560 H{mx[0]+110} V{my-2}")                # Offer -> orders
arrow(f"M{rx[2]+98} {B} V{my-2}")                                  # Inventory -> catalogue
arrow(f"M{rx[3]+72} {B} V590 H{c(3)-20} V{my-2}")                  # Notification -> email
arrow(f"M{rx[4]+86} {B} V575 H{c(4)} V{my-2}")                     # Shipping -> shipping
arrow(f"M{rx[5]+80} {B} V560 H{c(5)} V{my-2}")                     # Payment -> payment
label(405, 575, "tool calls (main server)")
# plain code -> orders DB: note, no arrow (long path)
out.append(f'<text x="{gx}" y="{ry+76}" font-size="10" fill="#4b5563">Plain code, in orders. Gate and Status updater write the orders DB.</text>')

# footer
fy = 880
out.append(f'<text x="30" y="{fy}" font-size="11.5" fill="#111827">Read from top to bottom: an actor uses an entry point. The entry point publishes an event. Reactors consume it, call guarded tools, and publish new events.</text>')
out.append(f'<text x="30" y="{fy+18}" font-size="11.5" fill="#111827">Nothing below band 2 starts by itself. The event names and the order of steps are in the flow view. Full tool list of each agent: agents/*/agent.json.</text>')
legend = [("agent", "agent (LLM)"), ("code", "plain code / record"), ("mock", "mock service"), ("cust", "actor"), ("bus", "event bus")]
lx = 30
for st, t in legend:
    fill, stroke, dash = STYLE[st]
    da = ' stroke-dasharray="4 2"' if dash else ""
    out.append(f'<rect x="{lx}" y="{fy+32}" width="18" height="12" fill="{fill}" stroke="{stroke}"{da}/><text x="{lx+25}" y="{fy+42}" font-size="11">{t}</text>')
    lx += 160

svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="Helvetica, Arial, sans-serif">',
       '<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#374151"/></marker></defs>',
       f'<rect width="{W}" height="{H}" fill="#ffffff"/>',
       '<text x="30" y="44" font-size="15" font-weight="bold" fill="#111827">agent-commerce: v7, layer view</text>'] + out + ['</svg>']
open(sys.argv[1], "w").write("\n".join(svg))
# box overlap check
bad = [(a, b) for i, a in enumerate(boxes) for b in boxes[i+1:] if not (a[2] <= b[0] or a[0] >= b[2] or a[3] <= b[1] or a[1] >= b[3])]
print("box overlaps:", bad)
print("right edge:", max(b[2] for b in boxes))
