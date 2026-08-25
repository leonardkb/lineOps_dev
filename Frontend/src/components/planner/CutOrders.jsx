// components/planner/CutOrders.jsx
//
// Órdenes de corte: elegir una PO, elegir el COLOR (la cantidad a cortar se
// toma del color), tela + fecha, y guardar. Abajo se listan las órdenes de
// corte y las órdenes que aún faltan por asignar a corte (estilo planboard).
//
import { useState, useEffect, useMemo } from "react";
import { Scissors, Calendar, Trash2, AlertCircle, RefreshCw, Package } from "lucide-react";
import { format } from "date-fns";
import { API_URL } from "../../lib/masterCodeCatalog";
import { colorForWO } from "../../lib/workOrderColors";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const num = (v) => Number(v) || 0;
const totalOf = (wo) => Number(wo?.total_to_produce) || Number(wo?.quantity) || 0;
const keyOf = (woId, color) => `${woId}:${color || ""}`;

// Remaining-to-cut and over-cut (exceeds) for a cut order. Prefers per-size
// progress; falls back to the stored aggregates (null until cutting starts).
const cutBalance = (co) => {
  const sp = Array.isArray(co?.size_progress) ? co.size_progress : [];
  if (sp.length > 0) {
    let restante = 0, exceeds = 0;
    sp.forEach((r) => {
      const q = num(r.quantity);
      const cut = r.amountCut != null ? num(r.amountCut) : num(r.panels) * num(r.perPanel);
      if (cut > q) exceeds += cut - q;
      else restante += q - cut;
    });
    return { restante, exceeds };
  }
  return {
    restante: num(co?.remaining_to_cut),
    exceeds: co?.amount_cut != null ? Math.max(num(co.amount_cut) - num(co.quantity), 0) : 0,
  };
};

const STATUS = {
  pending: { label: "Pendiente", pill: "bg-yellow-100 text-yellow-700" },
  in_progress: { label: "En corte", pill: "bg-purple-100 text-purple-700" },
  completed: { label: "Cortada", pill: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelada", pill: "bg-gray-100 text-gray-500" },
};

// Prioridad del corte que fija el planner. rank ordena de más a menos urgente.
const PRIORITY = {
  urgent:       { label: "Urgente",   pill: "bg-red-100 text-red-700",       dot: "bg-red-500",    ring: "focus:ring-red-500/30 border-red-300",    rank: 0 },
  intermediate: { label: "Intermedia", pill: "bg-yellow-100 text-yellow-700", dot: "bg-yellow-500", ring: "focus:ring-yellow-500/30 border-yellow-300", rank: 1 },
  normal:       { label: "Normal",    pill: "bg-green-100 text-green-700",   dot: "bg-green-500",  ring: "focus:ring-green-500/30 border-green-300", rank: 2 },
};
const priorityMeta = (p) => PRIORITY[p] || PRIORITY.normal;

const todayStr = () => format(new Date(), "yyyy-MM-dd");

// Group a work order's lines by color → [{ color, qty, sizes, estilo }].
const colorGroups = (wo) => {
  const lines = Array.isArray(wo?.lines) ? wo.lines : [];
  if (lines.length > 0) {
    const byColor = new Map();
    lines.forEach((l) => {
      if (!l || l.color == null) return;
      const ckey = String(l.color);
      const cur = byColor.get(ckey) || { color: l.color, qty: 0, sizeMap: new Map(), estilos: new Set() };
      const q = num(l.quantity);
      cur.qty += q;
      if (l.talla != null && l.talla !== "") {
        const tkey = String(l.talla);
        cur.sizeMap.set(tkey, (cur.sizeMap.get(tkey) || 0) + q);
      }
      if (l.estilo) cur.estilos.add(l.estilo);
      byColor.set(ckey, cur);
    });
    return [...byColor.values()].map((c) => ({
      color: c.color,
      qty: c.qty,
      sizes: [...c.sizeMap.entries()].map(([talla, quantity]) => ({ talla, quantity })),
      estilo: [...c.estilos].join(", "),
    }));
  }
  const colors = Array.isArray(wo?.colors) ? wo.colors.filter((c) => c && c.color != null) : [];
  if (colors.length > 0) {
    return colors.map((c) => ({ color: c.color, qty: num(c.quantity), sizes: [], estilo: wo.estilo || "" }));
  }
  if (wo?.color) return [{ color: wo.color, qty: totalOf(wo), sizes: [], estilo: wo.estilo || "" }];
  return [];
};

// Distinct fabric {name, code} pairs for a PO. Sources, in order:
//   1) the PO header tela (representative scalar from the wizard),
//   2) EACH tela of every line — a line may carry several (l.fabrics =
//      [{name, code, yield}, ...]); this is what surfaces a 2nd código that
//      shares a name with the 1st (e.g. two "Monique" with different codes),
//   3) name-only entries from wo.fabrics, added only for names not already
//      seen with a real code, resolving the code from the fabrics catalog.
// NOTE: the /api/work-orders lines[] use camelCase keys (fabricName/
// fabricCode/fabrics); the WO header uses snake_case (fabric_name/fabric_code).
const fabricPairs = (wo, codeByName) => {
  if (!wo) return [];
  const codeFor = (name) =>
    name && codeByName ? codeByName.get(String(name).trim().toLowerCase()) || "" : "";
  const toNum = (v) => (v === undefined || v === null || v === "" || isNaN(parseFloat(v)) ? null : parseFloat(v));
  const map = new Map();
  const add = (name, code, yld) => {
    const nm = (name ?? "").toString().trim();
    const cd = ((code ?? "").toString().trim()) || codeFor(nm) || "";
    if (!nm && !cd) return;
    const k = `${nm}||${cd}`;
    const y = toNum(yld);
    if (!map.has(k)) map.set(k, { name: nm, code: cd, yield: y });
    else if (map.get(k).yield == null && y != null) map.get(k).yield = y;
  };
  // 1) header tela
  add(wo.fabric_name || wo.fabric_supplier, wo.fabric_code, wo.yield_per_piece);
  // 2) every tela of every line
  (Array.isArray(wo.lines) ? wo.lines : []).forEach((l) => {
    if (Array.isArray(l?.fabrics) && l.fabrics.length) {
      l.fabrics.forEach((f) => add(f?.name, f?.code, f?.yield ?? f?.yieldPerPiece));
    } else {
      add(l?.fabricName || l?.fabric_name || l?.fabric, l?.fabricCode || l?.fabric_code, l?.yield ?? l?.yieldPerPiece);
    }
  });
  // 3) name-only fallback, skipping names already present above
  const haveName = new Set([...map.values()].map((o) => o.name.toLowerCase()).filter(Boolean));
  (Array.isArray(wo.fabrics) ? wo.fabrics : []).forEach((n) => {
    const nm = (n ?? "").toString().trim();
    if (!nm || haveName.has(nm.toLowerCase())) return;
    add(nm, "", null);
  });
  return [...map.values()];
};

// Encode/label a fabric pair for the <select>.
const fabricKey = (name, code) => `${name || ""}||${code || ""}`;
const fabricLabel = (o) => (o.code ? `${o.code} · ${o.name}` : o.name);

export default function CutOrders() {
  const [workOrders, setWorkOrders] = useState([]);
  const [cutOrders, setCutOrders] = useState([]);
  const [fabricCatalog, setFabricCatalog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    workOrderId: "",
    color: "",
    fabric: "",
    fabricCode: "",
    // Todas las telas del corte (misma cantidad para cada una).
    // [{ name, code, yield, include }]
    fabrics: [],
    cutDate: todayStr(),
    quantity: "",
    yield: "",
    priority: "normal",
    notes: "",
  });

  useEffect(() => {
    fetchWorkOrders();
    fetchCutOrders();
    fetchFabrics();
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

  const fetchFabrics = async () => {
    try {
      const res = await fetch(`${API_URL}/api/fabrics`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setFabricCatalog(data.fabrics || []);
    } catch (err) {
      console.error("Error fetching fabrics:", err);
    }
  };

  // Fabric name (lowercased) → code, from the catalog.
  const fabricCodeByName = useMemo(() => {
    const m = new Map();
    fabricCatalog.forEach((f) => {
      if (f?.name) m.set(String(f.name).trim().toLowerCase(), f.code || "");
    });
    return m;
  }, [fabricCatalog]);

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

  // Color options for the selected PO.
  const colorOpts = useMemo(() => (selectedWO ? colorGroups(selectedWO) : []), [selectedWO]);
  const selectedColorGroup = useMemo(
    () => colorOpts.find((c) => String(c.color) === String(form.color)),
    [colorOpts, form.color]
  );

  const totalLength = useMemo(() => {
    const y = num(form.yield);
    const q = num(form.quantity);
    return y > 0 && q > 0 ? y * q : 0;
  }, [form.yield, form.quantity]);

  const fabricOptions = useMemo(() => fabricPairs(selectedWO, fabricCodeByName), [selectedWO, fabricCodeByName]);
  // ¿La orden trae más de una tela? Entonces el corte lleva TODAS (misma
  // cantidad de piezas para cada una); no se elige una sola.
  const isMultiFabric = fabricOptions.length > 1;
  const includedFabrics = useMemo(
    () => (form.fabrics || []).filter((f) => f.include),
    [form.fabrics]
  );
  // Largo total = suma de (rendimiento × cantidad) de cada tela incluida.
  const multiTotalLength = useMemo(() => {
    const q = num(form.quantity);
    if (q <= 0) return 0;
    return includedFabrics.reduce((s, f) => s + num(f.yield) * q, 0);
  }, [includedFabrics, form.quantity]);

  // Construye la lista editable de telas a partir de las opciones de la orden.
  const buildFormFabrics = (fp) =>
    fp.map((f) => ({
      name: f.name,
      code: f.code,
      yield: f.yield != null ? String(f.yield) : "",
      include: true,
    }));

  const toggleFabric = (idx) =>
    setForm((f) => ({
      ...f,
      fabrics: f.fabrics.map((x, i) => (i === idx ? { ...x, include: !x.include } : x)),
    }));
  const setFabricYield = (idx, val) =>
    setForm((f) => ({
      ...f,
      fabrics: f.fabrics.map((x, i) =>
        i === idx ? { ...x, yield: val.replace(/[^0-9.]/g, "") } : x
      ),
    }));

  // Alert the planner to any cut orders with leftover (restante) or over-cut (exceeds).
  const cutAlerts = useMemo(() => {
    let restanteCount = 0, exceedsCount = 0, restanteQty = 0, exceedsQty = 0;
    cutOrders.forEach((co) => {
      if (co.status === "cancelled") return;
      const { restante, exceeds } = cutBalance(co);
      if (restante > 0) { restanteCount++; restanteQty += restante; }
      if (exceeds > 0) { exceedsCount++; exceedsQty += exceeds; }
    });
    return { restanteCount, exceedsCount, restanteQty, exceedsQty };
  }, [cutOrders]);

  // Cut-order quantity already created for a work order + color (active only).
  const cutForColor = (woId, color) =>
    cutOrders
      .filter((co) => co.work_order_id === woId && String(co.color || "") === String(color || "") && co.status !== "cancelled")
      .reduce((s, co) => s + num(co.quantity), 0);

  const handlePickWO = (id) => {
    const wo = workOrders.find((w) => String(w.id) === String(id));
    const fp = fabricPairs(wo, fabricCodeByName);
    const rep = fp[0] || null;
    setForm((f) => ({
      ...f,
      workOrderId: id,
      color: "",
      quantity: "",
      fabric: rep?.name || "",
      fabricCode: rep?.code || "",
      fabrics: buildFormFabrics(fp),
      // Con una sola tela usamos el rendimiento compartido; con varias, cada
      // tela lleva el suyo en la lista.
      yield:
        fp.length === 1
          ? rep?.yield != null
            ? String(rep.yield)
            : wo?.yield_per_piece != null && wo.yield_per_piece !== ""
            ? String(wo.yield_per_piece)
            : ""
          : "",
    }));
    setMessage("");
    setError("");
  };

  const handlePickColor = (color) => {
    const g = colorGroups(selectedWO).find((c) => String(c.color) === String(color));
    setForm((f) => ({ ...f, color, quantity: g ? String(Math.round(g.qty)) : "" }));
  };

  // Prefill the whole form from a "por asignar" card.
  const prefillFrom = (woId, color) => {
    const wo = workOrders.find((w) => String(w.id) === String(woId));
    if (!wo) return;
    const fp = fabricPairs(wo, fabricCodeByName);
    const rep = fp[0] || null;
    const g = colorGroups(wo).find((c) => String(c.color) === String(color));
    setForm((f) => ({
      ...f,
      workOrderId: String(woId),
      color: color || "",
      quantity: g ? String(Math.round(g.qty)) : String(Math.round(totalOf(wo))),
      fabric: rep?.name || "",
      fabricCode: rep?.code || "",
      fabrics: buildFormFabrics(fp),
      yield:
        fp.length === 1
          ? rep?.yield != null
            ? String(rep.yield)
            : wo?.yield_per_piece != null && wo.yield_per_piece !== ""
            ? String(wo.yield_per_piece)
            : ""
          : "",
    }));
    setMessage("");
    setError("");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSave = async () => {
    if (!form.workOrderId) return setError("Elija una orden de trabajo (PO)");
    if (colorOpts.length > 0 && !form.color) return setError("Elija el color");
    if (!form.cutDate) return setError("Elija la fecha de corte");
    if (!form.quantity || num(form.quantity) <= 0) return setError("La cantidad debe ser mayor a 0");

    if (isMultiFabric) {
      // Varias telas: la CORTE las lleva todas (misma cantidad). Debe quedar al
      // menos una incluida y cada una con su rendimiento.
      if (includedFabrics.length === 0) return setError("Incluya al menos una tela");
      if (includedFabrics.some((f) => !(num(f.yield) > 0)))
        return setError("Cada tela incluida necesita su rendimiento (mayor a 0)");
    } else {
      if (!form.yield || num(form.yield) <= 0) return setError("Ingrese el rendimiento (mayor a 0)");
    }

    // Telas a enviar. En modo multi, las incluidas con su propio rendimiento;
    // en modo simple, la tela elegida con el rendimiento compartido.
    const fabricsPayload = isMultiFabric
      ? includedFabrics.map((f) => ({ name: f.name || null, code: f.code || null, yield: num(f.yield) || null }))
      : form.fabric || form.fabricCode
      ? [{ name: form.fabric || null, code: form.fabricCode || null, yield: num(form.yield) || null }]
      : [];
    const repFabric = fabricsPayload[0] || {};

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/api/cut-orders`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          workOrderId: form.workOrderId,
          color: form.color || null,
          sizes: selectedColorGroup ? selectedColorGroup.sizes : [],
          styleNo: selectedColorGroup?.estilo || selectedWO?.style_code || null,
          season: selectedWO?.season || null,
          fabric: repFabric.name || form.fabric || null,
          fabricCode: repFabric.code || form.fabricCode || null,
          fabrics: fabricsPayload,
          cutDate: form.cutDate,
          quantity: Number(form.quantity),
          yieldPerPiece: isMultiFabric ? (repFabric.yield ?? null) : Number(form.yield),
          priority: form.priority || "normal",
          notes: form.notes || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage("✅ Orden de corte creada");
        setForm({ workOrderId: "", color: "", fabric: "", fabricCode: "", fabrics: [], cutDate: todayStr(), quantity: "", yield: "", priority: "normal", notes: "" });
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

  const changePriority = async (id, priority) => {
    try {
      const res = await fetch(`${API_URL}/api/cut-orders/${id}/priority`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ priority }),
      });
      const data = await res.json();
      if (data.success) fetchCutOrders();
    } catch (err) {
      console.error("Error updating priority:", err);
    }
  };

  const removeCutOrder = async (id) => {
    if (!window.confirm("¿Eliminar esta orden de corte?")) return;
    try {
      const res = await fetch(`${API_URL}/api/cut-orders/${id}`, { method: "DELETE", headers: authHeaders() });
      const data = await res.json();
      if (data.success) fetchCutOrders();
    } catch (err) {
      console.error("Error deleting cut order:", err);
    }
  };

  const cutNo = (co) => `CORTE-${String(co.id).padStart(4, "0")}`;

  // Work order + color combos that still need a cut order (like the planboard pool).
  const pendingJobs = useMemo(() => {
    const jobs = [];
    workOrders.forEach((wo) => {
      if (["completed", "cancelled"].includes(wo.status)) return;
      colorGroups(wo).forEach((g) => {
        const remaining = Math.max(g.qty - cutForColor(wo.id, g.color), 0);
        if (remaining > 0) {
          jobs.push({
            key: keyOf(wo.id, g.color),
            workOrderId: wo.id,
            work_order_no: wo.work_order_no,
            customer_name: wo.customer_name,
            customer_po: wo.customer_po,
            color: g.color,
            estilo: g.estilo || wo.estilo || wo.style_code || "",
            sizes: g.sizes,
            remaining,
            commitment_date: wo.commitment_date,
          });
        }
      });
    });
    return jobs.sort((a, b) => {
      const da = a.commitment_date ? new Date(a.commitment_date).getTime() : Infinity;
      const db = b.commitment_date ? new Date(b.commitment_date).getTime() : Infinity;
      if (da !== db) return da - db;
      return String(a.work_order_no).localeCompare(String(b.work_order_no));
    });
  }, [workOrders, cutOrders]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Create form */}
        <div className="rounded-2xl border bg-white shadow-sm lg:sticky lg:top-6">
          <div className="px-5 py-4 border-b flex items-center gap-2">
            <Scissors className="w-5 h-5 text-gray-500" />
            <div>
              <h2 className="font-semibold text-gray-900">Nueva orden de corte</h2>
              <p className="text-sm text-gray-500">Elija el color; la cantidad se toma de ese color</p>
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
                  <option key={wo.id} value={wo.id}>{wo.work_order_no} · {wo.customer_name}</option>
                ))}
              </select>
              {selectedWO && (
                <p className="text-xs text-gray-500 mt-1 truncate">
                  {selectedColorGroup?.estilo ? `Estilo ${selectedColorGroup.estilo}` : (selectedWO.style_code || selectedWO.estilo || "")}
                  {selectedWO.season ? ` · ${selectedWO.season}` : ""}
                </p>
              )}
            </div>

            {/* PO fabric details (from the work order) — single tela only;
                con varias telas se muestran en la lista de abajo. */}
            {selectedWO && !isMultiFabric && (
              <div className="sm:col-span-2 grid grid-cols-3 gap-2">
                <div className="rounded-xl border bg-gray-50 border-gray-100 p-3">
                  <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">Código de tela</div>
                  <div className="text-sm font-semibold text-gray-900 font-mono truncate">{form.fabricCode || "—"}</div>
                </div>
                <div className="rounded-xl border bg-gray-50 border-gray-100 p-3">
                  <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">Tela</div>
                  <div className="text-sm font-semibold text-gray-900 truncate">{form.fabric || "—"}</div>
                </div>
                <div className="rounded-xl border bg-gray-50 border-gray-100 p-3">
                  <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">Rendimiento</div>
                  <div className="text-sm font-semibold text-gray-900">{form.yield ? `${form.yield} m/pza` : "—"}</div>
                </div>
              </div>
            )}

            {/* Color */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
              {colorOpts.length > 0 ? (
                <select
                  value={form.color}
                  onChange={(e) => handlePickColor(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                >
                  <option value="">— Elegir color —</option>
                  {colorOpts.map((c) => (
                    <option key={c.color} value={c.color}>
                      {c.color} ({Math.round(c.qty).toLocaleString()} pzas)
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={form.color}
                  onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                  placeholder="Color"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                />
              )}
              {selectedColorGroup && selectedColorGroup.sizes.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {selectedColorGroup.sizes.map((s, i) => (
                    <span key={`${s.talla}-${i}`} className="text-[10px] rounded bg-blue-50 text-blue-700 px-1.5 py-0.5">
                      {s.talla}: {Math.round(s.quantity).toLocaleString()}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Quantity (from color) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cantidad a cortar</label>
              <input
                type="number"
                value={form.quantity}
                readOnly
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 outline-none"
              />
              <p className="text-xs text-gray-400 mt-1">Del color seleccionado</p>
            </div>

            {/* Fabric */}
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {isMultiFabric ? "Telas del corte" : "Tela"}
              </label>

              {isMultiFabric ? (
                <div className="rounded-xl border border-gray-200 divide-y">
                  <div className="px-3 py-1.5 text-[11px] text-gray-500 bg-gray-50 rounded-t-xl">
                    Esta orden tiene {fabricOptions.length} telas · se cortan todas en la misma cantidad
                  </div>
                  {form.fabrics.map((f, idx) => (
                    <div key={`${f.name}||${f.code}||${idx}`} className={`flex items-center gap-2 px-3 py-2 ${f.include ? "" : "opacity-50"}`}>
                      <input
                        type="checkbox"
                        checked={f.include}
                        onChange={() => toggleFabric(idx)}
                        className="h-4 w-4 rounded border-gray-300"
                        title="Incluir esta tela en el corte"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-gray-900 truncate">{f.code || "(sin código)"}</div>
                        <div className="text-xs text-gray-500 truncate">{f.name || "—"}</div>
                      </div>
                      <label className="flex items-center gap-1">
                        <input
                          type="number" step="0.0001" min="0"
                          value={f.yield}
                          onChange={(e) => setFabricYield(idx, e.target.value)}
                          disabled={!f.include}
                          placeholder="m/pza"
                          className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-right outline-none focus:ring-2 focus:ring-gray-900/10 disabled:bg-gray-50"
                        />
                        <span className="text-[11px] text-gray-400">m/pza</span>
                      </label>
                    </div>
                  ))}
                </div>
              ) : fabricOptions.length === 1 ? (
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900">
                  {fabricLabel(fabricOptions[0])}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={form.fabricCode}
                    onChange={(e) => setForm((f) => ({ ...f, fabricCode: e.target.value }))}
                    placeholder="Código"
                    className="col-span-1 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                  />
                  <input
                    type="text"
                    value={form.fabric}
                    onChange={(e) => setForm((f) => ({ ...f, fabric: e.target.value }))}
                    placeholder="Nombre de la tela"
                    className="col-span-2 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                  />
                </div>
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

            {/* Priority */}
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Prioridad</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: "urgent",       label: "Urgente",    on: "bg-red-500 text-white border-red-500 ring-2 ring-red-500/30",       off: "bg-white text-red-700 border-red-200 hover:bg-red-50" },
                  { key: "intermediate", label: "Intermedia", on: "bg-yellow-400 text-yellow-950 border-yellow-400 ring-2 ring-yellow-500/30", off: "bg-white text-yellow-700 border-yellow-200 hover:bg-yellow-50" },
                  { key: "normal",       label: "Normal",     on: "bg-green-500 text-white border-green-500 ring-2 ring-green-500/30", off: "bg-white text-green-700 border-green-200 hover:bg-green-50" },
                ].map((opt) => {
                  const active = form.priority === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, priority: opt.key }))}
                      className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition ${active ? opt.on : opt.off}`}
                    >
                      <span className={`w-2 h-2 rounded-full ${PRIORITY[opt.key].dot} ${active ? "ring-2 ring-white/70" : ""}`} />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Yield per piece — sólo una tela; con varias, cada tela trae el suyo */}
            {!isMultiFabric && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rendimiento (por pieza)</label>
              <input
                type="number" step="0.0001" min="0"
                value={form.yield}
                onChange={(e) => setForm((f) => ({ ...f, yield: e.target.value }))}
                placeholder="Ej. 1.25"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              />
              <p className="text-xs text-gray-400 mt-1">Tela por pieza (m/pza)</p>
            </div>
            )}

            {/* Total fabric length */}
            <div className={isMultiFabric ? "sm:col-span-2" : ""}>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tela total</label>
              <input
                type="text"
                value={(() => {
                  const tl = isMultiFabric ? multiTotalLength : totalLength;
                  return tl > 0 ? `${tl.toLocaleString(undefined, { maximumFractionDigits: 2 })} m` : "—";
                })()}
                readOnly
                className="w-full rounded-xl border border-gray-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-900 outline-none"
              />
              <p className="text-xs text-gray-400 mt-1">
                {isMultiFabric ? "Suma de (rendimiento × cantidad) de todas las telas" : "Rendimiento × cantidad"}
              </p>
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

        {/* Right column: cut orders list + pending-to-cut */}
        <div className="space-y-6">
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

          {(cutAlerts.restanteCount > 0 || cutAlerts.exceedsCount > 0) && (
            <div className="px-5 py-3 border-b flex flex-wrap items-center gap-2 bg-amber-50/60">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              {cutAlerts.restanteCount > 0 && (
                <span className="text-xs font-medium text-amber-700 rounded-full bg-amber-100 px-2.5 py-1">
                  {cutAlerts.restanteCount} con restante · {Math.round(cutAlerts.restanteQty).toLocaleString()} pzas
                </span>
              )}
              {cutAlerts.exceedsCount > 0 && (
                <span className="text-xs font-medium text-red-700 rounded-full bg-red-100 px-2.5 py-1">
                  {cutAlerts.exceedsCount} con exceso · {Math.round(cutAlerts.exceedsQty).toLocaleString()} pzas
                </span>
              )}
            </div>
          )}

          {loading ? (
            <div className="p-8 text-center text-gray-500">Cargando…</div>
          ) : cutOrders.length === 0 ? (
            <div className="p-8 text-center text-gray-500">Aún no hay órdenes de corte.</div>
          ) : (
            <div className="divide-y max-h-[70vh] overflow-y-auto">
              {cutOrders.map((co) => {
                const meta = STATUS[co.status] || { label: co.status, pill: "bg-gray-100 text-gray-700" };
                const bal = cutBalance(co);
                return (
                  <div key={co.id} className="p-4 flex items-center gap-3 hover:bg-gray-50">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorForWO(keyOf(co.work_order_id, co.color)).dot}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-bold text-gray-900">{cutNo(co)}</span>
                        {co.color && <span className="text-[11px] rounded-full bg-gray-100 text-gray-700 px-2 py-0.5">{co.color}</span>}
                        <span className={`text-[11px] rounded-full px-2 py-0.5 inline-flex items-center gap-1 ${priorityMeta(co.priority).pill}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${priorityMeta(co.priority).dot}`} />
                          {priorityMeta(co.priority).label}
                        </span>
                        <span className={`text-[11px] rounded-full px-2 py-0.5 ${meta.pill}`}>{meta.label}</span>
                        {bal.exceeds > 0 && (
                          <span className="text-[11px] font-medium rounded-full bg-red-100 text-red-700 px-2 py-0.5">
                            Excede {Math.round(bal.exceeds).toLocaleString()}
                          </span>
                        )}
                        {bal.restante > 0 && (
                          <span className="text-[11px] font-medium rounded-full bg-amber-100 text-amber-700 px-2 py-0.5">
                            Restan {Math.round(bal.restante).toLocaleString()}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        {co.work_order_no} · {co.customer_name}
                        {co.customer_po ? ` · PO cliente ${co.customer_po}` : ""}
                        {(() => {
                          const fabs = Array.isArray(co.fabrics) && co.fabrics.length
                            ? co.fabrics
                            : (co.fabric || co.fabric_code ? [{ name: co.fabric, code: co.fabric_code }] : []);
                          if (!fabs.length) return "";
                          const txt = fabs
                            .map((f) => [f.code, f.name].filter(Boolean).join(" "))
                            .join(" + ");
                          return ` · ${txt}`;
                        })()}
                        {co.style_no ? ` · Estilo ${co.style_no}` : ""}{co.season ? ` · ${co.season}` : ""}
                      </p>
                      <div className="mt-1 flex items-center gap-3 text-[11px] text-gray-500 flex-wrap">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {co.cut_date ? format(new Date(`${co.cut_date}T00:00:00`), "dd/MM/yyyy") : "—"}
                        </span>
                        <span>{Math.round(num(co.quantity)).toLocaleString()} pzas</span>
                        {(() => {
                          const fabs = Array.isArray(co.fabrics) ? co.fabrics.filter((f) => f?.yield != null) : [];
                          if (fabs.length > 1) {
                            return (
                              <span>
                                Rend: {fabs.map((f) => Number(f.yield).toLocaleString(undefined, { maximumFractionDigits: 4 })).join(" / ")} m/pza
                              </span>
                            );
                          }
                          return co.yield_per_piece != null ? (
                            <span>Rend: {Number(co.yield_per_piece).toLocaleString(undefined, { maximumFractionDigits: 4 })} m/pza</span>
                          ) : null;
                        })()}
                        {co.total_length != null && (
                          <span className="font-medium text-blue-700">Tela: {Number(co.total_length).toLocaleString(undefined, { maximumFractionDigits: 2 })} m</span>
                        )}
                        {co.notes ? <span className="truncate">📝 {co.notes}</span> : null}
                      </div>
                      {Array.isArray(co.sizes) && co.sizes.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {co.sizes.map((s, i) => (
                            <span key={`${s.talla}-${i}`} className="text-[10px] rounded bg-blue-50 text-blue-700 px-1.5 py-0.5">
                              {s.talla}: {Math.round(num(s.quantity)).toLocaleString()}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <select
                      value={co.priority || "normal"}
                      onChange={(e) => changePriority(co.id, e.target.value)}
                      title="Prioridad"
                      className={`text-xs rounded-lg border px-2 py-1 outline-none font-medium ${priorityMeta(co.priority).ring}`}
                    >
                      <option value="urgent">Urgente</option>
                      <option value="intermediate">Intermedia</option>
                      <option value="normal">Normal</option>
                    </select>

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

        {/* Work orders that still need a cut order (planboard-style) — right column */}
        <div className="rounded-2xl border bg-white shadow-sm">
          <div className="px-5 py-4 border-b flex items-center gap-2">
            <Package className="w-4 h-4 text-amber-600" />
            <h3 className="font-semibold text-gray-900">Por asignar a corte ({pendingJobs.length})</h3>
          </div>
          {pendingJobs.length === 0 ? (
            <div className="p-8 text-center text-gray-500">Todas las órdenes tienen corte.</div>
          ) : (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
              {pendingJobs.map((job) => (
                <button
                  key={job.key}
                  onClick={() => prefillFrom(job.workOrderId, job.color)}
                  title="Crear orden de corte para este color"
                  className="text-left rounded-xl border border-gray-200 bg-white p-3 hover:shadow hover:border-amber-300 transition"
                >
                  <p className="font-mono text-sm font-bold text-gray-900 truncate flex items-center gap-1.5">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${colorForWO(job.key).dot}`} />
                    {job.work_order_no}
                  </p>
                  {job.color && <span className="inline-block mt-0.5 text-[11px] rounded-full bg-gray-100 text-gray-700 px-2 py-0.5">{job.color}</span>}
                  {job.sizes.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {job.sizes.map((s, i) => (
                        <span key={`${s.talla}-${i}`} className="text-[10px] rounded bg-blue-50 text-blue-700 px-1.5 py-0.5">
                          {s.talla}: {Math.round(s.quantity).toLocaleString()}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 truncate mt-0.5">
                    {job.customer_name}{job.customer_po ? ` · PO cliente ${job.customer_po}` : ""}{job.estilo ? ` · Estilo ${job.estilo}` : ""}
                  </p>
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-amber-700">{Math.round(job.remaining).toLocaleString()} pzas</span>
                    {job.commitment_date && <span className="text-gray-400">{format(new Date(`${String(job.commitment_date).slice(0,10)}T00:00:00`), "dd/MM")}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}