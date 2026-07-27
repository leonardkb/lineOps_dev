// components/cutting/CuttingEntry.jsx
//
// Registrar corte: elegir la orden (con su orden de trabajo), ingresar N° de
// paneles y cantidad a cortar; se calcula el restante por cortar. Guardar,
// completar y luego imprimir el ticket para las líneas.
//
import { useState, useEffect, useMemo } from "react";
import { Search, RefreshCw, Camera, Calendar, AlertCircle, CheckCircle, Printer } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";
import { colorForWO } from "../../lib/workOrderColors";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});
const num = (v) => Number(v) || 0;

const STATUS = {
  pending: { label: "Pendiente", pill: "bg-yellow-100 text-yellow-700" },
  in_progress: { label: "En corte", pill: "bg-purple-100 text-purple-700" },
  completed: { label: "Cortada", pill: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelada", pill: "bg-gray-100 text-gray-500" },
};

const fmtDate = (v) => {
  if (!v) return "—";
  const s = typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v;
  const [y, m, d] = String(s).split("-");
  return d ? `${d}/${m}/${y}` : String(s);
};

export default function CuttingEntry() {
  const [cutOrders, setCutOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState("open");
  const [selected, setSelected] = useState(null);

  const [form, setForm] = useState({ panels: "", amountCut: "" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => { fetchCutOrders(); }, []);

  const fetchCutOrders = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/cut-orders`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setCutOrders(data.cutOrders || []);
      else setError(data.error || "No se pudieron cargar las órdenes de corte");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return cutOrders
      .filter((co) => (filter === "open" ? co.status !== "completed" && co.status !== "cancelled" : filter === "completed" ? co.status === "completed" : true))
      .filter((co) => {
        if (!q) return true;
        const hay = `${co.work_order_no} ${co.customer_name || ""} ${co.style_code || ""} ${co.estilo || ""} ${co.color || ""} ${co.fabric || ""}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [cutOrders, filter, searchTerm]);

  const cutNo = (co) => `CORTE-${String(co.id).padStart(4, "0")}`;

  const pickOrder = (co) => {
    setSelected(co);
    setForm({
      panels: co.panels != null ? String(co.panels) : "",
      amountCut: co.amount_cut != null ? String(Math.round(num(co.amount_cut))) : "",
    });
    setMessage("");
    setError("");
  };

  // Restante por cortar = cantidad de la orden − cantidad cortada.
  const restante = useMemo(() => {
    if (!selected) return 0;
    const r = num(selected.quantity) - num(form.amountCut);
    return r > 0 ? Math.round(r) : 0;
  }, [selected, form.amountCut]);

  const handleSave = async () => {
    if (!selected) return;
    if (form.amountCut === "" || num(form.amountCut) < 0) return setError("Ingrese la cantidad a cortar");
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/api/cut-orders/${selected.id}/cutting`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({
          panels: form.panels === "" ? null : Number(form.panels),
          amountCut: Number(form.amountCut),
          remainingToCut: restante,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage("✅ Corte guardado");
        await fetchCutOrders();
        setSelected(data.cutOrder);
      } else {
        setError(data.error || "No se pudo guardar");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    if (!selected) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/api/cut-orders/${selected.id}/status`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ status: "completed" }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage("✅ Corte completado");
        await fetchCutOrders();
        setSelected((s) => ({ ...s, status: "completed" }));
      } else {
        setError(data.error || "No se pudo completar");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const printTicket = (co) => {
    const esc = (s) => String(s ?? "—").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const estilo = co.style_code || co.estilo || co.style_description || "—";
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(cutNo(co))}</title>
      <style>
        :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; }
        * { box-sizing: border-box; }
        html,body { margin:0; padding:0; background:#f1f5f9; }
        body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: var(--ink); padding: 24px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .ticket { width: 420px; margin: 0 auto; background:#fff; border-radius: 16px; overflow:hidden; box-shadow: 0 10px 30px rgba(0,0,0,.12); position: relative; }
        .top { background: var(--ink); color:#fff; padding: 18px 22px; }
        .top .kicker { font-size: 11px; letter-spacing: .18em; text-transform: uppercase; opacity:.7; }
        .top .title { font-size: 22px; font-weight: 800; margin-top: 2px; }
        .top .row { display:flex; justify-content: space-between; align-items:flex-end; }
        .top .code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; opacity:.9; }
        .notch { position:absolute; width: 26px; height: 26px; background:#f1f5f9; border-radius:50%; top: 74px; }
        .notch.l { left: -13px; } .notch.r { right: -13px; }
        .perf { border-top: 2px dashed var(--line); margin: 0; }
        .hero { padding: 18px 22px 6px; }
        .hero .label { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
        .hero .estilo { font-size: 30px; font-weight: 800; line-height: 1.05; margin-top: 2px; }
        .grid { display:grid; grid-template-columns: 1fr 1fr; gap: 0; padding: 8px 22px 8px; }
        .cell { padding: 12px 6px; border-top: 1px solid var(--line); }
        .cell:nth-child(odd){ border-right: 1px solid var(--line); padding-right: 14px; }
        .cell:nth-child(even){ padding-left: 14px; }
        .cell .label { font-size: 10px; letter-spacing:.1em; text-transform:uppercase; color: var(--muted); }
        .cell .value { font-size: 20px; font-weight: 700; margin-top: 2px; }
        .panels { background: #fef3c7; }
        .panels .value { color:#b45309; }
        .barcode { height: 44px; margin: 10px 22px 6px; background: repeating-linear-gradient(90deg,#0f172a 0 2px,#fff 2px 4px,#0f172a 4px 5px,#fff 5px 9px); border-radius: 4px; }
        .barlabel { text-align:center; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; letter-spacing:.3em; color: var(--ink); padding-bottom: 12px; }
        .foot { border-top: 2px dashed var(--line); padding: 10px 22px 18px; font-size: 11px; color: var(--muted); display:flex; justify-content: space-between; }
        @media print { html,body{ background:#fff; } body{ padding:0; } .ticket{ box-shadow:none; } .notch{ background:#fff; } }
      </style></head>
      <body>
        <div class="ticket">
          <div class="top">
            <div class="kicker">Orden a Líneas</div>
            <div class="row">
              <div class="title">${esc(co.customer_name)}</div>
              <div class="code">${esc(co.work_order_no)}</div>
            </div>
          </div>
          <div class="notch l"></div><div class="notch r"></div>
          <div class="hero">
            <div class="label">Estilo</div>
            <div class="estilo">${esc(estilo)}</div>
          </div>
          <div class="grid">
            <div class="cell"><div class="label">Color</div><div class="value">${esc(co.color)}</div></div>
            <div class="cell panels"><div class="label">N° de paneles</div><div class="value">${esc(co.panels)}</div></div>
            <div class="cell"><div class="label">Cantidad cortada</div><div class="value">${co.amount_cut != null ? Math.round(num(co.amount_cut)).toLocaleString() : "—"}</div></div>
            <div class="cell"><div class="label">Tela</div><div class="value">${esc(co.fabric)}</div></div>
          </div>
          <div class="barcode"></div>
          <div class="barlabel">${esc(cutNo(co))}</div>
          <div class="foot"><span>${esc(fmtDate(co.cut_date))}</span><span>LineOps</span></div>
        </div>
        <script>window.onload=function(){window.print();}</script>
      </body></html>`;
    const w = window.open("", "_blank", "width=520,height=760");
    if (!w) { setError("Permita ventanas emergentes para imprimir."); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {/* Left: pick a cut order */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {[{ id: "open", label: "Por cortar" }, { id: "completed", label: "Cortadas" }, { id: "all", label: "Todas" }].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 text-sm rounded-full border transition ${filter === f.id ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}
            >
              {f.label}
            </button>
          ))}
          <button onClick={fetchCutOrders} className="ml-auto inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text" placeholder="Buscar orden, cliente, estilo, color, tela…"
            value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
          />
        </div>

        {error && !selected && <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm">{error}</div>}

        <div className="rounded-2xl border bg-white shadow-sm divide-y max-h-[70vh] overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Cargando…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No hay órdenes de corte.</div>
          ) : (
            filtered.map((co) => {
              const meta = STATUS[co.status] || { label: co.status, pill: "bg-gray-100 text-gray-700" };
              const isSel = selected?.id === co.id;
              return (
                <button key={co.id} onClick={() => pickOrder(co)} className={`w-full text-left p-4 flex gap-3 items-center hover:bg-gray-50 ${isSel ? "bg-blue-50" : ""}`}>
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorForWO(co.work_order_id).dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold text-gray-900">{cutNo(co)}</span>
                      <span className={`text-[11px] rounded-full px-2 py-0.5 ${meta.pill}`}>{meta.label}</span>
                    </div>
                    <p className="text-xs text-gray-500 truncate">{co.work_order_no} · {co.customer_name}{co.color ? ` · ${co.color}` : ""}</p>
                  </div>
                  <div className="text-right text-[11px] text-gray-500">
                    {num(co.remaining_to_cut) > 0 ? <span className="text-amber-600 font-medium">Restan {Math.round(num(co.remaining_to_cut)).toLocaleString()}</span> : `${Math.round(num(co.quantity)).toLocaleString()} pzas`}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right: entry */}
      <div className="lg:sticky lg:top-6">
        {!selected ? (
          <div className="rounded-2xl border bg-white shadow-sm p-8 text-center text-gray-500">
            Elija una orden de corte para registrar el corte.
          </div>
        ) : (
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="px-5 py-4 border-b flex items-start gap-3">
              <div className="w-14 h-14 rounded-xl bg-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                {selected.master_code_photo_url ? <img src={selected.master_code_photo_url} alt="" className="w-full h-full object-cover" /> : <Camera className="w-5 h-5 text-gray-300" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-mono font-bold text-gray-900">{cutNo(selected)}</h2>
                  <span className={`text-[11px] rounded-full px-2 py-0.5 ${(STATUS[selected.status] || {}).pill || "bg-gray-100 text-gray-700"}`}>
                    {(STATUS[selected.status] || {}).label || selected.status}
                  </span>
                </div>
                <p className="text-sm text-gray-600 truncate">{selected.work_order_no} · {selected.customer_name}</p>
              </div>
            </div>

            <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm border-b">
              <Info label="Estilo" value={selected.style_code || selected.estilo} />
              <Info label="Color" value={selected.color} />
              <Info label="Tela" value={selected.fabric} />
              <Info label="A cortar" value={`${Math.round(num(selected.quantity)).toLocaleString()} pzas`} />
              <Info label="Rendimiento" value={selected.yield_per_piece != null ? `${num(selected.yield_per_piece)} m/pza` : "—"} />
              <Info label="Fecha" value={fmtDate(selected.cut_date)} icon={Calendar} />
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="N° de paneles">
                  <input type="number" min="0" value={form.panels} onChange={(e) => setForm((f) => ({ ...f, panels: e.target.value }))} placeholder="0"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10" />
                </Field>
                <Field label="Cantidad a cortar">
                  <input type="number" min="0" value={form.amountCut} onChange={(e) => setForm((f) => ({ ...f, amountCut: e.target.value }))} placeholder="0"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10" />
                </Field>
                <Field label="Restante por cortar">
                  <input type="text" value={restante.toLocaleString()} readOnly
                    className="w-full rounded-xl border border-gray-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700 outline-none" />
                </Field>
              </div>

              {error && <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm">{error}</div>}
              {message && <div className="bg-green-50 text-green-700 p-3 rounded-xl text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4" /> {message}</div>}

              <button onClick={handleSave} disabled={saving} className="w-full rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
                {saving ? "Guardando…" : "Guardar corte"}
              </button>

              {selected.status === "completed" ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-xl p-3">
                    <CheckCircle className="w-4 h-4" /> Corte completado
                  </div>
                  <button onClick={() => printTicket(selected)} className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50">
                    <Printer className="w-4 h-4" /> Imprimir orden a líneas
                  </button>
                </div>
              ) : (
                <button onClick={handleComplete} disabled={saving} className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
                  <CheckCircle className="w-4 h-4" /> Completar corte
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Info({ label, value, icon: Icon }) {
  return (
    <div className="rounded-xl p-3 border bg-gray-50 border-gray-100">
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="w-3.5 h-3.5 text-gray-400" />}
        <span className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-sm font-semibold text-gray-900">{value || "—"}</div>
    </div>
  );
}
function Field({ label, children }) {
  return (<div><label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>{children}</div>);
}