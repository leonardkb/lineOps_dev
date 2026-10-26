// components/planner/CutOrders.jsx
//
// Órdenes de corte — pantalla de 3 paneles, sin scroll de página:
//   1) POR ASIGNAR: orden+color que aún tienen piezas sin corte (cola).
//   2) NUEVA ORDEN DE CORTE: se llena al tocar una tarjeta de la cola. La
//      cantidad propuesta es lo RESTANTE del color (nunca el total otra vez).
//   3) ÓRDENES DE CORTE: estado de cada corte con barra de avance.
// Arriba, tarjetas de estado (cuántos cortes y piezas hay en cada etapa) que
// también filtran la lista.
//
// ANTI-DUPLICADO: la cola resta lo ya asignado; el formulario avisa los cortes
// que ya existen para esa orden+color y no deja pasar de lo restante; el botón
// no puede mandar dos veces; y el servidor (cut-orders.js) lo vuelve a revisar
// dentro de una transacción con candado (409 si se duplica).
//
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Scissors, Calendar, Trash2, AlertCircle, RefreshCw, Package, Search, X, CheckCircle2, ArrowLeft, Bell, Loader2, ChevronRight, Layers, Circle } from "lucide-react";
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
  awaiting_verification: { label: "Por verificar", pill: "bg-blue-100 text-blue-700" },
  completed: { label: "Cortada", pill: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelada", pill: "bg-gray-100 text-gray-500" },
};

// Pestañas para filtrar las órdenes de corte por estado.
const STATUS_TABS = [
  { key: "all", label: "Todas" },
  { key: "pending", label: "Pendiente" },
  { key: "in_progress", label: "En corte" },
  { key: "awaiting_verification", label: "Por verificar" },
  { key: "completed", label: "Cortadas" },
  { key: "cancelled", label: "Canceladas" },
];

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

// Piezas ya cortadas de un corte (por talla si existe; si no, el agregado).
const cutDoneOf = (co) => {
  const sp = Array.isArray(co?.size_progress) ? co.size_progress : [];
  if (sp.length > 0) {
    return sp.reduce((s, r) => s + (r.amountCut != null ? num(r.amountCut) : num(r.panels) * num(r.perPanel)), 0);
  }
  if (co?.amount_cut != null) return num(co.amount_cut);
  if (co?.remaining_to_cut != null) return Math.max(num(co.quantity) - num(co.remaining_to_cut), 0);
  return 0;
};

// Barra de estado: tarjetas que resumen y a la vez filtran la lista.
const STATUS_CARDS = [
  { key: "pending",               label: "Pendiente",     tone: "border-yellow-200 bg-yellow-50 text-yellow-800", dot: "bg-yellow-500" },
  { key: "in_progress",           label: "En corte",      tone: "border-purple-200 bg-purple-50 text-purple-800", dot: "bg-purple-500" },
  { key: "awaiting_verification", label: "Por verificar", tone: "border-blue-200 bg-blue-50 text-blue-800",       dot: "bg-blue-500" },
  { key: "completed",             label: "Cortadas",      tone: "border-green-200 bg-green-50 text-green-800",    dot: "bg-green-500" },
  { key: "cancelled",             label: "Canceladas",    tone: "border-gray-200 bg-gray-50 text-gray-600",       dot: "bg-gray-400" },
];

const fmtN = (v) => Math.round(num(v)).toLocaleString();
const fmtD = (ymd) => (ymd ? format(new Date(`${String(ymd).slice(0, 10)}T00:00:00`), "dd/MM/yyyy") : "—");

const EMPTY_FORM = {
  workOrderId: "", color: "", fabric: "", fabricCode: "", fabrics: [],
  cutDate: todayStr(), quantity: "", yield: "", priority: "normal", notes: "",
};

export default function CutOrders() {
  const [workOrders, setWorkOrders] = useState([]);
  const [cutOrders, setCutOrders] = useState([]);
  const [fabricCatalog, setFabricCatalog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false); // candado contra doble clic (el estado tarda un render)
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [cutFilter, setCutFilter] = useState("");
  const [pendingFilter, setPendingFilter] = useState("");
  const [statusTab, setStatusTab] = useState("active"); // active | all | <status>
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedKey, setSelectedKey] = useState(null); // tarjeta elegida en la cola
  // Solicitudes del área de corte (cut-order-requests.js): "necesito esta orden".
  const [requests, setRequests] = useState([]);
  const [reqOpen, setReqOpen] = useState(true); // panel de solicitudes desplegado
  const [detailCut, setDetailCut] = useState(null); // corte abierto en el panel lateral
  const closeDetail = useCallback(() => setDetailCut(null), []);
  const seenReqIdsRef = useRef(null);          // ids pendientes ya conocidos (para avisar las nuevas)

  useEffect(() => {
    fetchWorkOrders();
    fetchCutOrders();
    fetchFabrics();
    fetchRequests();
    // Revisa solicitudes nuevas cada 60 s mientras la pestaña está visible.
    const t = setInterval(() => { if (document.visibilityState !== "hidden") fetchRequests(); }, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchRequests = async () => {
    try {
      const res = await fetch(`${API_URL}/api/cut-order-requests?scope=open`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!data.success) return; // sin el módulo en el servidor, simplemente no hay solicitudes
      const list = data.requests || [];
      const pendingIds = list.filter((r) => r.status === "pending").map((r) => r.id);
      if (seenReqIdsRef.current) {
        const fresh = list.filter((r) => r.status === "pending" && !seenReqIdsRef.current.has(r.id));
        if (fresh.length === 1) {
          const r = fresh[0];
          setMessage(`🔔 Corte solicita ${r.work_order_no}${r.color ? ` · ${r.color}` : ""}${r.requested_by_name ? ` (${r.requested_by_name})` : ""}.`);
          setReqOpen(true);
        } else if (fresh.length > 1) {
          setMessage(`🔔 ${fresh.length} solicitudes nuevas de corte.`);
          setReqOpen(true);
        }
      }
      seenReqIdsRef.current = new Set(pendingIds);
      setRequests(list);
    } catch { /* se conserva lo anterior */ }
  };

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

  const fabricCodeByName = useMemo(() => {
    const m = new Map();
    fabricCatalog.forEach((f) => {
      if (f?.name) m.set(String(f.name).trim().toLowerCase(), f.code || "");
    });
    return m;
  }, [fabricCatalog]);

  const fetchCutOrders = async () => {
    setLoading(true);
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

  const cutNo = (co) => `CORTE-${String(co.id).padStart(4, "0")}`;
  const sameColor = (a, b) => String(a || "").trim().toUpperCase() === String(b || "").trim().toUpperCase();

  const reqKey = (woId, color) => `${woId}:${String(color || "").trim().toUpperCase()}`;
  const pendingRequests = useMemo(() => requests.filter((r) => r.status === "pending"), [requests]);
  const reqByKey = useMemo(() => {
    const m = new Map();
    pendingRequests.forEach((r) => m.set(reqKey(r.work_order_id, r.color), r));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRequests]);
  const URG_RANK = { urgent: 0, intermediate: 1, normal: 2 };

  // Cortes ACTIVOS (no cancelados) de una orden + color.
  const activeCutsFor = (woId, color) =>
    cutOrders.filter((co) => String(co.work_order_id) === String(woId) && sameColor(co.color, color) && co.status !== "cancelled");

  // ---- cola "Por asignar" ------------------------------------------------
  // Una tarjeta por orden+color con piezas SIN corte. Lo ya asignado se resta,
  // así una orden con corte completo desaparece de la cola.
  const pendingJobs = useMemo(() => {
    const jobs = [];
    workOrders.forEach((wo) => {
      if (["completed", "cancelled"].includes(wo.status)) return;
      let groups = colorGroups(wo);
      if (groups.length === 0) groups = [{ color: "", qty: totalOf(wo), sizes: [], estilo: wo.estilo || "" }];
      groups.forEach((g) => {
        const cuts = activeCutsFor(wo.id, g.color);
        const already = cuts.reduce((s, co) => s + num(co.quantity), 0);
        const remaining = Math.max(g.qty - already, 0);
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
            colorQty: g.qty,
            already,
            remaining,
            commitment_date: wo.commitment_date,
            request: reqByKey.get(reqKey(wo.id, g.color)) || null, // corte la pidió
          });
        }
      });
    });
    return jobs.sort((a, b) => {
      // Lo que corte pidió va primero (urgente → normal, luego la más antigua).
      if (!!a.request !== !!b.request) return a.request ? -1 : 1;
      if (a.request && b.request) {
        const ur = (URG_RANK[a.request.urgency] ?? 2) - (URG_RANK[b.request.urgency] ?? 2);
        if (ur) return ur;
        return String(a.request.created_at).localeCompare(String(b.request.created_at));
      }
      const da = a.commitment_date ? new Date(a.commitment_date).getTime() : Infinity;
      const db = b.commitment_date ? new Date(b.commitment_date).getTime() : Infinity;
      if (da !== db) return da - db;
      return String(a.work_order_no).localeCompare(String(b.work_order_no));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrders, cutOrders, reqByKey]);

  const filteredPendingJobs = useMemo(() => {
    const q = pendingFilter.trim().toLowerCase();
    if (!q) return pendingJobs;
    return pendingJobs.filter((job) =>
      `${job.work_order_no || ""} ${job.customer_name || ""} ${job.customer_po || ""} ${job.color || ""} ${job.estilo || ""}`
        .toLowerCase().includes(q)
    );
  }, [pendingJobs, pendingFilter]);

  // ---- formulario --------------------------------------------------------
  const selectedWO = useMemo(
    () => workOrders.find((w) => String(w.id) === String(form.workOrderId)),
    [workOrders, form.workOrderId]
  );
  const selectedColorGroup = useMemo(
    () => (selectedWO ? colorGroups(selectedWO).find((c) => sameColor(c.color, form.color)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedWO, form.color]
  );
  // Piezas del color, ya en corte y restantes (siempre recalculado en vivo).
  const colorTotal = selectedColorGroup ? selectedColorGroup.qty : selectedWO ? totalOf(selectedWO) : 0;
  const existingCuts = useMemo(
    () => (form.workOrderId ? activeCutsFor(form.workOrderId, form.color) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cutOrders, form.workOrderId, form.color]
  );
  const alreadyAssigned = existingCuts.reduce((s, co) => s + num(co.quantity), 0);
  const remainingForColor = Math.max(colorTotal - alreadyAssigned, 0);
  const overBy = Math.max(num(form.quantity) - remainingForColor, 0);

  const fabricOptions = useMemo(() => fabricPairs(selectedWO, fabricCodeByName), [selectedWO, fabricCodeByName]);
  const isMultiFabric = fabricOptions.length > 1;
  const includedFabrics = useMemo(() => (form.fabrics || []).filter((f) => f.include), [form.fabrics]);
  const totalLength = useMemo(() => {
    const q = num(form.quantity);
    if (q <= 0) return 0;
    if (isMultiFabric) return includedFabrics.reduce((s, f) => s + num(f.yield) * q, 0);
    return num(form.yield) > 0 ? num(form.yield) * q : 0;
  }, [isMultiFabric, includedFabrics, form.yield, form.quantity]);

  const buildFormFabrics = (fp) =>
    fp.map((f) => ({ name: f.name, code: f.code, yield: f.yield != null ? String(f.yield) : "", include: true }));
  const toggleFabric = (idx) =>
    setForm((f) => ({ ...f, fabrics: f.fabrics.map((x, i) => (i === idx ? { ...x, include: !x.include } : x)) }));
  const setFabricYield = (idx, val) =>
    setForm((f) => ({ ...f, fabrics: f.fabrics.map((x, i) => (i === idx ? { ...x, yield: val.replace(/[^0-9.]/g, "") } : x)) }));

  // Tocar una tarjeta de la cola llena el formulario con lo RESTANTE.
  const selectJob = (job) => {
    const wo = workOrders.find((w) => String(w.id) === String(job.workOrderId));
    if (!wo) return;
    const fp = fabricPairs(wo, fabricCodeByName);
    const rep = fp[0] || null;
    setSelectedKey(job.key);
    const rq = job.request;
    const rqQty = rq && Number(rq.quantity) > 0 ? Math.min(Number(rq.quantity), job.remaining) : job.remaining;
    setForm((f) => ({
      ...EMPTY_FORM,
      cutDate: f.cutDate || todayStr(),
      // Con solicitud: la urgencia que pidió corte y la cantidad que pidió.
      priority: rq ? (rq.urgency || "normal") : f.priority || "normal",
      notes: rq?.note ? `Solicitud de corte: ${rq.note}` : "",
      workOrderId: String(job.workOrderId),
      color: job.color || "",
      quantity: String(Math.round(rqQty)),
      fabric: rep?.name || "",
      fabricCode: rep?.code || "",
      fabrics: buildFormFabrics(fp),
      yield:
        fp.length === 1
          ? rep?.yield != null ? String(rep.yield)
          : wo?.yield_per_piece != null && wo.yield_per_piece !== "" ? String(wo.yield_per_piece) : ""
          : "",
    }));
    setMessage("");
    setError("");
  };

  const clearForm = () => {
    setForm((f) => ({ ...EMPTY_FORM, cutDate: f.cutDate, priority: "normal" }));
    setSelectedKey(null);
    setError("");
  };

  const handleSave = async () => {
    if (savingRef.current) return; // ya hay un guardado en curso
    if (!form.workOrderId) return setError("Elija una orden de la lista «Por asignar»");
    if (!form.cutDate) return setError("Elija la fecha de corte");
    const qty = num(form.quantity);
    if (qty <= 0) return setError("La cantidad debe ser mayor a 0");
    if (isMultiFabric) {
      if (includedFabrics.length === 0) return setError("Incluya al menos una tela");
      if (includedFabrics.some((f) => !(num(f.yield) > 0))) return setError("Cada tela incluida necesita su rendimiento (mayor a 0)");
    } else if (!(num(form.yield) > 0)) {
      return setError("Ingrese el rendimiento (mayor a 0)");
    }

    // Más de lo restante = duplicado, salvo que el planner confirme un recorte.
    let allowExtra = false;
    if (overBy > 0) {
      const ok = window.confirm(
        `Este color ya tiene ${fmtN(alreadyAssigned)} de ${fmtN(colorTotal)} pzas en corte ` +
        `(${existingCuts.map(cutNo).join(", ") || "—"}).\n\n` +
        `Va a asignar ${fmtN(qty)} pzas, ${fmtN(overBy)} más de lo restante.\n\n` +
        `¿Es un RECORTE adicional a propósito?`
      );
      if (!ok) return;
      allowExtra = true;
    }

    const fabricsPayload = isMultiFabric
      ? includedFabrics.map((f) => ({ name: f.name || null, code: f.code || null, yield: num(f.yield) || null }))
      : form.fabric || form.fabricCode
      ? [{ name: form.fabric || null, code: form.fabricCode || null, yield: num(form.yield) || null }]
      : [];
    const repFabric = fabricsPayload[0] || {};

    savingRef.current = true;
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
          quantity: qty,
          yieldPerPiece: isMultiFabric ? (repFabric.yield ?? null) : Number(form.yield),
          priority: form.priority || "normal",
          notes: form.notes || null,
          allowExtra,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        setMessage(`✅ ${cutNo(data.cutOrder)} creada · ${selectedWO?.work_order_no || ""}${form.color ? ` · ${form.color}` : ""} · ${fmtN(qty)} pzas`);
        if (data.fulfilledRequests > 0) {
          setMessage((m) => `${m} · solicitud de corte atendida`);
        }
        clearForm();
        await Promise.all([fetchCutOrders(), fetchRequests()]);
      } else {
        // 409 = el servidor detectó duplicado (p.ej. otro planner lo creó primero).
        setError(data.error || "No se pudo crear la orden de corte");
        if (res.status === 409) await fetchCutOrders();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const changeStatus = async (id, status) => {
    try {
      const res = await fetch(`${API_URL}/api/cut-orders/${id}/status`, {
        method: "PATCH", headers: authHeaders(), body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) fetchCutOrders();
      else setError(data.error || "No se pudo cambiar el estado");
    } catch (err) {
      setError(err.message);
    }
  };

  const changePriority = async (id, priority) => {
    try {
      const res = await fetch(`${API_URL}/api/cut-orders/${id}/priority`, {
        method: "PATCH", headers: authHeaders(), body: JSON.stringify({ priority }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) fetchCutOrders();
      else setError(data.error || "No se pudo cambiar la prioridad");
    } catch (err) {
      setError(err.message);
    }
  };

  const removeCutOrder = async (co) => {
    if (!window.confirm(`¿Eliminar ${cutNo(co)}? Sus piezas vuelven a «Por asignar».`)) return;
    try {
      const res = await fetch(`${API_URL}/api/cut-orders/${co.id}`, { method: "DELETE", headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (data.success) fetchCutOrders();
      else setError(data.error || "No se pudo eliminar");
    } catch (err) {
      setError(err.message);
    }
  };

  // Rechazar una solicitud de corte (pide el motivo; corte lo ve).
  const rejectRequest = async (r) => {
    const why = window.prompt(`Motivo para rechazar la solicitud de ${r.work_order_no}${r.color ? ` · ${r.color}` : ""}:`, "");
    if (why == null) return;
    if (!why.trim()) return setError("Indique el motivo del rechazo.");
    try {
      const res = await fetch(`${API_URL}/api/cut-order-requests/${r.id}/reject`, {
        method: "PATCH", headers: authHeaders(), body: JSON.stringify({ note: why.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) setError(data.error || "No se pudo rechazar");
      fetchRequests();
    } catch (err) {
      setError(err.message);
    }
  };
  const assignRequest = (r) => {
    const job = pendingJobs.find((j) => j.request && j.request.id === r.id);
    if (job) selectJob(job);
  };
  const selectedJob = useMemo(() => pendingJobs.find((j) => j.key === selectedKey) || null, [pendingJobs, selectedKey]);

  // ---- estado de los cortes ---------------------------------------------
  const statusSummary = useMemo(() => {
    const s = {};
    STATUS_CARDS.forEach((c) => { s[c.key] = { n: 0, pcs: 0 }; });
    cutOrders.forEach((co) => {
      if (!s[co.status]) return;
      s[co.status].n += 1;
      s[co.status].pcs += num(co.quantity);
    });
    return s;
  }, [cutOrders]);
  const pendingPcs = useMemo(() => pendingJobs.reduce((s, j) => s + j.remaining, 0), [pendingJobs]);
  const activeCount = cutOrders.filter((co) => !["completed", "cancelled"].includes(co.status)).length;

  const cutAlerts = useMemo(() => {
    let restanteCount = 0, exceedsCount = 0;
    cutOrders.forEach((co) => {
      if (co.status === "cancelled" || co.status === "pending") return;
      const { restante, exceeds } = cutBalance(co);
      if (restante > 0 && co.status === "awaiting_verification") restanteCount++;
      if (exceeds > 0) exceedsCount++;
    });
    return { restanteCount, exceedsCount };
  }, [cutOrders]);

  const filteredCutOrders = useMemo(() => {
    const q = cutFilter.trim().toLowerCase();
    const list = cutOrders.filter((co) => {
      if (statusTab === "active" && ["completed", "cancelled"].includes(co.status)) return false;
      if (statusTab !== "active" && statusTab !== "all" && co.status !== statusTab) return false;
      if (!q) return true;
      return `${cutNo(co)} ${co.work_order_no || ""} ${co.customer_name || ""} ${co.customer_po || ""} ${co.color || ""} ${co.style_no || ""} ${co.season || ""}`
        .toLowerCase().includes(q);
    });
    // Activos: más urgentes primero y luego por fecha de corte.
    if (statusTab === "active") {
      list.sort((a, b) =>
        priorityMeta(a.priority).rank - priorityMeta(b.priority).rank ||
        String(a.cut_date || "").localeCompare(String(b.cut_date || "")));
    }
    return list;
  }, [cutOrders, cutFilter, statusTab]);

  const statusTabLabel =
    statusTab === "active" ? "Activas" : statusTab === "all" ? "Todas" : (STATUS[statusTab] || {}).label || statusTab;

  // ------------------------------------------------------------------------
  const panel = "rounded-2xl border bg-white shadow-sm flex flex-col min-h-0";
  const input = "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10";

  return (
    <div className="flex flex-col gap-3">
      {/* ── Estado de los cortes (también filtra la lista) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
            <Package className="w-3.5 h-3.5" /> Por asignar
          </div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-amber-900 tabular-nums">{pendingJobs.length}</span>
            <span className="text-[11px] text-amber-700 tabular-nums">{fmtN(pendingPcs)} pzas</span>
            {pendingRequests.length > 0 && (
              <span className="ml-auto text-[10px] font-bold rounded-full bg-violet-600 text-white px-1.5 leading-4" title="Solicitudes de corte pendientes">
                {pendingRequests.length} pedidas
              </span>
            )}
          </div>
        </div>
        {STATUS_CARDS.map((c) => {
          const active = statusTab === c.key;
          const v = statusSummary[c.key] || { n: 0, pcs: 0 };
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setStatusTab(active ? "active" : c.key)}
              title={active ? "Quitar filtro" : `Ver solo «${c.label}»`}
              className={`text-left rounded-xl border px-3 py-2 transition ${c.tone} ${active ? "ring-2 ring-gray-900/70" : "hover:shadow-sm"}`}
            >
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
                <span className={`w-2 h-2 rounded-full ${c.dot}`} /> {c.label}
              </div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-xl font-bold tabular-nums">{v.n}</span>
                <span className="text-[11px] opacity-80 tabular-nums">{fmtN(v.pcs)} pzas</span>
              </div>
            </button>
          );
        })}
      </div>

      {(error || message) && (
        <div className={`rounded-xl px-3 py-2 text-sm flex items-center gap-2 ${error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
          {error ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
          <span className="flex-1">{error || message}</span>
          <button onClick={() => { setError(""); setMessage(""); }} className="p-0.5 opacity-60 hover:opacity-100" aria-label="Cerrar"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* ── 3 paneles: cada uno hace scroll por dentro, la página no ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 lg:h-[calc(100vh-14rem)] lg:min-h-[520px]">
        {/* 1) POR ASIGNAR */}
        <section className={`${panel} lg:col-span-3 max-h-[70vh] lg:max-h-none`}>
          <div className="px-4 pt-3 pb-2 border-b">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 text-sm">Por asignar a corte</h3>
              <span className="text-[11px] text-gray-500">
                {pendingFilter ? `${filteredPendingJobs.length} de ${pendingJobs.length}` : pendingJobs.length}
              </span>
            </div>
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={pendingFilter}
                onChange={(e) => setPendingFilter(e.target.value)}
                placeholder="Orden, cliente, PO, color…"
                className="w-full pl-8 pr-7 py-1.5 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              />
              {pendingFilter && (
                <button onClick={() => setPendingFilter("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" aria-label="Limpiar"><X className="w-3.5 h-3.5" /></button>
              )}
            </div>
          </div>
          {/* Solicitudes de corte: lo que el área de corte está pidiendo */}
          {pendingRequests.length > 0 && (
            <div className="border-b bg-violet-50/70">
              <button onClick={() => setReqOpen((v) => !v)} className="w-full px-4 py-2 flex items-center gap-2 text-left">
                <Bell className="w-4 h-4 text-violet-600" />
                <span className="text-sm font-semibold text-violet-900 flex-1">Solicitudes de corte</span>
                <span className="rounded-full bg-violet-600 text-white text-[10px] font-bold px-1.5 leading-4">{pendingRequests.length}</span>
                <span className="text-[11px] text-violet-600">{reqOpen ? "Ocultar" : "Ver"}</span>
              </button>
              {reqOpen && (
                <div className="px-2 pb-2 space-y-1.5 max-h-[34vh] overflow-y-auto">
                  {pendingRequests.map((r) => {
                    const job = pendingJobs.find((j) => j.request && j.request.id === r.id);
                    const pm = priorityMeta(r.urgency);
                    return (
                      <div key={r.id} className="rounded-lg border border-violet-200 bg-white px-2.5 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${pm.dot}`} title={`Urgencia ${pm.label}`} />
                          <span className="font-mono text-[13px] font-bold text-gray-900 truncate flex-1">{r.work_order_no}</span>
                          {r.color && <span className="text-[10px] rounded-full bg-gray-100 text-gray-700 px-1.5 py-0.5">{r.color}</span>}
                        </div>
                        <div className="text-[11px] text-gray-500 truncate">
                          {r.requested_by_name || "Corte"} · {new Date(r.created_at).toLocaleString("es-MX", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          {Number(r.quantity) > 0 ? ` · ${fmtN(r.quantity)} pzas` : ""}
                        </div>
                        {r.note && <div className="text-[11px] text-violet-800 mt-0.5 line-clamp-2" title={r.note}>“{r.note}”</div>}
                        <div className="mt-1.5 flex items-center gap-1.5">
                          {job ? (
                            <button onClick={() => assignRequest(r)} className="flex-1 rounded-md bg-violet-600 text-white text-[11px] font-semibold py-1 hover:bg-violet-700">Asignar</button>
                          ) : (
                            <span className="flex-1 text-[11px] text-gray-500">Ya tiene orden de corte</span>
                          )}
                          <button onClick={() => rejectRequest(r)} className="rounded-md border border-gray-200 text-[11px] text-gray-600 px-2 py-1 hover:bg-gray-50">
                            {job ? "Rechazar" : "Cerrar"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
            {pendingJobs.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500">
                <CheckCircle2 className="w-6 h-6 mx-auto mb-1 text-green-500" />
                Todas las órdenes tienen corte.
              </div>
            ) : filteredPendingJobs.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500">Ninguna orden coincide.</div>
            ) : (
              filteredPendingJobs.map((job) => {
                const sel = selectedKey === job.key;
                const due = job.commitment_date ? String(job.commitment_date).slice(0, 10) : null;
                const late = due && due < todayStr();
                return (
                  <button
                    key={job.key}
                    onClick={() => selectJob(job)}
                    className={`w-full text-left rounded-lg border px-2.5 py-2 transition ${sel ? "border-gray-900 bg-gray-900 text-white shadow" : "border-gray-200 bg-white hover:border-amber-300 hover:bg-amber-50/40"}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorForWO(job.key).dot}`} />
                      <span className="font-mono text-[13px] font-bold truncate flex-1 min-w-0">{job.work_order_no}</span>
                      {job.color && (
                        <span className={`text-[10px] rounded-full px-1.5 py-0.5 shrink-0 ${sel ? "bg-white/20 text-white" : "bg-gray-100 text-gray-700"}`}>{job.color}</span>
                      )}
                      {job.request && (
                        <span className={`text-[9px] font-bold rounded-full px-1.5 py-0.5 shrink-0 ${sel ? "bg-violet-300 text-violet-950" : "bg-violet-600 text-white"}`}
                          title={`Solicitada por ${job.request.requested_by_name || "corte"}`}>PEDIDA</span>
                      )}
                    </div>
                    <div className={`mt-0.5 text-[11px] truncate ${sel ? "text-white/70" : "text-gray-500"}`}>
                      {job.customer_name}{job.customer_po ? ` · PO ${job.customer_po}` : ""}{job.estilo ? ` · ${job.estilo}` : ""}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                      <span className={`font-semibold tabular-nums ${sel ? "text-white" : "text-amber-700"}`}>
                        {fmtN(job.remaining)} pzas
                        {job.already > 0 && (
                          <span className={`ml-1 font-normal ${sel ? "text-white/70" : "text-gray-400"}`}>de {fmtN(job.colorQty)}</span>
                        )}
                      </span>
                      {due && (
                        <span className={`tabular-nums ${late ? (sel ? "text-red-200 font-semibold" : "text-red-600 font-semibold") : sel ? "text-white/70" : "text-gray-400"}`}
                          title={late ? "Fecha de entrega vencida" : "Fecha de entrega"}>
                          {format(new Date(`${due}T00:00:00`), "dd/MM")}
                        </span>
                      )}
                    </div>
                    {job.already > 0 && (
                      <div className={`mt-1 h-1 rounded-full overflow-hidden ${sel ? "bg-white/20" : "bg-gray-100"}`} title={`${fmtN(job.already)} pzas ya asignadas a corte`}>
                        <div className={sel ? "h-full bg-white" : "h-full bg-amber-400"} style={{ width: `${Math.min(100, (job.already / job.colorQty) * 100)}%` }} />
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* 2) NUEVA ORDEN DE CORTE */}
        <section className={`${panel} lg:col-span-4`}>
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <Scissors className="w-4 h-4 text-gray-500" />
            <h2 className="font-semibold text-gray-900 text-sm flex-1">Nueva orden de corte</h2>
            {form.workOrderId && (
              <button onClick={clearForm} className="text-[11px] text-gray-500 hover:text-gray-800 inline-flex items-center gap-1"><X className="w-3.5 h-3.5" /> Limpiar</button>
            )}
          </div>

          {!form.workOrderId ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-gray-500">
              <ArrowLeft className="w-6 h-6 mb-2 text-gray-300 hidden lg:block" />
              <p className="text-sm font-medium text-gray-700">Elija una orden de la lista «Por asignar»</p>
              <p className="text-xs mt-1">La cantidad se llena con lo que le falta por cortar a ese color.</p>
            </div>
          ) : (
            <>
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                {/* Encabezado de la orden */}
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-gray-900">{selectedWO?.work_order_no}</span>
                    {form.color && <span className="text-[11px] rounded-full bg-white border border-gray-200 text-gray-700 px-2 py-0.5">{form.color}</span>}
                  </div>
                  <div className="text-xs text-gray-500 truncate mt-0.5">
                    {selectedWO?.customer_name}
                    {selectedWO?.customer_po ? ` · PO ${selectedWO.customer_po}` : ""}
                    {selectedColorGroup?.estilo ? ` · Estilo ${selectedColorGroup.estilo}` : selectedWO?.style_code ? ` · ${selectedWO.style_code}` : ""}
                    {selectedWO?.season ? ` · ${selectedWO.season}` : ""}
                  </div>
                  {selectedColorGroup && selectedColorGroup.sizes.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {selectedColorGroup.sizes.map((s, i) => (
                        <span key={`${s.talla}-${i}`} className="text-[10px] rounded bg-blue-50 text-blue-700 px-1.5 py-0.5">{s.talla}: {fmtN(s.quantity)}</span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Esta orden la pidió el área de corte */}
                {selectedJob?.request && (
                  <div className="rounded-xl border border-violet-200 bg-violet-50 p-2.5">
                    <div className="text-[11px] font-semibold text-violet-900 flex items-center gap-1.5">
                      <Bell className="w-3.5 h-3.5" /> Solicitada por {selectedJob.request.requested_by_name || "corte"}
                      <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] ${priorityMeta(selectedJob.request.urgency).pill}`}>{priorityMeta(selectedJob.request.urgency).label}</span>
                    </div>
                    {selectedJob.request.note && <div className="text-xs text-violet-800 mt-1">“{selectedJob.request.note}”</div>}
                    <div className="text-[10px] text-violet-600 mt-1">Al crear el corte, la solicitud queda atendida y corte lo ve.</div>
                  </div>
                )}

                {/* Cortes que YA existen para esta orden+color */}
                {existingCuts.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5">
                    <div className="text-[11px] font-semibold text-amber-800">
                      Ya en corte: {fmtN(alreadyAssigned)} de {fmtN(colorTotal)} pzas
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {existingCuts.map((co) => (
                        <span key={co.id} className="text-[10px] rounded-full bg-white border border-amber-200 text-amber-800 px-2 py-0.5">
                          {cutNo(co)} · {fmtN(co.quantity)} · {(STATUS[co.status] || {}).label || co.status}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Cantidad a cortar</label>
                    <input
                      type="number" min="1" step="1"
                      value={form.quantity}
                      onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                      className={`${input} tabular-nums ${overBy > 0 ? "border-red-300 ring-2 ring-red-200" : ""}`}
                    />
                    <p className={`text-[11px] mt-1 ${overBy > 0 ? "text-red-600 font-medium" : "text-gray-400"}`}>
                      {overBy > 0 ? `Excede lo restante por ${fmtN(overBy)}` : `Restan ${fmtN(remainingForColor)} de ${fmtN(colorTotal)}`}
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Fecha de corte</label>
                    <input type="date" value={form.cutDate} onChange={(e) => setForm((f) => ({ ...f, cutDate: e.target.value }))} className={input} />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Prioridad</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { key: "urgent", label: "Urgente", on: "bg-red-500 text-white border-red-500", off: "bg-white text-red-700 border-red-200 hover:bg-red-50" },
                      { key: "intermediate", label: "Intermedia", on: "bg-yellow-400 text-yellow-950 border-yellow-400", off: "bg-white text-yellow-700 border-yellow-200 hover:bg-yellow-50" },
                      { key: "normal", label: "Normal", on: "bg-green-500 text-white border-green-500", off: "bg-white text-green-700 border-green-200 hover:bg-green-50" },
                    ].map((opt) => (
                      <button key={opt.key} type="button" onClick={() => setForm((f) => ({ ...f, priority: opt.key }))}
                        className={`rounded-lg border px-2 py-1.5 text-xs font-semibold transition ${form.priority === opt.key ? opt.on : opt.off}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Telas */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{isMultiFabric ? `Telas del corte (${fabricOptions.length})` : "Tela y rendimiento"}</label>
                  {isMultiFabric ? (
                    <div className="rounded-xl border border-gray-200 divide-y">
                      {form.fabrics.map((f, idx) => (
                        <div key={`${f.name}||${f.code}||${idx}`} className={`flex items-center gap-2 px-2.5 py-1.5 ${f.include ? "" : "opacity-50"}`}>
                          <input type="checkbox" checked={f.include} onChange={() => toggleFabric(idx)} className="h-4 w-4 rounded border-gray-300" title="Incluir esta tela en el corte" />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-gray-900 truncate font-mono">{f.code || "(sin código)"}</div>
                            <div className="text-[11px] text-gray-500 truncate">{f.name || "—"}</div>
                          </div>
                          <input type="number" step="0.0001" min="0" value={f.yield} onChange={(e) => setFabricYield(idx, e.target.value)} disabled={!f.include}
                            placeholder="m/pza" className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-xs text-right outline-none focus:ring-2 focus:ring-gray-900/10 disabled:bg-gray-50" />
                          <span className="text-[10px] text-gray-400">m/pza</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {fabricOptions.length === 1 ? (
                        <div className="col-span-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm truncate" title={fabricLabel(fabricOptions[0])}>
                          <span className="font-mono font-semibold">{fabricOptions[0].code || "—"}</span>
                          <span className="text-gray-500"> · {fabricOptions[0].name || "—"}</span>
                        </div>
                      ) : (
                        <>
                          <input value={form.fabricCode} onChange={(e) => setForm((f) => ({ ...f, fabricCode: e.target.value }))} placeholder="Código" className={input} />
                          <input value={form.fabric} onChange={(e) => setForm((f) => ({ ...f, fabric: e.target.value }))} placeholder="Tela" className={input} />
                        </>
                      )}
                      <div className="relative">
                        <input type="number" step="0.0001" min="0" value={form.yield} onChange={(e) => setForm((f) => ({ ...f, yield: e.target.value }))}
                          placeholder="Rend." className={`${input} pr-12 text-right`} title="Rendimiento: tela por pieza" />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">m/pza</span>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notas (opcional)</label>
                  <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Instrucciones para corte…" className={input} />
                </div>
              </div>

              {/* Pie fijo: total de tela + botón, siempre visible */}
              <div className="border-t px-4 py-3 flex items-center gap-3 bg-white rounded-b-2xl">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Tela total</div>
                  <div className="text-sm font-bold text-blue-800 tabular-nums">
                    {totalLength > 0 ? `${totalLength.toLocaleString(undefined, { maximumFractionDigits: 2 })} m` : "—"}
                  </div>
                </div>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="ml-auto rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <Scissors className="w-4 h-4" /> {saving ? "Guardando…" : "Crear orden de corte"}
                </button>
              </div>
            </>
          )}
        </section>

        {/* 3) ÓRDENES DE CORTE */}
        <section className={`${panel} lg:col-span-5 max-h-[80vh] lg:max-h-none`}>
          <div className="px-4 pt-3 pb-2 border-b">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900 text-sm">Órdenes de corte</h3>
              <span className="text-[11px] rounded-full bg-gray-100 text-gray-600 px-2 py-0.5">
                {statusTabLabel} · {filteredCutOrders.length}
              </span>
              <button onClick={fetchCutOrders} className="ml-auto p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800" title="Actualizar">
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-xs shrink-0">
                {[
                  { k: "active", l: `Activas ${activeCount}` },
                  { k: "all", l: `Todas ${cutOrders.length}` },
                ].map((t) => (
                  <button key={t.k} onClick={() => setStatusTab(t.k)}
                    className={`px-2.5 py-1 rounded-md whitespace-nowrap ${statusTab === t.k ? "bg-white shadow-sm font-semibold text-gray-900" : "text-gray-600"}`}>
                    {t.l}
                  </button>
                ))}
              </div>
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input value={cutFilter} onChange={(e) => setCutFilter(e.target.value)} placeholder="CORTE, orden, cliente, color…"
                  className="w-full pl-8 pr-7 py-1.5 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-gray-900/10" />
                {cutFilter && (
                  <button onClick={() => setCutFilter("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" aria-label="Limpiar"><X className="w-3.5 h-3.5" /></button>
                )}
              </div>
            </div>
            {(cutAlerts.restanteCount > 0 || cutAlerts.exceedsCount > 0) && (
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                {cutAlerts.restanteCount > 0 && <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">{cutAlerts.restanteCount} por verificar con restante</span>}
                {cutAlerts.exceedsCount > 0 && <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5">{cutAlerts.exceedsCount} con exceso</span>}
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto divide-y">
            {loading && cutOrders.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">Cargando…</div>
            ) : filteredCutOrders.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">
                {cutOrders.length === 0 ? "Aún no hay órdenes de corte." : cutFilter ? "Ninguna orden coincide con el filtro." : `No hay órdenes «${statusTabLabel}».`}
              </div>
            ) : (
              filteredCutOrders.map((co) => {
                const meta = STATUS[co.status] || { label: co.status, pill: "bg-gray-100 text-gray-700" };
                const pm = priorityMeta(co.priority);
                const bal = cutBalance(co);
                const qty = num(co.quantity);
                const done = cutDoneOf(co);
                const pct = qty > 0 ? Math.min(100, (done / qty) * 100) : 0;
                const locked = co.status === "completed"; // sólo la verificación la cierra
                const fabs = Array.isArray(co.fabrics) && co.fabrics.length
                  ? co.fabrics
                  : (co.fabric || co.fabric_code ? [{ name: co.fabric, code: co.fabric_code }] : []);
                return (
                  <div key={co.id}
                    tabIndex={0}
                    title="Ver desglose por talla"
                    onClick={(e) => {
                      // Los selects y el botón de eliminar siguen funcionando sin abrir el panel.
                      if (e.target.closest("select, button, input, a")) return;
                      setDetailCut(co);
                    }}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailCut(co); }
                    }}
                    className={`px-4 py-2.5 cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 ${
                      detailCut?.id === co.id ? "bg-indigo-50" : "hover:bg-gray-50"
                    } ${co.status === "cancelled" ? "opacity-60" : ""}`}>
                    <div className="flex items-center gap-2">
                      <span className={`w-1 self-stretch rounded-full ${pm.dot}`} title={`Prioridad ${pm.label}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-[13px] font-bold text-gray-900">{cutNo(co)}</span>
                          <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${meta.pill}`}>{meta.label}</span>
                          {co.color && <span className="text-[10px] rounded-full bg-gray-100 text-gray-700 px-1.5 py-0.5">{co.color}</span>}
                          {bal.exceeds > 0 && <span className="text-[10px] font-semibold rounded-full bg-red-100 text-red-700 px-1.5 py-0.5">+{fmtN(bal.exceeds)}</span>}
                        </div>
                        <div className="text-[11px] text-gray-500 truncate">
                          {co.work_order_no} · {co.customer_name}{co.customer_po ? ` · PO ${co.customer_po}` : ""}
                          {fabs.length ? ` · ${fabs.map((f) => f.code || f.name).filter(Boolean).join(" + ")}` : ""}
                        </div>
                      </div>
                      <select value={co.priority || "normal"} onChange={(e) => changePriority(co.id, e.target.value)} disabled={locked || co.status === "cancelled"}
                        title="Prioridad" className={`text-[11px] rounded-md border px-1.5 py-1 outline-none font-medium disabled:opacity-50 ${pm.ring}`}>
                        <option value="urgent">Urgente</option>
                        <option value="intermediate">Intermedia</option>
                        <option value="normal">Normal</option>
                      </select>
                      <select value={co.status} onChange={(e) => changeStatus(co.id, e.target.value)} disabled={locked}
                        title={locked ? "Cortada y verificada" : "Estado"} className="text-[11px] rounded-md border border-gray-200 px-1.5 py-1 outline-none disabled:opacity-50">
                        <option value="pending">Pendiente</option>
                        <option value="in_progress">En corte</option>
                        <option value="awaiting_verification">Por verificar</option>
                        {/* "Cortada" sólo la pone la verificación del supervisor */}
                        <option value="completed" disabled>Cortada (verificada)</option>
                        <option value="cancelled">Cancelada</option>
                      </select>
                      <button onClick={() => removeCutOrder(co)} disabled={locked} className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent" title={locked ? "Un corte verificado no se elimina" : "Eliminar"}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="mt-1.5 ml-3 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden" title={`${fmtN(done)} de ${fmtN(qty)} pzas cortadas`}>
                        <div className={`h-full ${co.status === "completed" ? "bg-green-500" : bal.exceeds > 0 ? "bg-red-500" : co.status === "awaiting_verification" ? "bg-blue-500" : "bg-purple-500"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] tabular-nums text-gray-600 w-28 text-right">{fmtN(done)} / {fmtN(qty)} pzas</span>
                      <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0" aria-hidden="true" />
                    </div>
                    <div className="mt-1 ml-3 flex items-center gap-3 text-[11px] text-gray-500 flex-wrap">
                      <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" /> {fmtD(co.cut_date)}</span>
                      {co.total_length != null && <span className="text-blue-700">{Number(co.total_length).toLocaleString(undefined, { maximumFractionDigits: 2 })} m tela</span>}
                      {co.verified_by && co.status === "completed" && <span className="text-green-700">✔ {co.verified_by}</span>}
                      {co.notes && <span className="truncate max-w-[220px]" title={co.notes}>📝 {co.notes}</span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* Panel lateral: desglose del corte seleccionado */}
      {detailCut && (
        <CutBreakdownDrawer
          key={detailCut.id}
          co={detailCut}
          cutNo={cutNo(detailCut)}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel lateral con el desglose de un corte: por talla (planeado, paneles,
// cortado, restante) y por marcada (paneles × piezas por panel, tallas, si ya
// se cerró). Mismo panel que el Monitor de Corte; lee el mismo endpoint:
//   GET /api/cut-orders/analytics/breakdown?id=<id>
// ---------------------------------------------------------------------------
const STAGE_META = {
  planning:     { label: "En planeación",     chip: "bg-violet-100 text-violet-700" },
  ready:        { label: "Lista para cortar", chip: "bg-indigo-100 text-indigo-700" },
  cutting:      { label: "En corte",          chip: "bg-amber-100 text-amber-700" },
  verification: { label: "Por verificar",     chip: "bg-sky-100 text-sky-700" },
  verified:     { label: "Terminada",         chip: "bg-green-100 text-green-700" },
  cancelled:    { label: "Cancelada",         chip: "bg-red-100 text-red-600" },
};
const stageMeta = (s) => STAGE_META[s] || { label: s || "—", chip: "bg-gray-100 text-gray-600" };
const pct1 = (v) => `${(Math.round(num(v) * 10) / 10).toLocaleString()}%`;
const shortDay = (ymd) => (ymd ? `${String(ymd).slice(8, 10)}/${String(ymd).slice(5, 7)}` : "—");
const progressColor = (p) => (p >= 100 ? "#16a34a" : p >= 75 ? "#65a30d" : p >= 40 ? "#f59e0b" : p > 0 ? "#f97316" : "#94a3b8");

function DrawerProgress({ value }) {
  const v = Math.min(Math.max(num(value), 0), 100);
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden min-w-[40px]">
        <div className="h-full rounded-full" style={{ width: `${v}%`, backgroundColor: progressColor(v) }} />
      </div>
      <span className="text-[10px] text-gray-500 w-8 text-right tabular-nums">{Math.round(v)}%</span>
    </div>
  );
}

function DrawerStat({ label, value, sub, tone = "gray" }) {
  const tones = {
    teal: "text-teal-700 bg-teal-50",
    indigo: "text-indigo-700 bg-indigo-50",
    amber: "text-amber-700 bg-amber-50",
    gray: "text-gray-700 bg-gray-100",
  };
  return (
    <div className={`rounded-lg px-2 py-1.5 ${tones[tone] || tones.gray}`}>
      <p className="text-[10px] uppercase tracking-wide leading-none opacity-80">{label}</p>
      <p className="text-lg font-bold leading-tight mt-0.5 tabular-nums">{value}</p>
      {sub && <p className="text-[10px] leading-tight opacity-70">{sub}</p>}
    </div>
  );
}

function CutBreakdownDrawer({ co, cutNo, onClose }) {
  const [breakdown, setBreakdown] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/cut-orders/analytics/breakdown?id=${encodeURIComponent(co.id)}`, { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok || data.success === false) throw new Error(data.error || `Error ${res.status}`);
        setBreakdown(data);
      } catch (e) {
        if (alive) setError(e.message || "No se pudo cargar el desglose");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [co.id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const o = breakdown?.order || {};
  const t = breakdown?.totals || {};
  const sizes = breakdown?.sizes || [];
  const markers = breakdown?.markers || [];
  const fabrics = breakdown?.fabrics || [];
  const st = STATUS[co.status] || { label: co.status, pill: "bg-gray-100 text-gray-700" };

  // Mientras carga, lo que ya trae la lista.
  const fallbackCut = cutDoneOf(co);
  const fallbackQty = num(co.quantity);
  const bal = cutBalance(co);

  const subtitle = [co.customer_name, o.style || co.style_no, o.color || co.color].filter(Boolean).join(" · ");

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Desglose de ${cutNo}`}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col animate-[cutslidein_.2s_ease-out] motion-reduce:animate-none">

        {/* Cabecera */}
        <div className="px-4 py-3 border-b flex items-start gap-3 flex-shrink-0">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
            <Scissors className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2 flex-wrap">
              <span className="font-mono">{cutNo}</span>
              <span className="font-mono text-gray-500">{co.work_order_no}</span>
              {co.customer_po && <span className="text-gray-400 font-mono">PO {co.customer_po}</span>}
              {o.stage
                ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${stageMeta(o.stage).chip}`}>{stageMeta(o.stage).label}</span>
                : <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${st.pill}`}>{st.label}</span>}
            </h2>
            <p className="text-xs text-gray-500 truncate">{subtitle || "—"}</p>
            <p className="text-[11px] text-gray-400">
              Plan {fmtD(co.cut_date)}
              {co.verified_at && <> · verificado {fmtD(co.verified_at)}{co.verified_by ? ` por ${co.verified_by}` : ""}</>}
            </p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Totales */}
        <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-2 border-b flex-shrink-0">
          <DrawerStat label="Cortado" value={fmtN(t.cut ?? fallbackCut)} sub={`de ${fmtN(t.planned ?? fallbackQty)} planeadas`} tone="teal" />
          <DrawerStat label="Restante" value={fmtN(t.remaining ?? bal.restante)}
            sub={(t.over ?? bal.exceeds) > 0 ? `+${fmtN(t.over ?? bal.exceeds)} excedente` : "sin excedente"}
            tone={(t.remaining ?? bal.restante) > 0 ? "amber" : "gray"} />
          <DrawerStat label="Paneles" value={fmtN(t.panels ?? co.panels)}
            sub={t.marcadas ? `${fmtN(t.panels_done)} en marcadas cerradas` : "sin marcadas"} tone="indigo" />
          <DrawerStat label="Marcadas" value={breakdown ? `${fmtN(t.marcadas_done)} / ${fmtN(t.marcadas)}` : "—"}
            sub={t.efficiency_avg != null ? `ef. ${pct1(t.efficiency_avg)}` : "cerradas"} />
        </div>

        <div className="px-4 py-2 border-b flex-shrink-0">
          <DrawerProgress value={t.progress ?? (fallbackQty > 0 ? (fallbackCut / fallbackQty) * 100 : 0)} />
        </div>

        {/* Telas */}
        {fabrics.length > 0 && (
          <div className="px-4 py-2 border-b flex items-center gap-1.5 flex-wrap flex-shrink-0">
            <span className="text-[11px] text-gray-400 mr-1">Telas</span>
            {fabrics.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[11px] rounded-lg border border-gray-100 bg-gray-50 px-2 py-1">
                <span className="font-medium text-gray-700">{f.name || "—"}</span>
                {f.code && <span className="text-gray-400 font-mono">{f.code}</span>}
                {f.total_length != null && <span className="text-gray-900">{fmtN(f.total_length)} m</span>}
              </span>
            ))}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="text-center text-gray-400 py-12 text-sm flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando desglose…
            </div>
          ) : error ? (
            <div className="m-4 p-3 rounded-lg bg-amber-50 text-amber-700 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> No se pudo cargar el desglose: {error}
            </div>
          ) : (
            <>
              {/* Por talla */}
              <div className="px-4 pt-3 pb-1 flex items-baseline justify-between">
                <h3 className="text-xs font-bold text-gray-800">Por talla</h3>
                {t.cut_source === "markers" && <span className="text-[10px] text-gray-400">cortado = piezas de marcadas cerradas</span>}
              </div>
              {sizes.length === 0 ? (
                <div className="text-center text-gray-400 py-8 text-sm">Este corte todavía no tiene tallas.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-500 uppercase tracking-wide sticky top-0 bg-white z-10">
                    <tr className="border-b">
                      <th className="py-2 px-4 font-medium">Talla</th>
                      <th className="py-2 px-2 font-medium text-right">Planeado</th>
                      <th className="py-2 px-2 font-medium text-right" title="Paneles de las marcadas que llevan esta talla">Paneles</th>
                      <th className="py-2 px-2 font-medium text-right">Cortado</th>
                      <th className="py-2 px-2 font-medium text-right">Restante</th>
                      <th className="py-2 pl-2 pr-4 font-medium">Avance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sizes.map((s) => (
                      <tr key={s.talla} className="align-top">
                        <td className="py-2 px-4">
                          <span className="font-semibold text-gray-900">{s.talla}</span>
                          {s.markers > 0 && <span className="block text-[10px] text-gray-400">{s.markers} marcada{s.markers > 1 ? "s" : ""}</span>}
                        </td>
                        <td className="py-2 px-2 text-right text-gray-600 tabular-nums">
                          {fmtN(s.planned)}
                          {s.marker_pieces > 0 && s.marker_pieces !== s.planned && (
                            <span className="block text-[10px] text-gray-400" title="Piezas que suman las marcadas de esta talla">{fmtN(s.marker_pieces)} en marcadas</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums">
                          <span className="font-semibold text-gray-900">{fmtN(s.panels)}</span>
                          {s.panels_done > 0 && s.panels_done !== s.panels && (
                            <span className="block text-[10px] text-green-700">{fmtN(s.panels_done)} cerrados</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums">
                          <span className="font-semibold text-teal-700">{fmtN(s.cut)}</span>
                          {s.over > 0 && <span className="block text-[10px] text-amber-600">+{fmtN(s.over)} excedente</span>}
                        </td>
                        <td className="py-2 px-2 text-right font-semibold tabular-nums" style={{ color: s.remaining > 0 ? "#dc2626" : "#16a34a" }}>
                          {fmtN(s.remaining)}
                        </td>
                        <td className="py-2 pl-2 pr-4"><div className="w-[92px]"><DrawerProgress value={s.progress} /></div></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-gray-50/60 font-semibold text-gray-900 tabular-nums">
                      <td className="py-2 px-4">Total</td>
                      <td className="py-2 px-2 text-right">{fmtN(t.planned)}</td>
                      <td className="py-2 px-2 text-right" title="Paneles totales del corte (un panel sirve a varias tallas)">{fmtN(t.panels)}</td>
                      <td className="py-2 px-2 text-right text-teal-700">{fmtN(t.cut)}</td>
                      <td className="py-2 px-2 text-right">{fmtN(t.remaining)}</td>
                      <td className="py-2 pl-2 pr-4"><div className="w-[92px]"><DrawerProgress value={t.progress} /></div></td>
                    </tr>
                  </tfoot>
                </table>
              )}

              {/* Por marcada */}
              <div className="px-4 pt-4 pb-1 flex items-baseline justify-between">
                <h3 className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-gray-400" /> Marcadas
                </h3>
                {markers.length > 0 && (
                  <span className="text-[10px] text-gray-400">{fmtN(t.marker_pieces)} piezas en {markers.length} marcada{markers.length > 1 ? "s" : ""}</span>
                )}
              </div>
              {markers.length === 0 ? (
                <div className="text-center text-gray-400 py-6 text-sm px-4">Aún no hay marcadas armadas para este corte.</div>
              ) : (
                <ul className="px-4 pb-4 space-y-2">
                  {markers.map((m) => (
                    <li key={m.index} className={`rounded-lg border px-3 py-2 ${m.done ? "border-green-100 bg-green-50/40" : "border-gray-100"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-900 flex items-center gap-1.5">
                            {m.done
                              ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" aria-label="Cerrada" />
                              : <Circle className="w-3.5 h-3.5 text-gray-300 shrink-0" aria-label="Pendiente" />}
                            <span className="truncate">{m.name}</span>
                          </p>
                          <p className="text-[10px] text-gray-500 mt-0.5">
                            {m.done ? (m.completed_day ? `Cerrada ${shortDay(m.completed_day)}` : "Cerrada") : "Pendiente"}
                            {m.efficiency != null && ` · ef. ${pct1(m.efficiency)}`}
                            {m.length != null && ` · ${fmtN(m.length)} m`}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs text-gray-900 tabular-nums">
                            <span className="font-semibold">{fmtN(m.panels)}</span>
                            <span className="text-gray-400"> paneles × {fmtN(m.pieces_per_panel)}</span>
                          </p>
                          <p className="text-[11px] font-semibold text-teal-700 tabular-nums">{fmtN(m.pieces)} pzs</p>
                        </div>
                      </div>
                      {m.lines.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {m.lines.map((l, i) => (
                            <span key={`${l.talla}-${i}`} title={`${l.perPanel} por panel × ${m.panels} paneles`}
                              className="inline-flex items-center gap-1 text-[10px] rounded-md border border-gray-100 bg-white px-1.5 py-0.5">
                              <span className="font-medium text-gray-700">{l.talla}</span>
                              <span className="text-gray-400">×{fmtN(l.perPanel)}</span>
                              <span className="text-gray-900">{fmtN(l.pieces)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {(o.verification_notes || o.notes) && (
                <div className="px-4 pb-4 space-y-1 text-[11px] text-gray-500">
                  {o.verification_notes && <p><span className="text-gray-700 font-medium">Verificación:</span> {o.verification_notes}</p>}
                  {o.notes && <p><span className="text-gray-700 font-medium">Notas:</span> {o.notes}</p>}
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      <style>{`@keyframes cutslidein { from { transform: translateX(24px); opacity: .6 } to { transform: translateX(0); opacity: 1 } }`}</style>
    </div>
  );
}