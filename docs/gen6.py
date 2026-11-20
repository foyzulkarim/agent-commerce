"""Generate and validate the v2 diagram. Edge list is the source of truth."""
import re, sys, html

COLS = {0: 130, 1: 400, 2: 670, 3: 990, 4: 1260}
ROWS = {i: 100 + 130 * i for i in range(9)}
NW, NH = 180, 56

STYLE = {
    "agent": ('#dbeafe', '#1d4ed8', None),
    "code": ('#f3f4f6', '#374151', None),
    "mock": ('#fef3c7', '#b45309', '5 3'),
    "real": ('#fce7f3', '#be185d', None),
    "cust": ('#dcfce7', '#15803d', None),
}

NODES = {
    "chat":     (0, 0, "cust",  "Mia (customer)", "chat page, demo login"),
    "shop":     (0, 1, "agent", "Shopping agent", "LLM"),
    "watch":    (1, 1, "code",  "Stock watch", "durable record"),
    "cat":      (2, 0, "mock",  "Catalogue + inventory", "mock + manager page"),
    "gate":     (2, 1, "code",  "Gate", "plain code"),
    "drop":     (3, 1, "code",  "Dropped", "and logged"),
    "mgr":      (3, 0, "cust",  "Shop manager", "manager page or curl"),
    "courier":  (3, 8, "cust",  "Courier", "courier page or curl"),
    "timer":    (1, 2, "cust",  "Clock", "Timer, on a schedule"),
    "offer":    (2, 2, "agent", "Offer agent", "LLM"),
    "inv":      (3, 2, "agent", "Inventory agent", "LLM"),
    "draft":    (1, 3, "code",  "Draft order / offer", "record + outbox"),
    "declog":   (0, 4, "code",  "Decision log", "record"),
    "notif":    (1, 4, "agent", "Notification agent", "LLM"),
    "email":    (1, 5, "code",  "Email service", "console log + DB"),
    "cust":     (3, 3, "code",  "Customers", "plain code"),
    "status":   (3, 4, "code",  "Status updater", "plain code"),
    "inbox":    (0, 5, "cust",  "Mia (customer)", "inbox page"),
    "resp":     (0, 6, "code",  "Response endpoints", "plain code"),
    "ship":     (2, 6, "agent", "Shipping agent", "LLM"),
    "pay":      (1, 7, "agent", "Payment agent", "LLM"),
    "paymock":  (1, 8, "mock",  "Payment", "mock"),
    "shipmock": (3, 7, "mock",  "Shipping mocks", "+ courier page"),
}
MCP = ["watch", "draft", "cat", "email", "paymock", "shipmock", "cust"]

def box(n):
    c, r = NODES[n][0], NODES[n][1]
    cx, cy = COLS[c], ROWS[r]
    return (cx - NW / 2, cy - NH / 2, cx + NW / 2, cy + NH / 2)

L = lambda n: box(n)[0]
T = lambda n: box(n)[1]
R = lambda n: box(n)[2]
B = lambda n: box(n)[3]
CX = lambda n: (box(n)[0] + box(n)[2]) / 2
CY = lambda n: (box(n)[1] + box(n)[3]) / 2

# kind: "event" (solid), "tool" (solid, snake_case), "rec" (dashed, record access by code)
# labels: list of (x, y, text, anchor[, rotate])
E = []
def edge(eid, src, dst, kind, d, labels, both=False, note=""):
    E.append(dict(id=eid, src=src, dst=dst, kind=kind, d=d, labels=labels, both=both, note=note))

edge("e1", "chat", "shop", "event", f"M110 {B('chat')} V{T('shop')-2}",
     [(104, 168, "chat.message", "end")])
edge("e2", "shop", "chat", "event", f"M150 {T('shop')} V{B('chat')+2}",
     [(158, 168, "chat.reply", "start")])
edge("e3", "shop", "watch", "tool", f"M{R('shop')} 230 H{L('watch')-2}",
     [(265, 222, "register_watch", "middle")])
edge("e4", "watch", "gate", "rec", f"M{R('watch')+2} 230 H{L('gate')-2}",
     [(535, 222, "read, close", "middle")], both=True)
edge("e5", "cat", "gate", "event", f"M670 {B('cat')} V{T('gate')-2}",
     [(678, 160, "stock.restocked", "start"), (678, 174, "price.changed", "start")])
edge("e6", "gate", "drop", "rec", f"M{R('gate')} 230 H{L('drop')-2}",
     [(830, 222, "no match (log)", "middle")])
edge("e7", "gate", "offer", "event", f"M670 {B('gate')} V{T('offer')-2}",
     [(662, 300, "watch.matched", "end")])
edge("e8", "offer", "inv", "event", f"M{R('offer')} 350 H{L('inv')-2}",
     [(830, 343, "composition.requested", "middle")])
edge("e9", "inv", "offer", "event", f"M{L('inv')} 372 H{R('offer')+2}",
     [(830, 387, "composition.proposed", "middle")])
edge("e10", "offer", "draft", "tool", f"M{L('offer')} 375 H535 V{CY('draft')} H{R('draft')+2}",
     [(543, 440, "propose_offer", "start"), (543, 454, "(max 3 versions)", "start")])
edge("e11", "shop", "draft", "tool", f"M130 {B('shop')} V478 H{L('draft')-2}",
     [(138, 360, "create_draft_order", "start")])
edge("e12", "timer", "draft", "rec", f"M400 {B('timer')+2} V{T('draft')-2}",
     [(408, 422, "expire overdue", "start"), (408, 436, "offers and waits", "start")], both=True)
edge("e13", "draft", "notif", "event", f"M400 {B('draft')} V{T('notif')-2}",
     [(392, 558, "notification.requested (outbox)", "end")])
edge("e14", "declog", "notif", "rec", f"M{R('declog')} 620 H{L('notif')-2}",
     [(265, 612, "read", "middle")])
edge("e15", "notif", "email", "tool", f"M400 {B('notif')} V{T('email')-2}",
     [(392, 690, "send_email", "end")])
edge("e16", "email", "inbox", "event", f"M{L('email')} 750 H{R('inbox')+2}",
     [(243, 765, "email", "middle")])
edge("e17", "inbox", "resp", "event", f"M130 {B('inbox')} V{T('resp')-2}",
     [(138, 808, "approve, reject", "start"), (138, 822, "or address form", "start")])
edge("e18", "resp", "cat", "tool", f"M{L('resp')} 890 H14 V40 H670 V{T('cat')-2}",
     [(345, 33, "reserve_stock (on approve)", "middle")])
edge("e19", "resp", "draft", "rec", f"M{L('resp')} 870 H27 V505 H{L('draft')-2}",
     [(90, 499, "status, address", "middle")])
edge("e20", "resp", "ship", "event", f"M{R('resp')} 890 H{L('ship')-2}",
     [(400, 868, "order.confirmed", "middle"), (400, 882, "address.provided", "middle")])
edge("e21", "ship", "status", "event", f"M740 {T('ship')} V680 H950 V{B('status')+2}",
     [(748, 780, "shipment.booked", "start"), (748, 794, "shipment.failed", "start")])
edge("e22", "ship", "offer", "event", f"M710 {T('ship')} V{B('offer')+2}",
     [(702, 700, "shipment.failed", "end"), (702, 714, "(courier or quote)", "end")])
edge("e23", "ship", "pay", "event", f"M620 {B('ship')} V1000 H{R('pay')+2}",
     [(628, 965, "shipment.quoted", "start"), (628, 979, "shipment.failed", "start")])
edge("e24", "pay", "ship", "event", f"M450 {T('pay')} V932 H590 V{B('ship')+2}",
     [(442, 958, "payment.authorized", "end")])
edge("e25", "pay", "status", "event", f"M470 {B('pay')} V1065 H1120 V634 H{R('status')+2}",
     [(740, 1058, "payment.captured, payment.failed", "start")])
edge("e26", "ship", "shipmock", "tool", f"M{R('ship')} 880 H990 V{T('shipmock')-2}",
     [(982, 930, "geocode, quote, book", "end"),
      (982, 944, "returns: ok, address.unresolved,", "end"),
      (982, 958, "courier.unavailable", "end")])
edge("e27", "pay", "paymock", "tool", f"M400 {B('pay')} V{T('paymock')-2}",
     [(392, 1090, "authorize, capture, void", "end"),
      (392, 1104, "returns: approved, declined, unknown", "end")])
edge("e28", "draft", "cust", "tool", f"M{R('draft')} 505 H{L('cust')-2}",
     [(830, 499, "get_customer", "middle")])
edge("e30", "status", "draft", "rec", f"M920 {T('status')} V575 H470 V{B('draft')+2}",
     [(595, 570, "draft status + notification.requested", "middle")])
edge("e31", "mgr", "cat", "tool", f"M{L('mgr')} 100 H{R('cat')+2}",
     [(831, 124, "restock, set price", "middle")])
edge("e32", "courier", "shipmock", "tool", f"M990 {T('courier')} V{B('shipmock')+2}",
     [(982, 1085, "dispatch, deliver", "end")])
edge("e33", "shipmock", "pay", "event", f"M{L('shipmock')} 1020 H{R('pay')+2}",
     [(780, 1014, "shipment.dispatched", "middle")])
edge("e34", "shipmock", "status", "event", f"M{R('shipmock')} 1000 H1095 V665 H1060 V{B('status')+2}",
     [(1088, 690, "shipment.dispatched", "end"), (1088, 704, "shipment.delivered", "end")])
edge("e29", "email", "cust", "tool", f"M{R('email')} 760 H1145 V490 H{R('cust')+2}",
     [(850, 754, "get_customer_email", "middle")])
# Added in the build (design §14, G1): the catalogue read tool.
edge("e35", "shop", "cat", "tool", f"M{R('shop')} 210 H290 V100 H{L('cat')-2}",
     [(435, 94, "search_products", "middle")])
edge("e36", "inv", "cat", "tool", f"M{R('inv')} 345 H1110 V145 H700 V{B('cat')+2}",
     [(905, 140, "search_products", "middle")])

W, H = 1390, 1200
NOTE = (1155, 72, 1375, 358)
NOTE_LINES = [
    ("Rules for this drawing", True),
    ("Green box: actor. Every chain of events", False),
    ("starts with an actor (page, curl or clock).", False),
    ("Numbers 1-9: steps of the success path.", False),
    ("Solid arrow: event on RabbitMQ (topic", False),
    ("exchange), a tool call or an HTTP call.", False),
    ("Dashed arrow: plain code reads or writes", False),
    ("a record. No event.", False),
    ("MCP tag: tools reached through an MCP", False),
    ("server. The guard runs in the server.", False),
    ("Every agent turn writes a decision record.", False),
    ("Only the draft outbox emits", False),
    ("notification.requested.", False),
    ("Email is not sent. It is logged and saved.", False),
]
BADGES = [(1, 110, 145), (2, 852, 100), (3, 285, 750), (4, 130, 838), (5, 250, 890),
          ("6,8", 990, 1100), (7, 560, 1020), (9, 1095, 900)]
LEGEND_Y = 400

def text_w(s, size=10.5):
    return len(s) * size * 0.56

def label_bbox(lb, size=10.5):
    x, y, s, anchor = lb[:4]
    rot = lb[4] if len(lb) > 4 else 0
    w = text_w(s, size)
    if rot:
        # rotated -90 around (x,y), anchor middle: vertical extent
        return (x - size, y - w / 2, x + 2, y + w / 2)
    x0 = x if anchor == "start" else (x - w if anchor == "end" else x - w / 2)
    return (x0, y - size * 0.8, x0 + w, y + size * 0.25)

def parse(d):
    toks = re.findall(r"[MHV]|-?\d+(?:\.\d+)?", d)
    pts, i, cur = [], 0, None
    while i < len(toks):
        t = toks[i]
        if t == "M":
            cur = (float(toks[i + 1]), float(toks[i + 2])); pts.append(cur); i += 3
        elif t == "H":
            cur = (float(toks[i + 1]), cur[1]); pts.append(cur); i += 2
        elif t == "V":
            cur = (cur[0], float(toks[i + 1])); pts.append(cur); i += 2
    return pts

def on_boundary(p, b, tol):
    x, y = p
    x0, y0, x1, y1 = b
    inside_x = x0 - tol <= x <= x1 + tol
    inside_y = y0 - tol <= y <= y1 + tol
    near = min(abs(x - x0), abs(x - x1)) <= tol and inside_y or min(abs(y - y0), abs(y - y1)) <= tol and inside_x
    return near

def seg_hits_rect(a, b, r, shrink=1):
    x0, y0, x1, y1 = r[0] + shrink, r[1] + shrink, r[2] - shrink, r[3] - shrink
    sx0, sx1 = sorted((a[0], b[0])); sy0, sy1 = sorted((a[1], b[1]))
    return not (sx1 < x0 or sx0 > x1 or sy1 < y0 or sy0 > y1)

def overlap(a, b):
    return not (a[2] <= b[0] or a[0] >= b[2] or a[3] <= b[1] or a[1] >= b[3])

def badge(n):
    x0, y0, x1, y1 = box(n)
    return (x1 - 40, y0 - 7, x1 - 6, y0 + 7)

def validate():
    errs = []
    boxes = {n: box(n) for n in NODES}
    labels = [("badge", n, badge(n)) for n in MCP] + [("step", str(t), (x-11, y-11, x+11, y+11)) for t, x, y in BADGES]
    for e in E:
        pts = parse(e["d"])
        if not on_boundary(pts[0], boxes[e["src"]], 2.5):
            errs.append(f"{e['id']}: start {pts[0]} not on {e['src']}")
        if not on_boundary(pts[-1], boxes[e["dst"]], 3):
            errs.append(f"{e['id']}: end {pts[-1]} not on {e['dst']}")
        for a, b in zip(pts, pts[1:]):
            if a[0] != b[0] and a[1] != b[1]:
                errs.append(f"{e['id']}: diagonal segment")
            for n, r in boxes.items():
                if n in (e["src"], e["dst"]):
                    continue
                if seg_hits_rect(a, b, r):
                    errs.append(f"{e['id']}: crosses node {n}")
        for lb in e["labels"]:
            bb = label_bbox(lb)
            labels.append((e["id"], lb[2], bb))
            for n, r in boxes.items():
                if overlap(bb, r):
                    errs.append(f"{e['id']}: label '{lb[2]}' overlaps node {n}")
            if bb[0] < 0 or bb[2] > W:
                errs.append(f"{e['id']}: label '{lb[2]}' outside canvas")
    # label vs label
    for i in range(len(labels)):
        for j in range(i + 1, len(labels)):
            if overlap(labels[i][2], labels[j][2]):
                errs.append(f"labels overlap: {labels[i][:2]} / {labels[j][:2]}")
    # label vs other edges' segments
    for e in E:
        pts = parse(e["d"])
        for (eid, s, bb) in labels:
            for a, b in zip(pts, pts[1:]):
                if seg_hits_rect(a, b, bb, shrink=0):
                    errs.append(f"label '{s}' ({eid}) crosses path {e['id']}")
    for n, r in boxes.items():
        if overlap(r, NOTE):
            errs.append(f"note overlaps {n}")
    return errs

def render():
    o = []
    o.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="Helvetica, Arial, sans-serif">')
    o.append("  <!-- v2 edge list (source of truth for this drawing). Matches docs/multi-agent-design.md v7 (edges unchanged since v6).")
    for e in E:
        lab = " / ".join(lb[2] for lb in e["labels"])
        arrow = "<->" if e["both"] else "->"
        o.append(f"       {e['id']:<4} {e['src']:<9}{arrow:<4}{e['dst']:<9} [{e['kind']}] {html.escape(lab)}")
    o.append("  -->")
    o.append('  <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#374151"/></marker></defs>')
    o.append(f'  <rect width="{W}" height="{H}" fill="#ffffff"/>')
    o.append(f'  <text x="790" y="44" font-size="15" font-weight="bold" fill="#111827">agent-commerce: v7, flow view</text>')
    for n, (c, r, st, t1, t2) in NODES.items():
        fill, stroke, dash = STYLE[st]
        x0, y0, x1, y1 = box(n)
        da = f' stroke-dasharray="{dash}"' if dash else ""
        cx = (x0 + x1) / 2
        o.append(f'  <g id="{n}"><rect fill="{fill}" stroke="{stroke}" stroke-width="1.5"{da} x="{x0}" y="{y0}" width="{NW}" height="{NH}" rx="8"/>'
                 f'<text font-size="13" fill="#111827" text-anchor="middle" x="{cx}" y="{y0+26}">{html.escape(t1)}</text>'
                 f'<text font-size="11" fill="#4b5563" text-anchor="middle" x="{cx}" y="{y0+43}">{html.escape(t2)}</text></g>')
    for e in E:
        dash = ' stroke-dasharray="5 4"' if e["kind"] == "rec" else ""
        ms = ' marker-start="url(#arrow)"' if e["both"] else ""
        o.append(f'  <!-- {e["id"]} --><path fill="none" stroke="#374151" stroke-width="1.4"{dash}{ms} marker-end="url(#arrow)" d="{e["d"]}"/>')
        for lb in e["labels"]:
            x, y, s, anchor = lb[:4]
            rot = f' transform="rotate({lb[4]} {x} {y})"' if len(lb) > 4 else ""
            o.append(f'    <text font-size="10.5" fill="#1f2937" text-anchor="{anchor}" x="{x}" y="{y}"{rot}>{html.escape(s)}</text>')
    for n in MCP:
        bx0, by0, bx1, by1 = badge(n)
        o.append(f'  <g><rect x="{bx0}" y="{by0}" width="{bx1-bx0}" height="{by1-by0}" rx="4" fill="#111827"/><text x="{(bx0+bx1)/2}" y="{by1-3.5}" font-size="9" font-weight="bold" fill="#ffffff" text-anchor="middle">MCP</text></g>')
    for t, x, y in BADGES:
        o.append(f'  <g><circle cx="{x}" cy="{y}" r="10" fill="#15803d"/><text x="{x}" y="{y+3.5}" font-size="{9 if len(str(t))>1 else 11}" font-weight="bold" fill="#ffffff" text-anchor="middle">{t}</text></g>')
    # note
    x0, y0, x1, y1 = NOTE
    o.append(f'  <rect x="{x0}" y="{y0}" width="{x1-x0}" height="{y1-y0}" rx="6" fill="#ffffff" stroke="#9ca3af"/>')
    yy = y0 + 20
    for s, bold in NOTE_LINES:
        fw = ' font-weight="bold"' if bold else ""
        o.append(f'  <text x="{x0+10}" y="{yy}" font-size="11"{fw} fill="#111827">{html.escape(s)}</text>')
        yy += 22 if bold else 18 if s.endswith(("bus,", "writes", "draft_id,", "(catalogue,")) else 18
    # legend
    lx, ly = 1165, LEGEND_Y
    items = [("agent", "agent (LLM)"), ("code", "plain code / record"), ("mock", "mock service"),
             ("cust", "actor (starts events)")]
    o.append(f'  <g font-size="11" fill="#111827">')
    for i, (st, s) in enumerate(items):
        fill, stroke, dash = STYLE[st]
        da = ' stroke-dasharray="4 2"' if dash else ""
        y = ly + i * 20
        o.append(f'    <rect x="{lx}" y="{y}" width="18" height="12" fill="{fill}" stroke="{stroke}"{da}/><text x="{lx+25}" y="{y+10}">{s}</text>')
    y = ly + 5 * 20 + 6
    o.append(f'    <line x1="{lx}" y1="{y}" x2="{lx+30}" y2="{y}" stroke="#374151" stroke-width="1.4"/><text x="{lx+38}" y="{y+4}">event or tool call</text>')
    y += 20
    o.append(f'    <line x1="{lx}" y1="{y}" x2="{lx+30}" y2="{y}" stroke="#374151" stroke-width="1.4" stroke-dasharray="5 4"/><text x="{lx+38}" y="{y+4}">record access (no event)</text>')
    y += 20
    o.append(f'    <rect x="{lx}" y="{y-6}" width="30" height="13" rx="4" fill="#111827"/><text x="{lx+15}" y="{y+3.5}" font-size="9" font-weight="bold" fill="#ffffff" text-anchor="middle">MCP</text><text x="{lx+38}" y="{y+4}">guarded tools via MCP server</text>')
    o.append("  </g>")
    o.append("</svg>")
    return "\n".join(o)

if __name__ == "__main__":
    errs = validate()
    for x in errs:
        print("ERR", x)
    print(f"{len(E)} edges, {len(errs)} problems")
    open(sys.argv[1], "w").write(render())
