// components/planner/CutOrders.jsx
//
// Órdenes de corte (simple): elegir una PO, la cantidad se toma de la PO,
// se elige tela + fecha de corte, y se guarda. Lista las órdenes existentes.
//
import { useState, useEffect, useMemo } from "react";
import { Scissors, Calendar, Trash2, AlertCircle, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { API_URL } from "../../lib/masterCodeCatalog";
import { colorForWO } from "../../lib/workOrderColors";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const totalOf = (wo) => Number(wo?.total_to_produce) || Number(wo?.quantity) || 0;

const STATUS = {
  pending: { label: "Pendiente", pill: "bg-yellow-100 text-yellow-700" },
  in_progress: { label: "En corte", pill: "bg-purple-100 text-purple-700" },
  completed: { label: "Cortada", pill: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelada", pill: "bg-gray-100 text-gray-500" },
};

const todayStr = () => format(new Date(), "yyyy-MM-dd");

export default function CutOrders() {
  const [workOrders, setWorkOrders] = useState([]);
  const [cutOrders, setCutOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    workOrderId: "",
    fabric: "",
    cutDate: todayStr(),
    quantity: "",
    yield: "",
    notes: "",
  });

  useEffect(() => {
    fetchWorkOrders();
    fetchCutOrders();
  }, []);

  const fetchWorkOrders = async () => {
    try {
      const res = await fetch(`${API_URL}/api/work-orders`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setWorkOrders(data.workOrders || []);
    } catch (err) {
      console.error("Error fetching work orders:", err);
    }
  };

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

  const selectedWO = useMemo(
    () => workOrders.find((w) => String(w.id) === String(form.workOrderId)),
    [workOrders, form.workOrderId]
  );

  // Total fabric length = yield (per piece) × quantity to cut.
  const totalLength = useMemo(() => {
    const y = Number(form.yield) || 0;
    const q = Number(form.quantity) || 0;
    return y > 0 && q > 0 ? y * q : 0;
  }, [form.yield, form.quantity]);

  // Fabric options come from the PO (fabrics[] or fabric_supplier).
  const fabricOptions = useMemo(() => {
    if (!selectedWO) return [];
    const list = Array.isArray(selectedWO.fabrics) ? selectedWO.fabrics.filter(Boolean) : [];
    if (list.length === 0 && selectedWO.fabric_supplier) list.push(selectedWO.fabric_supplier);
    return [...new Set(list)];
  }, [selectedWO]);

  const handlePickWO = (id) => {
    const wo = workOrders.find((w) => String(w.id) === String(id));
    const fabrics = wo && Array.isArray(wo.fabrics) ? wo.fabrics.filter(Boolean) : [];
    setForm((f) => ({
      ...f,
      workOrderId: id,
      quantity: wo ? String(Math.round(totalOf(wo))) : "",
      fabric: fabrics[0] || wo?.fabric_supplier || "",
      yield: "",
    }));
    setMessage("");
    setError("");
  };

  const handleSave = async () => {
    if (!form.workOrderId) return setError("Elija una orden de trabajo (PO)");
    if (!form.cutDate) return setError("Elija la fecha de corte");
    if (!form.quantity || Number(form.quantity) <= 0) return setError("La cantidad debe ser mayor a 0");
    if (!form.yield || Number(form.yield) <= 0) return setError("Ingrese el rendimiento (mayor a 0)");

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/api/cut-orders`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          workOrderId: form.workOrderId,
          fabric: form.fabric || null,
          cutDate: form.cutDate,
          quantity: Number(form.quantity),
          yieldPerPiece: Number(form.yield),
          notes: form.notes || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage("✅ Orden de corte creada");
        setForm({ workOrderId: "", fabric: "", cutDate: todayStr(), quantity: "", yield: "", notes: "" });
        await fetchCutOrders();
      } else {
        setError(data.error || "No se pudo crear la orden de corte");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (id, status) => {
    try {
      const res = await fetch(`${API_URL}/api/cut-orders/${id}/status`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (data.success) fetchCutOrders();
    } catch (err) {
      console.error("Error updating status:", err);
    }
  };

  const removeCutOrder = async (id) => {
    if (!window.confirm("¿Eliminar esta orden de corte?")) return;
    try {
      const res = await fetch(`${API_URL}/api/cut-orders/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.success) fetchCutOrders();
    } catch (err) {
      console.error("Error deleting cut order:", err);
    }
  };

  const cutNo = (co) => `CORTE-${String(co.id).padStart(4, "0")}`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {/* Create form */}
      <div className="rounded-2xl border bg-white shadow-sm lg:sticky lg:top-6">
        <div className="px-5 py-4 border-b flex items-center gap-2">
          <Scissors className="w-5 h-5 text-gray-500" />
          <div>
            <h2 className="font-semibold text-gray-900">Nueva orden de corte</h2>
            <p className="text-sm text-gray-500">
              La cantidad se toma automáticamente del total de la PO
            </p>
          </div>
        </div>

        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* PO */}
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Orden de trabajo (PO)</label>
            <select
              value={form.workOrderId}
              onChange={(e) => handlePickWO(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
            >
              <option value="">— Elegir PO —</option>
              {workOrders.map((wo) => (
                <option key={wo.id} value={wo.id}>
                  {wo.work_order_no} · {wo.customer_name}
                </option>
              ))}
            </select>
            {selectedWO && (
              <p className="text-xs text-gray-500 mt-1 truncate">
                {selectedWO.style_code || selectedWO.estilo || ""}
                {selectedWO.color ? ` · Color: ${selectedWO.color}` : ""}
              </p>
            )}
          </div>

          {/* Color (from PO) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
            <input
              type="text"
              value={selectedWO?.color || ""}
              readOnly
              placeholder="—"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 outline-none"
            />
            <p className="text-xs text-gray-400 mt-1">Desde la PO</p>
          </div>

          {/* Fabric */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tela</label>
            {fabricOptions.length > 0 ? (
              <select
                value={form.fabric}
                onChange={(e) => setForm((f) => ({ ...f, fabric: e.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              >
                {fabricOptions.map((fb) => (
                  <option key={fb} value={fb}>{fb}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={form.fabric}
                onChange={(e) => setForm((f) => ({ ...f, fabric: e.target.value }))}
                placeholder="Nombre de la tela"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            )}
          </div>

          {/* Cut date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de corte</label>
            <input
              type="date"
              value={form.cutDate}
              onChange={(e) => setForm((f) => ({ ...f, cutDate: e.target.value }))}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>

          {/* Quantity (auto from PO) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cantidad a cortar</label>
            <input
              type="number"
              value={form.quantity}
              readOnly
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 outline-none"
            />
            <p className="text-xs text-gray-400 mt-1">Total de la PO</p>
          </div>

          {/* Yield per piece */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rendimiento (por pieza)</label>
            <input
              type="number"
              step="0.0001"
              min="0"
              value={form.yield}
              onChange={(e) => setForm((f) => ({ ...f, yield: e.target.value }))}
              placeholder="Ej. 1.25"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
            />
            <p className="text-xs text-gray-400 mt-1">Tela por pieza (m/pza)</p>
          </div>

          {/* Total fabric length (computed) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tela total</label>
            <input
              type="text"
              value={totalLength > 0 ? `${totalLength.toLocaleString(undefined, { maximumFractionDigits: 2 })} m` : "—"}
              readOnly
              className="w-full rounded-xl border border-gray-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-900 outline-none"
            />
            <p className="text-xs text-gray-400 mt-1">Rendimiento × cantidad</p>
          </div>

          {/* Notes */}
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notas (opcional)</label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Instrucciones para corte…"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>
        </div>

        <div className="px-5 pb-5">
          {error && (
            <div className="mb-3 bg-red-50 text-red-700 p-3 rounded-xl text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}
          {message && <div className="mb-3 bg-green-50 text-green-700 p-3 rounded-xl text-sm">{message}</div>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Crear orden de corte"}
          </button>
        </div>
      </div>

      {/* Existing cut orders */}
      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">Órdenes de corte</h3>
            <p className="text-sm text-gray-500">{cutOrders.length} registradas</p>
          </div>
          <button
            onClick={fetchCutOrders}
            className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-500">Cargando…</div>
        ) : cutOrders.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Aún no hay órdenes de corte.</div>
        ) : (
          <div className="divide-y max-h-[70vh] overflow-y-auto">
            {cutOrders.map((co) => {
              const meta = STATUS[co.status] || { label: co.status, pill: "bg-gray-100 text-gray-700" };
              return (
                <div key={co.id} className="p-4 flex items-center gap-3 hover:bg-gray-50">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorForWO(co.work_order_id).dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold text-gray-900">{cutNo(co)}</span>
                      <span className={`text-[11px] rounded-full px-2 py-0.5 ${meta.pill}`}>{meta.label}</span>
                    </div>
                    <p className="text-xs text-gray-500 truncate">
                      {co.work_order_no} · {co.customer_name}
                      {co.color ? ` · ${co.color}` : ""}
                      {co.fabric ? ` · ${co.fabric}` : ""}
                    </p>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-gray-500 flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {co.cut_date ? format(new Date(`${co.cut_date}T00:00:00`), "dd/MM/yyyy") : "—"}
                      </span>
                      <span>{Math.round(co.quantity).toLocaleString()} pzas</span>
                      {co.yield_per_piece != null && (
                        <span>Rend: {Number(co.yield_per_piece).toLocaleString(undefined, { maximumFractionDigits: 4 })} m/pza</span>
                      )}
                      {co.total_length != null && (
                        <span className="font-medium text-blue-700">
                          Tela: {Number(co.total_length).toLocaleString(undefined, { maximumFractionDigits: 2 })} m
                        </span>
                      )}
                      {co.notes ? <span className="truncate">📝 {co.notes}</span> : null}
                    </div>
                  </div>

                  <select
                    value={co.status}
                    onChange={(e) => changeStatus(co.id, e.target.value)}
                    className="text-xs rounded-lg border border-gray-200 px-2 py-1 outline-none"
                  >
                    <option value="pending">Pendiente</option>
                    <option value="in_progress">En corte</option>
                    <option value="completed">Cortada</option>
                    <option value="cancelled">Cancelada</option>
                  </select>

                  <button
                    onClick={() => removeCutOrder(co.id)}
                    className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                    title="Eliminar"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}