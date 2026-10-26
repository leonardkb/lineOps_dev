// components/merchant/StyleActionModals.jsx
//
// The actions that open after a style is completed, shared by the Estilos tab,
// the wizard's final step and (for purchasing) the PO wizard:
//   • SendToSampleModal       → POST /api/style-orders/:id/send-to-sample
//   • ConvertToPreOrderModal  → POST /api/style-orders/:id/convert-to-pre-order
//   • SendToPurchasingModal   → POST /api/style-orders/:id/purchase-preview
//                               POST /api/style-orders/:id/send-to-purchasing
// Style costing is a full view (StyleCostingWizard), so it isn't a modal.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Send, X, RefreshCw, Check, AlertCircle, ClipboardList, ArrowRight, ShoppingCart } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });
const jsonHeaders = () => ({ ...authHeaders(), "Content-Type": "application/json" });

export const SAMPLE_SIZES = ["2XS", "XS", "S", "M", "L", "XL", "XXL", "S-T", "M-T", "L-T", "XL-T", "2XL-T"];
export const SAMPLE_STAGES = ["1st Proto", "2nd Proto", "Fit Sample", "Size Set", "PP Sample", "TOP", "Salesman"];

// Lifecycle labels, shared so the list and the wizard say the same thing.
export const STYLE_STATUS = {
  draft: { label: "Borrador", cls: "bg-slate-100 text-slate-600" },
  completed: { label: "Estilo completo", cls: "bg-indigo-100 text-indigo-700" },
  sent_to_sample: { label: "En muestras", cls: "bg-amber-100 text-amber-700" },
  approved: { label: "Aprobado", cls: "bg-emerald-100 text-emerald-700" },
  pre_order: { label: "Pre-orden", cls: "bg-violet-100 text-violet-700" },
  in_production: { label: "En producción", cls: "bg-sky-100 text-sky-700" },
  archived: { label: "Archivado", cls: "bg-slate-100 text-slate-400" },
};

const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400";

function ModalShell({ icon: Icon, iconCls, title, subtitle, onClose, children, footer, wide = false }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className={`w-full ${wide ? "max-w-4xl" : "max-w-lg"} rounded-2xl bg-white shadow-xl max-h-[92vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <div className={`w-9 h-9 rounded-lg text-white flex items-center justify-center ${iconCls}`}>
            <Icon size={18} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="ml-auto p-1 text-slate-400 hover:text-slate-700" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        {children}
        {footer && <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">{footer}</div>}
      </div>
    </div>
  );
}

const styleLabel = (o) => [o.styleCode, o.styleNo, o.styleName].filter(Boolean).join(" · ") || `#${o.id}`;

// ==========================================================================
//  Enviar a muestras
// ==========================================================================
export function SendToSampleModal({ order, onClose, onSent, onError }) {
  const [form, setForm] = useState({
    stage: "1st Proto",
    size: "M",
    qty: "3",
    requester: "",
    costingMarker: false,
    sizeMarker: false,
    clientPatterns: true,
    remark: "",
  });
  const [sending, setSending] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.requester.trim()) return onError?.("Indica quién solicita la muestra (MR)");
    setSending(true);
    try {
      const res = await fetch(`${API_URL}/api/style-orders/${order.id}/send-to-sample`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ sample: form }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "No se pudo enviar");
      onSent?.(data);
    } catch (err) {
      onError?.(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <ModalShell
      icon={Send}
      iconCls="bg-emerald-600"
      title="Enviar a muestras"
      subtitle={styleLabel(order)}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-400">
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={sending}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {sending ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
            Enviar a muestras
          </button>
        </>
      }
    >
      <div className="p-5 grid grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">Etapa</span>
          <select className={inputCls} value={form.stage} onChange={(e) => set("stage", e.target.value)}>
            {SAMPLE_STAGES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">Talla</span>
          <select className={inputCls} value={form.size} onChange={(e) => set("size", e.target.value)}>
            {SAMPLE_SIZES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">Cantidad</span>
          <input type="number" className={`${inputCls} text-right`} value={form.qty} onChange={(e) => set("qty", e.target.value)} />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">Solicita (MR)</span>
          <input className={inputCls} value={form.requester} placeholder="Nombre" onChange={(e) => set("requester", e.target.value)} />
        </label>
        <div className="col-span-2 flex flex-wrap gap-2">
          {[
            ["costingMarker", "Marcador de costeo"],
            ["sizeMarker", "Marcador de tallas"],
            ["clientPatterns", "Patrones del cliente"],
          ].map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              onClick={() => set(k, !form[k])}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                form[k] ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-500 hover:border-slate-400"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
        <label className="block col-span-2">
          <span className="block text-xs font-medium text-slate-600 mb-1">Observaciones</span>
          <input className={inputCls} value={form.remark} onChange={(e) => set("remark", e.target.value)} />
        </label>
      </div>
    </ModalShell>
  );
}

// ==========================================================================
//  Convertir a pre-orden
// ==========================================================================
// Creates a PRE#### (status 'pending') linked to the style. It then shows up
// in the pre-order tab and on the merchant board, where "Convertir a PO"
// (/nuevo-orden-wizard?preOrderId=…) finishes the job — that flow already
// existed; this only feeds it.
export function ConvertToPreOrderModal({ order, onClose, onConverted, onError }) {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({
    customerId: order.customerId ? String(order.customerId) : "",
    pieces: order.quantity ? String(order.quantity) : "",
    targetDate: order.deliveryDate ? String(order.deliveryDate).slice(0, 10) : "",
    customerPo: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null); // { preOrderId, preOrderNo }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/customers`, { headers: authHeaders() });
        const data = await res.json();
        const list = data.customers || [];
        setCustomers(list);
        // style saved with only a customer name → preselect the matching customer
        if (!order.customerId && order.customerName) {
          const hit = list.find((c) => c.name.trim().toLowerCase() === order.customerName.trim().toLowerCase());
          if (hit) setForm((f) => ({ ...f, customerId: String(hit.id) }));
        }
      } catch {
        /* the select just stays empty; the server can still match by name */
      }
    })();
  }, [order.customerId, order.customerName]);

  const customer = useMemo(() => customers.find((c) => String(c.id) === form.customerId) || null, [customers, form.customerId]);
  const piecesOk = Number(form.pieces) > 0;

  const submit = async () => {
    if (!piecesOk) { setError("Indica las piezas comprometidas."); return; }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/style-orders/${order.id}/convert-to-pre-order`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          customerId: form.customerId ? Number(form.customerId) : null,
          clienteCode: customer?.code || null,
          pieces: Number(form.pieces),
          targetDate: form.targetDate || null,
          customerPo: form.customerPo.trim() || null,
          notes: form.notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        // already converted: treat as done so the user can jump to it
        if (res.status === 409 && data.preOrderId) {
          setDone({ preOrderId: data.preOrderId, preOrderNo: data.preOrderNo, already: true });
          return;
        }
        throw new Error(data.error || "No se pudo crear la pre-orden");
      }
      setDone({ preOrderId: data.preOrderId, preOrderNo: data.preOrderNo });
      onConverted?.(data);
    } catch (err) {
      setError(err.message);
      onError?.(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <ModalShell icon={Check} iconCls="bg-violet-600" title={done.already ? "Ya es pre-orden" : "Pre-orden creada"} subtitle={styleLabel(order)} onClose={onClose}
        footer={
          <>
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-400">
              Listo
            </button>
            <button
              onClick={() => navigate(`/nuevo-orden-wizard?preOrderId=${done.preOrderId}`)}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Convertir a PO <ArrowRight size={16} />
            </button>
          </>
        }
      >
        <div className="p-5 space-y-3">
          <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
            <div className="font-mono text-lg font-bold text-violet-800">{done.preOrderNo || `#${done.preOrderId}`}</div>
            <p className="text-sm text-violet-800/80 mt-0.5">
              {done.already
                ? "Este estilo ya tenía una pre-orden activa."
                : "Ya aparece en la pestaña de pre-órdenes y en el tablero de planeación como PRE."}
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Cuando el cliente confirme tallas, colores y POs, conviértela a PO. Puedes hacerlo ahora o después desde la pestaña de pre-órdenes.
          </p>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell
      icon={ClipboardList}
      iconCls="bg-violet-600"
      title="Convertir a pre-orden"
      subtitle={styleLabel(order)}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-400">
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={saving || !piecesOk}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {saving ? <RefreshCw size={16} className="animate-spin" /> : <ClipboardList size={16} />}
            Crear pre-orden
          </button>
        </>
      }
    >
      <div className="p-5 grid grid-cols-2 gap-4">
        <label className="block col-span-2">
          <span className="block text-xs font-medium text-slate-600 mb-1">Cliente</span>
          <select className={inputCls} value={form.customerId} onChange={(e) => set("customerId", e.target.value)}>
            <option value="">{order.customerName ? `${order.customerName} (sin vincular)` : "Elige un cliente"}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.code ? ` · ${c.code}` : ""}</option>
            ))}
          </select>
          {!form.customerId && (
            <span className="mt-1 block text-[11px] text-amber-600">Vincula el cliente para que la PO tome su código.</span>
          )}
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">Piezas comprometidas</span>
          <input type="number" min="1" className={`${inputCls} text-right`} value={form.pieces} onChange={(e) => set("pieces", e.target.value)} />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">Fecha objetivo</span>
          <input type="date" className={inputCls} value={form.targetDate} onChange={(e) => set("targetDate", e.target.value)} />
        </label>
        <label className="block col-span-2">
          <span className="block text-xs font-medium text-slate-600 mb-1">PO del cliente (si ya la tienes)</span>
          <input className={`${inputCls} font-mono`} value={form.customerPo} onChange={(e) => set("customerPo", e.target.value)} />
        </label>
        <label className="block col-span-2">
          <span className="block text-xs font-medium text-slate-600 mb-1">Notas</span>
          <textarea rows={2} className={`${inputCls} resize-y`} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </label>
        {error && (
          <div className="col-span-2 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// ==========================================================================
//  Enviar BOM a compras
// ==========================================================================
// The style's BOM sized to the selected production orders:
//   requerido = consumo por prenda × piezas del color × (1 + merma %)
// computed by the server (preview first, then send). Each send creates a
// solicitud de compra (SC####) for the purchasing department.
//   <SendToPurchasingModal styleId={id} preselectIds={[poIds]} intro="…" cancelLabel="Ahora no" onClose onSent />
const KIND_TAG = {
  fabric: { label: "Tela", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  trim: { label: "Avío", cls: "bg-violet-50 text-violet-700 border-violet-200" },
  packaging: { label: "Empaque", cls: "bg-rose-50 text-rose-700 border-rose-200" },
};
const fmtQty = (n) => (Number(n) || 0).toLocaleString("es-MX", { maximumFractionDigits: 2 });
const shortPo = (no) => String(no || "").split("-")[0];

export function SendToPurchasingModal({ styleId, preselectIds, intro, cancelLabel = "Cancelar", onClose, onSent }) {
  const [style, setStyle] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [waste, setWaste] = useState("3");
  const [neededBy, setNeededBy] = useState("");
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const reqSeq = useRef(0);

  // the style, its POs and what was already sent
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/style-orders/${styleId}`, { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || "No se pudo cargar el estilo");
        const o = data.order;
        setStyle(o);
        const sentIds = new Set((o.purchaseRequests || []).filter((p) => p.status !== "cancelled").flatMap((p) => p.workOrderIds));
        const ids = (o.workOrders || []).map((w) => w.id);
        const pre = preselectIds?.length ? preselectIds.map(Number).filter((id) => ids.includes(id)) : ids.filter((id) => !sentIds.has(id));
        setSelected(new Set(pre));
      } catch (err) {
        setLoadErr(err.message);
      }
    })();
  }, [styleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sentIn = useMemo(() => {
    const m = new Map();
    for (const p of style?.purchaseRequests || []) {
      if (p.status === "cancelled") continue;
      for (const id of p.workOrderIds) m.set(id, [...(m.get(id) || []), p.no]);
    }
    return m;
  }, [style]);

  // live preview (debounced; stale responses ignored)
  useEffect(() => {
    if (!style) return;
    if (!selected.size) { setPreview(null); return; }
    const seq = ++reqSeq.current;
    setPreviewing(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/api/style-orders/${styleId}/purchase-preview`, {
          method: "POST", headers: jsonHeaders(), body: JSON.stringify({ workOrderIds: [...selected], wastePct: Number(waste) || 0 }),
        });
        const data = await res.json();
        if (seq !== reqSeq.current) return;
        if (!res.ok || !data.success) throw new Error(data.error || "No se pudo calcular");
        setPreview(data);
        setError("");
      } catch (err) {
        if (seq === reqSeq.current) setError(err.message);
      } finally {
        if (seq === reqSeq.current) setPreviewing(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [style, selected, waste, styleId]);

  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const resend = [...selected].filter((id) => sentIn.has(id));
  const bySupplier = useMemo(() => {
    const g = new Map();
    for (const l of preview?.lines || []) {
      const k = l.supplier || "Sin proveedor";
      g.set(k, [...(g.get(k) || []), l]);
    }
    return [...g.entries()];
  }, [preview]);

  const submit = async () => {
    setSending(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/style-orders/${styleId}/send-to-purchasing`, {
        method: "POST", headers: jsonHeaders(),
        body: JSON.stringify({ workOrderIds: [...selected], wastePct: Number(waste) || 0, neededBy: neededBy || null, notes: notes.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "No se pudo enviar a compras");
      setDone(data);
      onSent?.(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const label = style ? [style.styleCode, style.header?.styleNo || style.styleNo, style.styleName].filter(Boolean).join(" · ") : "";

  if (done) {
    return (
      <ModalShell icon={Check} iconCls="bg-teal-600" title="Enviado a compras" subtitle={label} onClose={onClose}
        footer={<button onClick={onClose} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Listo</button>}>
        <div className="p-5">
          <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3">
            <div className="font-mono text-lg font-bold text-teal-800">{done.requestNo}</div>
            <p className="mt-0.5 text-sm text-teal-800/80">
              Solicitud de compra con {done.lines} {done.lines === 1 ? "material" : "materiales"} para {fmtQty(done.pieces)} prendas.
              Compras ya la ve en su bandeja.
            </p>
          </div>
        </div>
      </ModalShell>
    );
  }

  const wos = style?.workOrders || [];
  return (
    <ModalShell
      wide
      icon={ShoppingCart}
      iconCls="bg-teal-600"
      title="Enviar BOM a compras"
      subtitle={label || "Cargando…"}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-400">{cancelLabel}</button>
          <button
            onClick={submit}
            disabled={sending || previewing || !preview?.lines?.length}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {sending ? <RefreshCw size={16} className="animate-spin" /> : <ShoppingCart size={16} />}
            Enviar a compras{preview?.lines?.length ? ` (${preview.lines.length})` : ""}
          </button>
        </>
      }
    >
      <div className="space-y-5 p-5">
        {intro && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{intro}</div>}
        {loadErr && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{loadErr}</div>}
        {!style && !loadErr && <div className="flex items-center gap-2 text-sm text-slate-400"><RefreshCw size={15} className="animate-spin" /> Cargando…</div>}

        {style && (
          <>
            <div>
              <div className="mb-2 text-xs font-medium text-slate-600">Órdenes de producción a surtir</div>
              {wos.length === 0 ? (
                <p className="text-sm text-slate-400">Este estilo todavía no tiene órdenes de producción.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {wos.map((w) => {
                    const on = selected.has(w.id);
                    const prev = sentIn.get(w.id);
                    return (
                      <button key={w.id} type="button" onClick={() => toggle(w.id)} aria-pressed={on}
                        className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${on ? "border-teal-600 bg-teal-50" : "border-slate-200 bg-white hover:border-slate-400"}`}>
                        <span className="flex items-center gap-1.5">
                          <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300"}`}>{on && <Check size={11} />}</span>
                          <span className="font-mono font-semibold text-slate-800" title={w.no}>{shortPo(w.no)}</span>
                          {w.color && <span className="text-slate-500">{w.color}</span>}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-slate-500">{fmtQty(w.quantity)} pzs{prev ? ` · ya en ${prev.join(", ")}` : ""}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {resend.length > 0 && (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  {resend.map((id) => shortPo(wos.find((w) => w.id === id)?.no)).join(", ")} ya se envió a compras; se pedirá de nuevo.
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-[110px_160px_1fr]">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Merma %</span>
                <input type="number" min="0" max="100" step="0.5" className={`${inputCls} text-right`} value={waste} onChange={(e) => setWaste(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Requerido para</span>
                <input type="date" className={inputCls} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Notas para compras</span>
                <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
              </label>
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-baseline gap-2">
                <span className="text-xs font-medium text-slate-600">Materiales a comprar</span>
                {preview && (
                  <span className="text-[11px] text-slate-400">
                    {fmtQty(preview.pieces)} prendas · {Object.entries(preview.piecesByColor || {}).map(([c, q]) => `${c} ${fmtQty(q)}`).join(" · ")}
                  </span>
                )}
                {previewing && <RefreshCw size={12} className="animate-spin text-slate-400" />}
              </div>
              {!selected.size ? (
                <p className="rounded-lg border-2 border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">Selecciona al menos una orden.</p>
              ) : !preview ? null : preview.lines.length === 0 ? (
                <p className="text-sm text-slate-400">El BOM del estilo no tiene materiales.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-left text-[11px] text-slate-500">
                        <th className="px-3 py-2 font-medium">Material</th>
                        <th className="px-3 py-2 font-medium">Color</th>
                        <th className="px-3 py-2 text-right font-medium">Consumo / prenda</th>
                        <th className="px-3 py-2 text-right font-medium">Prendas</th>
                        <th className="px-3 py-2 text-right font-medium">Requerido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bySupplier.map(([sup, lines]) => (
                        <FragmentRows key={sup} sup={sup} lines={lines} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-[11px] text-slate-400">
                Requerido = consumo × prendas del color × (1 + merma). Las telas usan el consumo confirmado en la PO cuando existe (marcado «PO»); si no, el de la sala de muestras.
              </p>
            </div>

            {preview?.warnings?.length > 0 && (
              <ul className="space-y-0.5 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
                {preview.warnings.map((w, i) => <li key={i} className="text-[11px] text-amber-700">• {w}</li>)}
              </ul>
            )}
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
}

function FragmentRows({ sup, lines }) {
  return (
    <>
      <tr>
        <td colSpan={5} className="border-t border-slate-200 bg-white px-3 pb-1 pt-2.5 text-[11px] font-semibold text-slate-700">
          {sup} <span className="font-normal text-slate-400">· {lines.length} {lines.length === 1 ? "material" : "materiales"}</span>
        </td>
      </tr>
      {lines.map((l, i) => {
        const k = KIND_TAG[l.kind] || KIND_TAG.trim;
        return (
          <tr key={i} className="border-t border-slate-50">
            <td className="px-3 py-1.5">
              <span className="flex items-center gap-1.5">
                <span className={`shrink-0 rounded border px-1 text-[10px] ${k.cls}`}>{k.label}</span>
                {l.code && <span className="font-mono font-semibold text-slate-800">{l.code}</span>}
                <span className="truncate text-slate-600" title={l.name}>{l.name}</span>
              </span>
            </td>
            <td className="px-3 py-1.5 text-slate-600">{l.color || <span className="text-slate-300">{l.poColors.join(", ")}</span>}</td>
            <td className="px-3 py-1.5 text-right font-mono text-slate-600">
              {l.consumption == null ? "varía" : fmtQty(l.consumption)}
              {l.yieldSource === "po" && <span className="ml-1 rounded bg-sky-100 px-1 text-[9px] text-sky-700" title="Consumo confirmado en la PO">PO</span>}
            </td>
            <td className="px-3 py-1.5 text-right font-mono text-slate-500">{fmtQty(l.pieces)}</td>
            <td className={`px-3 py-1.5 text-right font-mono font-semibold ${l.required > 0 ? "text-slate-900" : "text-amber-600"}`}>
              {fmtQty(l.required)} <span className="font-normal text-slate-400">{l.unit}</span>
            </td>
          </tr>
        );
      })}
    </>
  );
}