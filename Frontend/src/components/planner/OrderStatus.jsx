// OrderStatus.jsx — Planner "Estado de Órdenes"
//
// Same look as the CEO status-of-orders page (summary bar, segmented filters,
// table with ORDEN / AVANCE / ENTREGA MERCHANT / FIN DE PLAN / Δ DÍAS /
// ENTREGA), plus what the planner needs on top:
//   • the merchant's style photo next to every order (click to enlarge)
//   • a LÍNEAS column with the lines the order is planned on
//   • click a row to open the per-line breakdown: dates, assigned vs produced
//     and a day-by-day strip for each line.
//
// Data (no backend changes needed):
//   GET /api/work-orders                    -> orders + master_code_photo_url
//   GET /api/line-assignments               -> plan cells (line / day / qty)
//   GET /api/line-assignments/day-balances  -> produced per line / day (optional)
//
// Completar orden (order-close.js):
//   GET  /api/work-orders/:id/close-check   -> producido / asignado / % y regla
//   POST /api/work-orders/:id/close          -> cierre directo (>= umbral; alerta al CEO)
//   POST /api/work-orders/:id/close-requests -> permiso al CEO (< umbral)
//   GET  /api/work-order-close-requests      -> solicitudes pendientes / rechazadas
//
// Props:
//   approverMode  true en la vista del CEO (PlannerAnalytics): cierra sin regla.

import { useEffect, useMemo, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// API — if your other planner components use a shared api helper, swap these
// two for it. The server expects "Authorization: Bearer <token>".
// ---------------------------------------------------------------------------
const API_BASE = ((import.meta.env && import.meta.env.VITE_API_URL) || "http://localhost:5000").replace(/\/$/, "");

function authHeaders() {
  let token = localStorage.getItem("token");
  if (!token) {
    try { token = JSON.parse(localStorage.getItem("user") || "{}").token; } catch { token = null; }
  }
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { ...authHeaders() } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// Para POST/DELETE: NO lanza, el modal necesita leer needsApproval / check.
async function sendJson(method, path, body) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.success !== false, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: err.message || "Sin conexión" } };
  }
}

// ---------------------------------------------------------------------------
// Dates — everything is a local calendar day, never a UTC timestamp.
// ---------------------------------------------------------------------------
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const ymd = (v) => (v ? String(v).slice(0, 10) : null);
const toDay = (s) => {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const fmtDate = (s) => {
  const d = toDay(s);
  if (!d) return "—";
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
};
const fmtShort = (s) => {
  const d = toDay(s);
  return d ? `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]}` : "—";
};
const dayDiff = (a, b) => Math.round((toDay(a) - toDay(b)) / 86400000);
const todayYmd = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fmtN = (n) => nf.format(Math.round(Number(n) || 0));
const lineLabel = (l) => (/^\d+$/.test(String(l).trim()) ? `L${String(l).trim()}` : String(l));
const lineSort = (a, b) => {
  const na = Number(a), nb = Number(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b));
};

// ---------------------------------------------------------------------------
// Small inline icons (no icon library dependency)
// ---------------------------------------------------------------------------
const Svg = ({ children, className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
       strokeLinejoin="round" className={className} aria-hidden="true">{children}</svg>
);
const IconSearch = (p) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>;
const IconSort = (p) => <Svg {...p}><path d="m3 16 4 4 4-4" /><path d="M7 20V4" /><path d="m21 8-4-4-4 4" /><path d="M17 4v16" /></Svg>;
const IconCalendar = (p) => <Svg {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Svg>;
const IconLoader = (p) => <Svg {...p}><path d="M21 12a9 9 0 1 1-6.2-8.6" /></Svg>;
const IconCheck = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></Svg>;
const IconAlert = (p) => <Svg {...p}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></Svg>;
const IconInfo = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></Svg>;
const IconChevron = (p) => <Svg {...p}><path d="m9 6 6 6-6 6" /></Svg>;
const IconClock = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
const IconImage = (p) => <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></Svg>;
const IconRefresh = (p) => <Svg {...p}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></Svg>;
const IconFlag = (p) => <Svg {...p}><path d="M4 22V4" /><path d="M4 4h12l-2 4 2 4H4" /></Svg>;
const IconShield = (p) => <Svg {...p}><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3z" /><path d="m9 12 2 2 4-4" /></Svg>;
const IconX = (p) => <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>;
const fmtDateTime = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d)) return "—";
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// ---------------------------------------------------------------------------
// Visual tokens (shared with the CEO page look)
// ---------------------------------------------------------------------------
const DELIVERY = {
  ontime: { label: "A tiempo", dot: "bg-emerald-500", strip: "bg-emerald-500", pill: "border-emerald-200 bg-emerald-50 text-emerald-700", delta: "text-emerald-600", Icon: IconCheck },
  late: { label: "Atrasada", dot: "bg-rose-500", strip: "bg-rose-500", pill: "border-rose-200 bg-rose-50 text-rose-600", delta: "text-rose-600", Icon: IconAlert },
  unplanned: { label: "Por planear", dot: "bg-amber-400", strip: "bg-amber-400", pill: "border-amber-200 bg-amber-50 text-amber-700", delta: "text-gray-400", Icon: IconClock },
};

const PROGRESS = {
  pending: { label: "Pendiente", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  in_progress: { label: "En proceso", cls: "border-indigo-200 bg-indigo-50 text-indigo-600" },
  completed: { label: "Completada", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
};

const DAY_STATE = {
  met: "border-emerald-200 bg-emerald-50 text-emerald-700",
  short: "border-rose-200 bg-rose-50 text-rose-600",
  today: "border-indigo-300 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  future: "border-gray-200 bg-white text-gray-600",
};

// ---------------------------------------------------------------------------
// Build one view-model per order
// ---------------------------------------------------------------------------
function buildRows(orders, assignments, balances, closeByOrder = new Map()) {
  const today = todayYmd();

  // Produced per (order, line, day) from day-balances, when the server has it.
  const prodByCell = new Map();
  for (const b of balances) {
    prodByCell.set(`${b.work_order_id}|${b.line_no}|${b.assigned_date}`, b);
  }

  // Plan cells grouped by order -> line -> day.
  const planByOrder = new Map();
  for (const a of assignments) {
    if (["cancelled", "rejected"].includes(a.status)) continue;
    const woId = Number(a.work_order_id);
    const line = String(a.line_no ?? "").trim();
    const date = ymd(a.assigned_date);
    if (!line || !date) continue;
    if (!planByOrder.has(woId)) planByOrder.set(woId, new Map());
    const lines = planByOrder.get(woId);
    if (!lines.has(line)) lines.set(line, new Map());
    const days = lines.get(line);
    const cell = days.get(date) || { date, assigned: 0, colors: new Set() };
    cell.assigned += Number(a.assigned_quantity) || 0;
    if (a.color) cell.colors.add(String(a.color));
    days.set(date, cell);
  }

  return orders
    .filter((o) => o.status !== "cancelled")
    .map((o) => {
      const id = Number(o.id);
      const total = Number(o.total_to_produce) || Number(o.quantity) || 0;
      const produced = Number(o.produced_quantity) || 0;

      const lineMap = planByOrder.get(id) || new Map();
      const lines = [...lineMap.keys()].sort(lineSort).map((line) => {
        const days = [...lineMap.get(line).values()]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((c) => {
            const bal = prodByCell.get(`${id}|${line}|${c.date}`);
            const prod = bal ? Number(bal.produced) || 0 : 0;
            const state = c.date === today ? "today"
              : c.date > today ? "future"
              : bal ? (prod >= c.assigned ? "met" : "short")
              : "future";
            return { ...c, colors: [...c.colors], produced: prod, hasProd: !!bal, state };
          });
        const assigned = days.reduce((s, d) => s + d.assigned, 0);
        const lineProduced = days.reduce((s, d) => s + d.produced, 0);
        return {
          line,
          days,
          assigned,
          produced: lineProduced,
          start: days[0]?.date || null,
          end: days[days.length - 1]?.date || null,
        };
      });

      const assigned = lines.length
        ? lines.reduce((s, l) => s + l.assigned, 0)
        : Number(o.assigned_quantity) || 0;
      const planStart = lines.map((l) => l.start).filter(Boolean).sort()[0] || null;
      const planEnd = lines.map((l) => l.end).filter(Boolean).sort().slice(-1)[0] || null;
      const commit = ymd(o.commitment_date);

      const fullyPlanned = !!planEnd && (assigned >= total - 0.5 || produced >= total - 0.5);
      const delta = planEnd && commit ? dayDiff(planEnd, commit) : null;
      const delivery = !fullyPlanned ? "unplanned" : delta != null && delta > 0 ? "late" : "ontime";

      const progress = o.status === "completed" || (total > 0 && produced >= total)
        ? "completed"
        : o.status === "in_progress" || produced > 0
          ? "in_progress"
          : "pending";

      return {
        raw: o,
        id,
        no: o.work_order_no,
        customer: o.customer_name || "—",
        po: o.customer_po || null,
        style: o.style_code || o.estilo || "",
        description: o.style_description || "",
        photo: o.master_code_photo_url || null,
        merchant: o.created_by_name || null,
        total,
        produced,
        assigned,
        unassigned: Math.max(total - assigned, 0),
        pct: total > 0 ? Math.min((produced / total) * 100, 100) : 0,
        commit,
        planStart,
        planEnd,
        delta,
        delivery,
        progress,
        lines,
        // Solicitud de cierre al CEO: pendiente o la ultima rechazada.
        closeReq: closeByOrder.get(id) || null,
      };
    });
}

// "Peores primero": late (most days first), then unplanned (soonest delivery
// first), then on time (tightest first).
const DELIVERY_RANK = { late: 0, unplanned: 1, ontime: 2 };
function worstFirst(a, b) {
  if (DELIVERY_RANK[a.delivery] !== DELIVERY_RANK[b.delivery]) {
    return DELIVERY_RANK[a.delivery] - DELIVERY_RANK[b.delivery];
  }
  if (a.delivery === "unplanned") return (a.commit || "9999").localeCompare(b.commit || "9999");
  return (b.delta ?? -1e9) - (a.delta ?? -1e9);
}
const byDelivery = (a, b) => (a.commit || "9999").localeCompare(b.commit || "9999");

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------
function Segmented({ options, value, onChange }) {
  return (
    <div className="inline-flex items-center rounded-xl border border-gray-200 bg-gray-50 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
            value === o.id
              ? "bg-white font-semibold text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-800"
          }`}
        >
          {o.Icon && <o.Icon className="h-4 w-4" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Thumb({ src, alt, onOpen, size = "h-10 w-10" }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div className={`${size} flex shrink-0 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-gray-300`}
           title="Sin foto del merchant">
        <IconImage className="h-4 w-4" />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(src, alt); }}
      className={`${size} shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300`}
      title="Ver foto"
    >
      <img src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
    </button>
  );
}

function Bar({ pct, tone = "bg-indigo-500" }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(pct, 100))}%` }} />
    </div>
  );
}

// Barra de "Completar orden" dentro del detalle. Muestra la solicitud al CEO si
// existe (pendiente o rechazada) en lugar de esconderla.
function CloseBar({ row, onComplete, approverMode }) {
  const req = row.closeReq;
  if (row.raw.status === "completed") {
    const mode = row.raw.close_mode;
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        <IconCheck className="h-4 w-4" />
        Orden completada
        {mode === "planner" && " por planeación (se avisó al CEO)"}
        {mode === "ceo_approved" && " con permiso del CEO"}
        {mode === "ceo" && " por el CEO"}
        {row.raw.closed_at && <span className="text-emerald-600">· {fmtDateTime(row.raw.closed_at)}</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="min-w-0 flex-1 text-xs">
        {req?.status === "pending" ? (
          <span className="inline-flex items-center gap-1.5 text-amber-700">
            <IconClock className="h-4 w-4" />
            Permiso de cierre enviado al CEO {fmtDateTime(req.requested_at)}
            {req.requested_by_name && <> por <b>{req.requested_by_name}</b></>}. En espera.
          </span>
        ) : req?.status === "rejected" ? (
          <span className="inline-flex flex-wrap items-center gap-1.5 text-rose-700">
            <IconX className="h-4 w-4" />
            El CEO rechazó el cierre {fmtDateTime(req.decided_at)}
            {req.decision_note && <>: <i>“{req.decision_note}”</i></>}
          </span>
        ) : (
          <span className="text-gray-500">
            {approverMode
              ? "Como CEO puede completar esta orden directamente."
              : "Al completar se valida lo producido contra lo asignado."}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => onComplete(row)}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
      >
        <IconCheck className="h-4 w-4" />
        {req?.status === "pending" ? "Ver solicitud" : "Completar orden"}
      </button>
    </div>
  );
}

function LineDetail({ row, onOpenPhoto, onComplete, approverMode }) {
  return (
    <div className="border-t border-gray-100 bg-gray-50/70 px-5 pt-4">
    <CloseBar row={row} onComplete={onComplete} approverMode={approverMode} />
    <div className="grid gap-5 py-4 md:grid-cols-[180px_1fr]">
      {/* Merchant photo + order facts */}
      <div className="space-y-3">
        {row.photo ? (
          <Thumb src={row.photo} alt={row.no} onOpen={onOpenPhoto} size="h-44 w-full" />
        ) : (
          <div className="flex h-44 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-200 bg-white text-xs text-gray-400">
            <IconImage className="h-6 w-6" />
            Sin foto del merchant
          </div>
        )}
        <dl className="space-y-1 text-xs">
          {row.description && (<div><dt className="text-gray-400">Descripción</dt><dd className="text-gray-700">{row.description}</dd></div>)}
          {row.merchant && (<div><dt className="text-gray-400">Merchant</dt><dd className="text-gray-700">{row.merchant}</dd></div>)}
          {row.raw.fabric_name && (<div><dt className="text-gray-400">Tela</dt><dd className="text-gray-700">{row.raw.fabric_name}</dd></div>)}
          {Array.isArray(row.raw.colors) && row.raw.colors.length > 0 && (
            <div>
              <dt className="text-gray-400">Colores</dt>
              <dd className="text-gray-700">{row.raw.colors.map((c) => `${c.color} (${fmtN(c.quantity)})`).join(", ")}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Per-line breakdown */}
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs text-gray-500">
          <span>Total <b className="text-gray-800">{fmtN(row.total)}</b></span>
          <span>Asignado <b className="text-gray-800">{fmtN(row.assigned)}</b></span>
          <span>Producido <b className="text-gray-800">{fmtN(row.produced)}</b></span>
          {row.unassigned > 0 && (
            <span className="rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
              Sin asignar {fmtN(row.unassigned)} pzas
            </span>
          )}
        </div>

        {row.lines.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
            Esta orden aún no está en ninguna línea. Asígnela desde el Plan Board.
          </div>
        ) : (
          <div className="space-y-2">
            {row.lines.map((l) => {
              const linePct = l.assigned > 0 ? (l.produced / l.assigned) * 100 : 0;
              const lateLine = row.commit && l.end && l.end > row.commit;
              return (
                <div key={l.line} className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="inline-flex h-7 min-w-[2.5rem] items-center justify-center rounded-md bg-gray-900 px-2 text-xs font-semibold text-white">
                      {lineLabel(l.line)}
                    </span>
                    <div className="text-xs text-gray-500">
                      <span className="text-gray-800">{fmtShort(l.start)} – {fmtShort(l.end)}</span>
                      {" "}({l.days.length} {l.days.length === 1 ? "día" : "días"})
                      {lateLine && <span className="ml-2 font-medium text-rose-600">termina después de la entrega</span>}
                    </div>
                    <div className="ml-auto flex w-full items-center gap-3 sm:w-64">
                      <span className="whitespace-nowrap text-xs text-gray-500">
                        {fmtN(l.produced)} / {fmtN(l.assigned)}
                      </span>
                      <Bar pct={linePct} />
                      <span className="w-9 text-right text-xs font-medium text-gray-700">{Math.round(linePct)}%</span>
                    </div>
                  </div>

                  {/* Day strip */}
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {l.days.map((d) => (
                      <div
                        key={d.date}
                        className={`rounded-md border px-2 py-1 text-[11px] leading-tight ${DAY_STATE[d.state]}`}
                        title={`${fmtDate(d.date)} · asignado ${fmtN(d.assigned)}${d.hasProd ? ` · producido ${fmtN(d.produced)}` : ""}${d.colors.length ? ` · ${d.colors.join(", ")}` : ""}`}
                      >
                        <div className="font-medium">{fmtShort(d.date)}</div>
                        <div className="tabular-nums">
                          {d.hasProd || d.state === "today" ? `${fmtN(d.produced)}/` : ""}{fmtN(d.assigned)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-3 pt-1 text-[11px] text-gray-400">
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-emerald-400" />Día cumplido</span>
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-rose-400" />Día con saldo</span>
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-indigo-400" />Hoy</span>
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm border border-gray-300 bg-white" />Programado</span>
            </div>
          </div>
        )}
      </div>
    </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal "Completar orden"
//   >= umbral  -> cierra directo; el servidor deja una alerta al CEO
//   <  umbral  -> pide motivo y manda solicitud de permiso al CEO
//   CEO        -> cierra directo
// Los numeros vienen del servidor (close-check), no de la tabla, para que la
// decision sea la misma que va a aplicar el backend.
// ---------------------------------------------------------------------------
function CloseOrderModal({ row, onClose, onDone }) {
  const [check, setCheck] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const fetchCheck = useCallback(async () => {
    setLoadErr("");
    try {
      const d = await getJson(`/api/work-orders/${row.id}/close-check`);
      setCheck(d.check);
    } catch (e) {
      setLoadErr(e.message);
    }
  }, [row.id]);

  useEffect(() => { fetchCheck(); }, [fetchCheck]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const pending = check?.pendingRequest;
  const direct = check?.canCloseDirectly;
  const pct = check?.pct;
  const threshold = check?.thresholdPct ?? 5;
  const reasonOk = text.trim().length >= 5;

  const submit = async () => {
    setBusy(true);
    setErr("");
    let r;
    if (direct) {
      r = await sendJson("POST", `/api/work-orders/${row.id}/close`, { reason: text.trim() || undefined });
      // Lo producido cambio entre el check y el clic: refrescar y cambiar de modo.
      if (!r.ok && r.data?.needsApproval) {
        await fetchCheck();
        setErr(r.data.error);
        setBusy(false);
        return;
      }
    } else {
      r = await sendJson("POST", `/api/work-orders/${row.id}/close-requests`, { reason: text.trim() });
    }
    setBusy(false);
    if (!r.ok) { setErr(r.data?.error || "No se pudo completar."); return; }
    onDone(r.data?.message || (direct ? "Orden completada." : "Solicitud enviada al CEO."));
  };

  const withdraw = async () => {
    setBusy(true);
    setErr("");
    const r = await sendJson("DELETE", `/api/work-order-close-requests/${pending.id}`);
    setBusy(false);
    if (!r.ok) { setErr(r.data?.error || "No se pudo retirar."); return; }
    onDone("Solicitud retirada.");
  };

  const meterPct = Math.max(0, Math.min(pct ?? 0, 100));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4"
      onClick={() => !busy && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-order-title"
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id="close-order-title" className="text-base font-semibold text-gray-900">Completar orden</h2>
            <p className="truncate font-mono text-sm text-gray-500">{row.no}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Cerrar">
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {loadErr ? (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {loadErr}{" "}
              <button type="button" onClick={fetchCheck} className="font-semibold underline">Reintentar</button>
            </div>
          ) : !check ? (
            <div className="py-6 text-center text-sm text-gray-500">Revisando producción…</div>
          ) : (
            <>
              {/* Producido vs asignado, con la marca del umbral */}
              <div>
                <div className="mb-1.5 flex items-baseline justify-between text-sm">
                  <span className="text-gray-500">
                    Producido <b className="text-gray-900 tabular-nums">{fmtN(check.produced)}</b> de{" "}
                    <b className="text-gray-900 tabular-nums">{fmtN(check.assigned)}</b> asignadas
                  </span>
                  <span className={`text-lg font-bold tabular-nums ${check.meetsRule ? "text-emerald-600" : "text-rose-600"}`}>
                    {pct == null ? "—" : `${Math.round(pct * 10) / 10}%`}
                  </span>
                </div>
                <div className="relative h-2.5 w-full overflow-visible rounded-full bg-gray-100">
                  <div className={`h-full rounded-full ${check.meetsRule ? "bg-emerald-500" : "bg-rose-500"}`} style={{ width: `${meterPct}%` }} />
                  <span
                    className="absolute -top-1 w-0.5 rounded bg-gray-700"
                    style={{ left: `${Math.min(threshold, 100)}%`, height: "18px" }}
                    title={`Mínimo ${threshold}%`}
                  />
                </div>
                <div className="mt-1 text-[11px] text-gray-400">
                  Mínimo para cerrar sin permiso: {threshold}% de lo asignado · Total de la orden {fmtN(check.total)}
                </div>
              </div>

              {/* Mensaje segun el caso */}
              {pending ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                  <div className="flex items-center gap-1.5 font-semibold"><IconClock className="h-4 w-4" />Esperando al CEO</div>
                  <p className="mt-1 text-xs">Enviada {fmtDateTime(pending.requested_at)}. Motivo: “{pending.reason}”</p>
                </div>
              ) : check.isApprover ? (
                <div className="flex gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-sm text-indigo-800">
                  <IconShield className="mt-0.5 h-4 w-4 shrink-0" />
                  Como CEO puede completar la orden sin importar lo producido.
                </div>
              ) : direct ? (
                <div className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
                  <IconFlag className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>La orden cumple el mínimo. Se completará y <b>el CEO recibirá una alerta</b> del cierre.</span>
                </div>
              ) : (
                <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
                  <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {check.assigned > 0
                      ? <>Lo producido está por debajo del {threshold}% de lo asignado. </>
                      : <>La orden no tiene piezas asignadas. </>}
                    Para completarla necesita <b>permiso del CEO</b>.
                  </span>
                </div>
              )}

              {!pending && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">
                    {direct ? "Nota para el CEO (opcional)" : "Motivo para el CEO"}
                  </span>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder={direct ? "Ej. el cliente aceptó embarque corto" : "Ej. el cliente canceló el resto del pedido"}
                    className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </label>
              )}

              {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
          <button type="button" onClick={onClose} disabled={busy}
                  className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50">
            {pending ? "Cerrar" : "Cancelar"}
          </button>
          {check && pending && (
            <button type="button" onClick={withdraw} disabled={busy}
                    className="h-9 rounded-lg border border-rose-200 bg-white px-3 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50">
              Retirar solicitud
            </button>
          )}
          {check && !pending && (
            <button
              type="button"
              onClick={submit}
              disabled={busy || (!direct && !reasonOk)}
              className={`h-9 rounded-lg px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                direct ? "bg-emerald-600 hover:bg-emerald-700" : "bg-amber-600 hover:bg-amber-700"
              }`}
            >
              {busy ? "Enviando…" : direct ? "Completar orden" : "Solicitar permiso al CEO"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function OrderStatus({ approverMode = false } = {}) {
  const [orders, setOrders] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [balances, setBalances] = useState([]);
  const [closeReqs, setCloseReqs] = useState([]);
  const [closing, setClosing] = useState(null);   // fila en el modal "Completar"
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [deliveryFilter, setDeliveryFilter] = useState("all"); // all | open | late | unplanned
  const [progressFilter, setProgressFilter] = useState("all"); // all | pending | in_progress | completed
  const [lineFilter, setLineFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [worst, setWorst] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set());
  const [lightbox, setLightbox] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const [wo, la, db, cr] = await Promise.allSettled([
      getJson("/api/work-orders"),
      getJson("/api/line-assignments"),
      getJson("/api/line-assignments/day-balances"),
      getJson("/api/work-order-close-requests?kind=request&status=pending,rejected&limit=500"),
    ]);
    if (wo.status === "fulfilled") setOrders(wo.value.workOrders || []);
    else setError(`No se pudieron cargar las órdenes: ${wo.reason?.message || ""}`);
    setAssignments(la.status === "fulfilled" ? la.value.assignments || [] : []);
    setBalances(db.status === "fulfilled" ? db.value.rows || [] : []);
    setCloseReqs(cr.status === "fulfilled" ? cr.value.items || [] : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Close the photo with Escape.
  useEffect(() => {
    if (!lightbox) return undefined;
    const onKey = (e) => e.key === "Escape" && setLightbox(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  // Una solicitud por orden: la pendiente gana; si no hay, la ultima rechazada.
  const closeByOrder = useMemo(() => {
    const m = new Map();
    for (const r of closeReqs) {
      const id = Number(r.work_order_id);
      const cur = m.get(id);
      if (!cur
        || (r.status === "pending" && cur.status !== "pending")
        || (r.status === cur.status && String(r.requested_at) > String(cur.requested_at))) {
        m.set(id, r);
      }
    }
    return m;
  }, [closeReqs]);

  const rows = useMemo(
    () => buildRows(orders, assignments, balances, closeByOrder),
    [orders, assignments, balances, closeByOrder]
  );

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const onCloseDone = (msg) => {
    setClosing(null);
    setToast(msg);
    load();
  };

  const counts = useMemo(() => {
    const c = { ontime: 0, late: 0, unplanned: 0 };
    for (const r of rows) c[r.delivery] += 1;
    return c;
  }, [rows]);

  const allLines = useMemo(() => {
    const s = new Set();
    rows.forEach((r) => r.lines.forEach((l) => s.add(l.line)));
    return [...s].sort(lineSort);
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (deliveryFilter === "open" && r.progress === "completed") return false;
        if (deliveryFilter === "late" && r.delivery !== "late") return false;
        if (deliveryFilter === "unplanned" && r.delivery !== "unplanned") return false;
        if (progressFilter !== "all" && r.progress !== progressFilter) return false;
        if (lineFilter !== "all" && !r.lines.some((l) => l.line === lineFilter)) return false;
        if (q) {
          const hay = [r.no, r.customer, r.po, r.style, r.description, ...r.lines.map((l) => lineLabel(l.line))]
            .filter(Boolean).join(" ").toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort(worst ? worstFirst : byDelivery);
  }, [rows, deliveryFilter, progressFilter, lineFilter, search, worst]);

  const toggle = (id) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const openPhoto = (src, alt) => setLightbox({ src, alt });
  const totalCount = counts.ontime + counts.late + counts.unplanned || 1;

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex h-2 min-w-[200px] flex-1 overflow-hidden rounded-full bg-gray-100">
          <div className="bg-emerald-500" style={{ width: `${(counts.ontime / totalCount) * 100}%` }} />
          <div className="bg-rose-500" style={{ width: `${(counts.late / totalCount) * 100}%` }} />
          <div className="bg-amber-400" style={{ width: `${(counts.unplanned / totalCount) * 100}%` }} />
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
          {["ontime", "late", "unplanned"].map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <i className={`h-2 w-2 rounded-full ${DELIVERY[k].dot}`} />
              {DELIVERY[k].label} <b className="text-gray-800">{counts[k]}</b>
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <IconInfo className="h-3.5 w-3.5" />
            El fin de plan debe caer <b className="text-gray-700">antes o el mismo día</b> que la entrega del merchant.
          </span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={deliveryFilter}
          onChange={setDeliveryFilter}
          options={[
            { id: "all", label: "Todas" },
            { id: "open", label: "Abiertas" },
            { id: "late", label: "Atrasadas" },
            { id: "unplanned", label: "Por planear" },
          ]}
        />
        <Segmented
          value={progressFilter}
          onChange={setProgressFilter}
          options={[
            { id: "all", label: "Todo estado" },
            { id: "pending", label: "Pendientes", Icon: IconCalendar },
            { id: "in_progress", label: "En proceso", Icon: IconLoader },
            { id: "completed", label: "Completadas", Icon: IconCheck },
          ]}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Buscar</span>
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar orden, cliente o PO…"
              className="h-10 w-60 rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </label>
          <select
            value={lineFilter}
            onChange={(e) => setLineFilter(e.target.value)}
            className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            aria-label="Filtrar por línea"
          >
            <option value="all">Todas las líneas</option>
            {allLines.map((l) => (<option key={l} value={l}>{lineLabel(l)}</option>))}
          </select>
          <button
            type="button"
            onClick={() => setWorst((w) => !w)}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          >
            <IconSort className="h-4 w-4" />
            {worst ? "Peores primero" : "Por entrega"}
          </button>
          <button
            type="button"
            onClick={load}
            title="Actualizar"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          >
            <IconRefresh className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="max-h-[70vh] overflow-auto">
          <div className="min-w-[1080px]">
            <div className="sticky top-0 z-10 grid grid-cols-[minmax(300px,2.4fr)_minmax(110px,0.9fr)_minmax(170px,1.3fr)_120px_120px_80px_130px] items-center gap-4 border-b border-gray-100 bg-white px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              <div>Orden</div>
              <div>Líneas</div>
              <div>Avance</div>
              <div className="text-right">Entrega merchant</div>
              <div className="text-right">Fin de plan</div>
              <div className="text-right">Δ días</div>
              <div className="text-right">Entrega</div>
            </div>

            {loading && rows.length === 0 && (
              <div className="px-5 py-12 text-center text-sm text-gray-500">Cargando órdenes…</div>
            )}
            {!loading && visible.length === 0 && (
              <div className="px-5 py-12 text-center text-sm text-gray-500">
                Ninguna orden coincide con estos filtros.
              </div>
            )}

            {visible.map((r) => {
              const d = DELIVERY[r.delivery];
              const p = PROGRESS[r.progress];
              const open = expanded.has(r.id);
              return (
                <div key={r.id} className="relative border-b border-gray-100 last:border-b-0">
                  <span className={`absolute inset-y-0 left-0 w-1 ${d.strip}`} aria-hidden="true" />
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggle(r.id)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle(r.id))}
                    aria-expanded={open}
                    className={`grid cursor-pointer grid-cols-[minmax(300px,2.4fr)_minmax(110px,0.9fr)_minmax(170px,1.3fr)_120px_120px_80px_130px] items-center gap-4 px-5 py-3 transition-colors focus:outline-none focus-visible:bg-indigo-50/40 ${
                      open ? "bg-gray-50" : "hover:bg-gray-50/70"
                    }`}
                  >
                    {/* Orden */}
                    <div className="flex min-w-0 items-center gap-3">
                      <IconChevron className={`h-4 w-4 shrink-0 text-gray-300 transition-transform ${open ? "rotate-90 text-gray-500" : ""}`} />
                      <Thumb src={r.photo} alt={r.no} onOpen={openPhoto} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-mono text-sm font-bold text-gray-900">{r.no}</span>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${p.cls}`}>{p.label}</span>
                          {r.closeReq?.status === "pending" && r.raw.status !== "completed" && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800"
                                  title={`Motivo: ${r.closeReq.reason || "—"}`}>
                              <IconClock className="h-3 w-3" />
                              Cierre en espera del CEO
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-gray-400">
                          {[r.customer, r.po && `PO ${r.po}`, r.style].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </div>

                    {/* Líneas */}
                    <div className="flex flex-wrap gap-1">
                      {r.lines.length === 0 ? (
                        <span className="text-xs text-gray-300">Sin línea</span>
                      ) : (
                        r.lines.slice(0, 4).map((l) => (
                          <span key={l.line} className="rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-semibold text-gray-700"
                                title={`${lineLabel(l.line)}: ${fmtN(l.assigned)} pzas, ${fmtShort(l.start)} – ${fmtShort(l.end)}`}>
                            {lineLabel(l.line)}
                          </span>
                        ))
                      )}
                      {r.lines.length > 4 && (
                        <span className="px-1 text-[11px] text-gray-400">+{r.lines.length - 4}</span>
                      )}
                    </div>

                    {/* Avance */}
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-gray-500">{fmtN(r.produced)} / {fmtN(r.total)}</span>
                        <span className="font-medium text-gray-700">{Math.round(r.pct)}%</span>
                      </div>
                      <Bar pct={r.pct} tone={r.progress === "completed" ? "bg-emerald-500" : "bg-indigo-500"} />
                    </div>

                    {/* Entrega merchant */}
                    <div className="text-right text-sm text-gray-800">{fmtDate(r.commit)}</div>

                    {/* Fin de plan */}
                    <div className="text-right">
                      <div className="text-sm text-gray-800">{r.planEnd ? fmtDate(r.planEnd) : "—"}</div>
                      {r.planStart && <div className="text-[11px] text-gray-400">inicia {fmtDate(r.planStart)}</div>}
                    </div>

                    {/* Δ días */}
                    <div className={`text-right text-sm font-semibold tabular-nums ${r.delta == null ? "text-gray-300" : r.delta > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                      {r.delta == null ? "—" : r.delta > 0 ? `+${r.delta}` : r.delta}
                    </div>

                    {/* Entrega */}
                    <div className="flex justify-end">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${d.pill}`}>
                        <d.Icon className="h-3.5 w-3.5" />
                        {d.label}
                      </span>
                    </div>
                  </div>

                  {open && (
                    <LineDetail row={r} onOpenPhoto={openPhoto} onComplete={setClosing} approverMode={approverMode} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {closing && (
        <CloseOrderModal row={closing} onClose={() => setClosing(null)} onDone={onCloseDone} />
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg" role="status">
          {toast}
        </div>
      )}

      {/* Photo lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Foto de ${lightbox.alt}`}
        >
          <figure className="max-h-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.src} alt={lightbox.alt} className="max-h-[80vh] rounded-lg bg-white object-contain" />
            <figcaption className="mt-2 flex items-center justify-between text-sm text-white">
              <span className="font-mono">{lightbox.alt}</span>
              <button type="button" onClick={() => setLightbox(null)} className="rounded-md px-2 py-1 hover:bg-white/10">
                Cerrar
              </button>
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}