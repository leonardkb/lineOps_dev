import { useEffect, useMemo, useState } from "react";
import { X, RefreshCw, Check, AlertCircle, Save } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

/*
  Edit an existing production order (PO) — fix mistakes on the flat fields.
  <WorkOrderEditModal
     order={order}
     apiOnline={bool}
     onClose={fn}
     onSaved={(updatedOrder, originalOrder) => {}}
  />

  Uses the existing  PUT /api/work-orders/:id  endpoint. Note: that endpoint
  updates the work_orders row only — it does NOT rewrite the per-color
  (work_order_colors) or size×color (work_order_lines) breakdown tables. This
  form therefore edits the header fields (customer, style, quantities, dates,
  status). Editing the color/size breakdown would need a separate endpoint.
*/

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const STATUSES = [
  { value: "pending", label: "Pendiente" },
  { value: "assigned", label: "Asignada" },
  { value: "in_progress", label: "En proceso" },
  { value: "completed", label: "Completada" },
  { value: "cancelled", label: "Cancelada" },
];

function Field({ label, children, hint }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900";
const numCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900";

const dateOnly = (v) => (v ? String(v).slice(0, 10) : "");
const num = (v) => (v === "" || v == null ? "" : String(v));

export default function WorkOrderEditModal({ order, apiOnline = true, onClose, onSaved }) {
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState(order?.customer_id ? String(order.customer_id) : "");

  const [styleCode, setStyleCode] = useState(order?.style_code || "");
  const [estilo, setEstilo] = useState(order?.estilo || "");
  const [styleDescription, setStyleDescription] = useState(order?.style_description || "");
  const [color, setColor] = useState(order?.color || "");
  const [quantity, setQuantity] = useState(num(order?.quantity));
  const [warehouseStock, setWarehouseStock] = useState(num(order?.warehouse_stock));
  const [extraQuantity, setExtraQuantity] = useState(num(order?.extra_quantity));
  const [totalToProduce, setTotalToProduce] = useState(num(order?.total_to_produce));
  const [commitmentDate, setCommitmentDate] = useState(dateOnly(order?.commitment_date));
  const [status, setStatus] = useState(order?.status || "pending");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/customers`, { headers: authHeaders() });
        if (res.ok) {
          const data = await res.json();
          setCustomers(data.customers || []);
        }
      } catch {
        /* dropdown just stays with the current customer */
      }
    })();
  }, []);

  const suggestedTotal = useMemo(() => {
    const q = parseFloat(quantity) || 0;
    const w = parseFloat(warehouseStock) || 0;
    const x = parseFloat(extraQuantity) || 0;
    return Math.max(q - w + x, 0);
  }, [quantity, warehouseStock, extraQuantity]);

  const selectedCustomer = customers.find((c) => String(c.id) === String(customerId));

  const valid = (styleDescription.trim().length > 0) && (parseFloat(quantity) > 0 || parseFloat(totalToProduce) > 0);

  const handleSave = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError("");
    try {
      const merged = {
        ...order,
        customer_id: customerId ? Number(customerId) : order?.customer_id,
        customer_name: selectedCustomer ? selectedCustomer.name : order?.customer_name,
        style_code: styleCode || null,
        estilo: estilo || null,
        style_description: styleDescription,
        color: color || null,
        quantity: parseFloat(quantity) || 0,
        warehouse_stock: warehouseStock === "" ? order?.warehouse_stock : parseFloat(warehouseStock) || 0,
        extra_quantity: extraQuantity === "" ? order?.extra_quantity : parseFloat(extraQuantity) || 0,
        total_to_produce: parseFloat(totalToProduce) || 0,
        commitment_date: commitmentDate || null,
        status,
      };

      if (!apiOnline) {
        onSaved?.(merged, order);
        return;
      }

      const body = {
        styleCode: styleCode || null,
        estilo: estilo || null,
        styleDescription,
        color: color || null,
        totalQuantity: parseFloat(quantity) || 0,
        totalToProduce: parseFloat(totalToProduce) || 0,
        commitmentDate: commitmentDate || null,
        status,
      };
      if (customerId) body.customerId = Number(customerId);
      if (warehouseStock !== "") body.warehouseStock = parseFloat(warehouseStock) || 0;
      if (extraQuantity !== "") body.extraQuantity = parseFloat(extraQuantity) || 0;

      const res = await fetch(`${API_URL}/api/work-orders/${encodeURIComponent(order.id)}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) { window.location.href = "/login"; return; }
        throw new Error(data.error || "No se pudo guardar la orden");
      }

      // Merge server row (snake_case) over our optimistic object.
      onSaved?.({ ...merged, ...(data.workOrder || {}) }, order);
    } catch (e) {
      setError(e.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  if (!order) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl z-10">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-400 mb-1">Editar orden de producción</p>
            <p className="font-mono text-sm font-bold text-slate-800">{order.work_order_no}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Cliente">
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputCls + " bg-white"}>
                {!selectedCustomer && (
                  <option value="">{order.customer_name || "Selecciona cliente…"}</option>
                )}
                {customers.map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.name}{c.code ? ` (${c.code})` : ""}</option>
                ))}
              </select>
            </Field>

            <Field label="Estado">
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls + " bg-white"}>
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>

            <Field label="Código de estilo" hint="ej. DAMPAN01">
              <input value={styleCode} onChange={(e) => setStyleCode(e.target.value.toUpperCase())} className={numCls} />
            </Field>

            <Field label="Estilo cliente" hint="ej. FN2808">
              <input value={estilo} onChange={(e) => setEstilo(e.target.value.toUpperCase())} className={numCls} />
            </Field>
          </div>

          <Field label="Descripción del estilo">
            <textarea
              value={styleDescription}
              onChange={(e) => setStyleDescription(e.target.value)}
              rows={2}
              className={inputCls + " resize-none"}
            />
          </Field>

          <Field label="Colores" hint="Resumen de colores (texto). El desglose por color/talla no se edita aquí.">
            <input value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} className={numCls} placeholder="NEG, BLA" />
          </Field>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Cantidad pedida">
              <input value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className={numCls} />
            </Field>
            <Field label="Stock almacén">
              <input value={warehouseStock} onChange={(e) => setWarehouseStock(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className={numCls} />
            </Field>
            <Field label="Extras">
              <input value={extraQuantity} onChange={(e) => setExtraQuantity(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className={numCls} />
            </Field>
            <Field label="Total a producir">
              <input value={totalToProduce} onChange={(e) => setTotalToProduce(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className={numCls} />
            </Field>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
            <span className="text-xs text-slate-500">
              Sugerido: pedida − stock + extras = <b className="font-mono text-slate-700">{suggestedTotal.toLocaleString()}</b>
            </span>
            <button
              type="button"
              onClick={() => setTotalToProduce(String(suggestedTotal))}
              className="text-xs font-semibold text-slate-900 hover:underline"
            >
              Usar sugerido
            </button>
          </div>

          <Field label="Fecha de entrega comprometida">
            <input type="date" value={commitmentDate} onChange={(e) => setCommitmentDate(e.target.value)} className={inputCls} />
          </Field>

          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700 flex items-center gap-2">
              <AlertCircle size={16} /> {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 sticky bottom-0 bg-white rounded-b-2xl flex items-center justify-between">
          <span className={`inline-flex items-center gap-1 text-xs ${valid ? "text-emerald-600" : "text-slate-400"}`}>
            {valid ? <Check size={14} /> : <AlertCircle size={14} />}
            {valid ? "Listo para guardar" : "Falta descripción o cantidad"}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">
              Cancelar
            </button>
            <button
              type="button" onClick={handleSave} disabled={!valid || saving}
              className={`inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg transition-all
                ${valid && !saving ? "bg-slate-900 text-white hover:bg-slate-700 shadow" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}
            >
              {saving ? <><RefreshCw size={16} className="animate-spin" /> Guardando…</> : <><Save size={16} /> Guardar cambios</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}