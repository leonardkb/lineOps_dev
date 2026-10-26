import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  Send,
  Pencil,
  Trash2,
  RefreshCw,
  AlertCircle,
  Check,
  X,
  Shirt,
  ClipboardList,
} from "lucide-react";
import StyleOrderWizard from "../../components/merchant/StyleOrderWizard";
import { API_URL } from "../../lib/masterCodeCatalog";

/* ==========================================================================
   Style data — table view

   The wizard CREATES the style data (header + telas + avíos + tallas +
   confección + SAM + colorways + paquete de costura). This page lists what
   exists and is where the sample room actually gets asked for a sewn sample:
   each row has "Enviar a muestras", which opens the sample form and POSTs to
   /api/style-orders/:id/send-to-sample.

   Props
     embedded    drop the page background (rendered inside the dashboard)
     reloadToken bump to re-fetch (wired to the navbar's "Actualizar")
     onOnline    (bool) => void — reports fetch health to the dashboard
     openId      open this style data in the wizard on mount (deep link)
   ======================================================================== */

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

const SIZES = ["2XS", "XS", "S", "M", "L", "XL", "XXL", "S-T", "M-T", "L-T", "XL-T", "2XL-T"];
const STAGES = ["1st Proto", "2nd Proto", "Fit Sample", "Size Set", "PP Sample", "TOP", "Salesman"];

const STATUS_META = {
  draft: { label: "Borrador", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  sent_to_sample: { label: "En muestras", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  approved: { label: "Aprobada", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  in_production: { label: "En producción", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  archived: { label: "Archivada", cls: "bg-slate-50 text-slate-400 border-slate-200" },
};
const FILTERS = [
  { id: "all", label: "Todas" },
  { id: "draft", label: "Borradores" },
  { id: "sent_to_sample", label: "En muestras" },
  { id: "approved", label: "Aprobadas" },
];

const num = (n, d = 0) =>
  (Number.isFinite(+n) ? +n : 0).toLocaleString("es-MX", { maximumFractionDigits: d });
const fmtDate = (d) => (d ? String(d).slice(0, 10) : "—");

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400";

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

// ==========================================================================
//  Sample request modal — the "enviar a muestras" step, now living here
// ==========================================================================
function SampleModal({ order, onClose, onSent }) {
  const [form, setForm] = useState({
    stage: "1st Proto",
    size: "M",
    qty: "3",
    costingMarker: false,
    sizeMarker: false,
    clientPatterns: true,
    requester: "",
    remark: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.requester.trim()) {
      setError("Indica quién solicita la muestra (MR).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/style-orders/${order.id}/send-to-sample`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ sample: form }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "No se pudo enviar");
      onSent(data.sampleRequestId, form);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
            <Send size={18} />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-800">Enviar a muestras</h2>
            <p className="truncate text-xs text-slate-500">
              {[order.styleNo, order.styleName].filter(Boolean).join(" · ") || `Style data #${order.id}`}
            </p>
          </div>
          <button onClick={onClose} className="ml-auto p-1 text-slate-300 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Field label="Etapa de muestra">
              <select className={inputCls} value={form.stage} onChange={(e) => set("stage", e.target.value)}>
                {STAGES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Talla">
              <select className={inputCls} value={form.size} onChange={(e) => set("size", e.target.value)}>
                {SIZES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Cantidad">
              <input
                type="number"
                className={`${inputCls} text-right`}
                value={form.qty}
                onChange={(e) => set("qty", e.target.value)}
              />
            </Field>
            <Field label="Solicita (MR)" hint="Obligatorio">
              <input
                className={inputCls}
                placeholder="Nombre de quien solicita"
                value={form.requester}
                onChange={(e) => set("requester", e.target.value)}
              />
            </Field>
            <div className="col-span-2 flex items-end gap-2 md:col-span-1">
              {[
                ["costingMarker", "Marcador de costeo"],
                ["sizeMarker", "Marcador de tallas"],
                ["clientPatterns", "Patrones del cliente"],
              ].map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => set(k, !form[k])}
                  className={`flex-1 rounded-lg border px-2 py-2 text-[11px] font-medium transition-all ${
                    form[k]
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-400"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <Field label="Observaciones">
            <input className={inputCls} value={form.remark} onChange={(e) => set("remark", e.target.value)} />
          </Field>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] text-slate-500">
            El taller recibe la ficha del estilo, la tela, los avíos, la especificación de tallas y las
            operaciones tal como están guardadas en esta style data.
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-400"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
            Enviar a muestras
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================================================
//  Page
// ==========================================================================
export default function StyleDataPage({ embedded = false, reloadToken = 0, onOnline, openId = null }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [toast, setToast] = useState(null);

  // null = table; { id }  = wizard editing that style data; { id: null } = new
  const [editing, setEditing] = useState(openId ? { id: Number(openId) } : null);
  const [sampleFor, setSampleFor] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2600);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/style-orders`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "No se pudo cargar la lista");
      setRows(data.orders || []);
      setError(null);
      onOnline?.(true);
    } catch (err) {
      setError(err.message);
      onOnline?.(false);
    } finally {
      setLoading(false);
    }
  }, [onOnline]);

  useEffect(() => {
    if (!editing) load();
  }, [load, reloadToken, editing]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!needle) return true;
      return [r.styleNo, r.orderNo, r.styleName, r.customerName, r.season, r.version]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [rows, q, filter]);

  const remove = async (row) => {
    try {
      const res = await fetch(`${API_URL}/api/style-orders/${row.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "No se pudo eliminar");
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      showToast("Style data eliminada");
    } catch (err) {
      showToast(err.message, false);
    } finally {
      setConfirmDelete(null);
    }
  };

  // ---- wizard view --------------------------------------------------------
  if (editing) {
    return (
      <StyleOrderWizard
        embedded
        orderId={editing.id}
        onSaved={() => load()}
        onClose={() => {
          setEditing(null);
          load();
        }}
      />
    );
  }

  // ---- table view ---------------------------------------------------------
  return (
    <div className={embedded ? "" : "min-h-screen bg-slate-100"}>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* header */}
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
              <Shirt size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-slate-800">Style data</h2>
              <p className="truncate text-xs text-slate-500">
                Paquete de estilo: materiales, tallas, confección, SAM, colorways y paquete de costura
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={load}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:border-slate-400 disabled:opacity-50"
              >
                <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Actualizar
              </button>
              <button
                onClick={() => setEditing({ id: null })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <Plus size={16} /> Nueva style data
              </button>
            </div>
          </div>

          {/* filters */}
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
            <div className="relative min-w-[220px] flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por estilo, orden, cliente…"
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-400"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    filter === f.id
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 bg-white text-slate-500 hover:border-slate-400"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-slate-400">
              {visible.length} de {rows.length}
            </span>
          </div>

          {/* table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-medium text-slate-400">
                  <th className="px-5 py-2.5">Estilo</th>
                  <th className="px-3 py-2.5">Orden / versión</th>
                  <th className="px-3 py-2.5">Cliente</th>
                  <th className="px-3 py-2.5">Temporada</th>
                  <th className="px-3 py-2.5 text-right">Cantidad</th>
                  <th className="px-3 py-2.5">Entrega</th>
                  <th className="px-3 py-2.5">Estado</th>
                  <th className="px-5 py-2.5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading && !rows.length && (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-400">
                      <RefreshCw size={18} className="mx-auto mb-2 animate-spin" />
                      Cargando style data…
                    </td>
                  </tr>
                )}

                {!loading && error && (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-sm text-rose-600">
                      <AlertCircle size={18} className="mx-auto mb-2" />
                      {error}
                    </td>
                  </tr>
                )}

                {!loading && !error && !visible.length && (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center">
                      <ClipboardList size={22} className="mx-auto mb-2 text-slate-300" />
                      <div className="text-sm text-slate-500">
                        {rows.length ? "Ningún resultado con ese filtro" : "Todavía no hay style data"}
                      </div>
                      {!rows.length && (
                        <button
                          onClick={() => setEditing({ id: null })}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                        >
                          <Plus size={16} /> Crear la primera
                        </button>
                      )}
                    </td>
                  </tr>
                )}

                {visible.map((r) => {
                  const st = STATUS_META[r.status] || STATUS_META.draft;
                  return (
                    <tr key={r.id} className="border-t border-slate-100 align-middle hover:bg-slate-50/60">
                      <td className="px-5 py-3">
                        <div className="font-mono text-sm font-medium text-slate-800">{r.styleNo || "—"}</div>
                        <div className="max-w-[280px] truncate text-xs text-slate-500">{r.styleName || "Sin nombre"}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-mono text-xs text-slate-700">{r.orderNo || "—"}</div>
                        {r.version && <div className="font-mono text-[11px] text-slate-400">{r.version}</div>}
                      </td>
                      <td className="px-3 py-3 text-slate-700">{r.customerName || "—"}</td>
                      <td className="px-3 py-3 text-slate-600">{r.season || "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-700">{num(r.quantity)}</td>
                      <td className="px-3 py-3 text-slate-600">{fmtDate(r.deliveryDate)}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${st.cls}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setSampleFor(r)}
                            title="Enviar a muestras"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                          >
                            <Send size={14} /> Enviar a muestras
                          </button>
                          <button
                            onClick={() => setEditing({ id: r.id })}
                            title="Editar"
                            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:border-slate-400 hover:text-slate-800"
                          >
                            <Pencil size={14} />
                          </button>
                          {confirmDelete === r.id ? (
                            <button
                              onClick={() => remove(r)}
                              className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
                            >
                              ¿Eliminar?
                            </button>
                          ) : (
                            <button
                              onClick={() => setConfirmDelete(r.id)}
                              title="Eliminar"
                              className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:border-rose-300 hover:text-rose-600"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {sampleFor && (
        <SampleModal
          order={sampleFor}
          onClose={() => setSampleFor(null)}
          onSent={(sampleRequestId, form) => {
            setSampleFor(null);
            setRows((rs) =>
              rs.map((r) => (r.id === sampleFor.id ? { ...r, status: "sent_to_sample" } : r))
            );
            showToast(
              `Muestra #${sampleRequestId} solicitada · ${form.stage} · talla ${form.size} · ${form.qty} pza`
            );
          }}
        />
      )}

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg px-4 py-2.5 text-sm text-white shadow-lg ${
            toast.ok ? "bg-slate-900" : "bg-rose-600"
          }`}
        >
          {toast.ok ? <Check size={15} /> : <AlertCircle size={15} />} {toast.msg}
        </div>
      )}
    </div>
  );
}