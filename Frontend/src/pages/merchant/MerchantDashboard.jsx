import { useEffect, useMemo, useState } from "react";
import { Hash, Users, Shirt, ClipboardList, RefreshCw, Check, AlertCircle, Search, Factory, Layers, Gauge, PackageCheck, FileText, CheckCircle2, AlertTriangle, CalendarClock, MinusCircle, ArrowUpDown, Truck, Info, Scissors } from "lucide-react";
import StatCard from "../../components/merchant/StatCard";
import FilterBar from "../../components/merchant/Filterbar";
import MasterCodeCard from "../../components/merchant/MasterCodeCard";
import MasterCodeTable from "../../components/merchant/MasterCodeTable";
import MasterCodeDetailModal from "../../components/merchant/MasterCodeDetailModal";
import MasterCodeEditModal from "../../components/merchant/MasterCodeEditModal";
import WorkOrderTable from "../../components/merchant/WorkOrderTable";
import WorkOrderEditModal from "../../components/merchant/WorkOrderEditModal";
import MerchantPlanner from "../../components/merchant/MerchantPlanner";
import PreOrdenesPanel from "../../components/merchant/PreOrdenesPanel";
import StylesTab from "../../components/merchant/StylesTab";
import { API_URL } from "../../lib/masterCodeCatalog";
import MerchantNavbar from "../../components/merchant/MerchantNavbar";

/* Demo data shown when the backend is not reachable, so the UI is previewable */
const DEMO_RECORDS = [
  {
    code: "DAMPAN01130INV-NEG-FN2808",
    type: "DAM", modelo: "PAN", correlativo: "01", talla: "130",
    cliente: "INV", color: "NEG", estilo: "FN2808",
    description: "Pantalón dama invierno, tela franela, color negro",
    sam: 12.5, photoUrl: null, createdAt: "2026-06-28T10:15:00Z",
  },
  {
    code: "CABTSH02138INV-BLA-FN3110",
    type: "CAB", modelo: "TSH", correlativo: "02", talla: "138",
    cliente: "INV", color: "BLA", estilo: "FN3110",
    description: "T-shirt caballero manga corta, algodón peinado, blanco",
    sam: 8.2, photoUrl: null, createdAt: "2026-06-30T14:40:00Z",
  },
  {
    code: "NNALEG03006ZAR-ROS-KD1201",
    type: "NNA", modelo: "LEG", correlativo: "03", talla: "006",
    cliente: "ZAR", color: "ROS", estilo: "KD1201",
    description: "Legging niña talla infantil, licra rosada",
    sam: 6.75, photoUrl: null, createdAt: "2026-07-01T09:05:00Z",
  },
];

const DEMO_ORDERS = [
  {
    id: 1, work_order_no: "SKM0001-INV-DAMPAN01", customer_name: "Inverdibol",
    style_code: "DAMPAN01", estilo: "FN2808", style_description: "Pantalón dama invierno",
    color: "NEG, BLA", quantity: 800, total_to_produce: 780, commitment_date: "2026-08-15",
    status: "in_progress", master_code_photo_url: null, created_at: "2026-07-10T10:00:00Z",
  },
  {
    id: 2, work_order_no: "SKM0002-ZAR-NNALEG03", customer_name: "Zara México",
    style_code: "NNALEG03", estilo: "KD1201", style_description: "Legging niña licra",
    color: "ROS", quantity: 300, total_to_produce: 300, commitment_date: "2026-08-30",
    status: "pending", master_code_photo_url: null, created_at: "2026-07-12T09:30:00Z",
  },
];

/* ---- Seguimiento (estado PO · líneas · producido vs asignado) ------------ */

const STATUS_META = {
  pending:     { label: "Pendiente",  chip: "bg-slate-100 text-slate-600" },
  assigned:    { label: "Asignada",   chip: "bg-blue-100 text-blue-700" },
  in_progress: { label: "En proceso", chip: "bg-amber-100 text-amber-700" },
  completed:   { label: "Terminada",  chip: "bg-emerald-100 text-emerald-700" },
  cancelled:   { label: "Cancelada",  chip: "bg-rose-100 text-rose-600" },
};
const statusMeta = (s) => STATUS_META[s] || { label: s || "—", chip: "bg-slate-100 text-slate-600" };
const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString();
const clampPct = (n) => Math.min(Math.max(Number(n) || 0, 0), 100);
// Green once producido cierra contra lo asignado, cálido mientras arranca.
const barColor = (p) => (p >= 100 ? "#16a34a" : p >= 75 ? "#65a30d" : p >= 40 ? "#f59e0b" : p > 0 ? "#f97316" : "#cbd5e1");

// Demo fallback so the tab is previewable when /api/merchant/analytics isn't wired.
const DEMO_ANALYTICS = {
  success: true,
  summary: {
    total_pos: 3, assigned_pos: 2, unassigned_pos: 1, completed_pos: 1,
    total_pieces: 1580, produced_pieces: 920,
  },
  detail: [
    { id: 1, work_order_no: "SKM0001-INV-DAMPAN01", customer_name: "Inverdibol", customer_po: "PO-5521",
      style_code: "DAMPAN01", estilo: "FN2808", color: "NEG, BLA", status: "in_progress",
      target_quantity: 780, assigned_quantity: 780, produced_quantity: 420,
      assigned: true, assigned_lines: "1, 3", assigned_days: 2,
      first_assigned_day: "2026-08-04", last_assigned_day: "2026-08-06", commitment_date: "2026-08-15" },
    { id: 3, work_order_no: "SKM0003-INV-CABTSH02", customer_name: "Inverdibol", customer_po: "PO-5540",
      style_code: "CABTSH02", estilo: "FN3110", color: "BLA", status: "completed",
      target_quantity: 500, assigned_quantity: 500, produced_quantity: 500,
      assigned: true, assigned_lines: "2", assigned_days: 3,
      first_assigned_day: "2026-07-28", last_assigned_day: "2026-07-30", commitment_date: "2026-07-25" },
    { id: 2, work_order_no: "SKM0002-ZAR-NNALEG03", customer_name: "Zara México", customer_po: "ZR-118",
      style_code: "NNALEG03", estilo: "KD1201", color: "ROS", status: "pending",
      target_quantity: 300, assigned_quantity: 0, produced_quantity: 0,
      assigned: false, assigned_lines: null, assigned_days: 0,
      first_assigned_day: null, last_assigned_day: null, commitment_date: "2026-08-30" },
  ],
};

function StatusChip({ status }) {
  const m = statusMeta(status);
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${m.chip}`}>{m.label}</span>;
}

// The lines a PO was dropped onto: "1, 3" -> [L1] [L3].
function LineBadges({ lines }) {
  const parts = String(lines || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return <span className="text-xs text-amber-600">Sin asignar</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {parts.map((l) => (
        <span key={l} className="inline-flex items-center rounded-md bg-slate-100 text-slate-700 border border-slate-200 px-1.5 py-0.5 text-[11px] font-mono font-semibold">
          L{l}
        </span>
      ))}
    </div>
  );
}

// Producido contra lo asignado (o contra el objetivo cuando aún no hay asignación).
function ProducedVsAssigned({ produced, assigned, target }) {
  const base = Number(assigned) > 0 ? Number(assigned) : Number(target) || 0;
  const p = base > 0 ? clampPct((Number(produced) / base) * 100) : 0;
  const refLabel = Number(assigned) > 0 ? "asig." : "obj.";
  return (
    <div className="min-w-[120px]">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-slate-900">{fmtInt(produced)}</span>
        <span className="text-slate-400">/ {fmtInt(base)} <span className="text-[10px]">{refLabel}</span></span>
      </div>
      <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, backgroundColor: barColor(p) }} />
      </div>
    </div>
  );
}

/* ---- Fechas de plan vs entrega del merchant ------------------------------ */
// Mismos criterios que el panel del CEO (Analíticas → Estado de órdenes):
// inicio/fin de plan = mín/máx assigned_date; entrega = commitment_date.
const DEAD = new Set(["cancelled", "rejected"]);
const ymd = (s) => (s ? String(s).slice(0, 10) : "");
const fmtDate = (s) => {
  const k = ymd(s);
  if (!k) return null;
  const d = new Date(`${k}T00:00:00`);
  return isNaN(d) ? null : d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" });
};
const daysBetween = (aStr, bStr) => {
  const a = new Date(`${ymd(aStr)}T00:00:00`);
  const b = new Date(`${ymd(bStr)}T00:00:00`);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
};

// Veredicto de entrega: el fin de plan debe caer antes o el mismo día que la
// fecha de entrega del merchant, si no la orden va atrasada.
const DELIV = {
  ontime:  { label: "A tiempo",    accent: "bg-emerald-400", chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", Icon: CheckCircle2 },
  late:    { label: "Atrasada",    accent: "bg-rose-400",    chip: "bg-rose-50 text-rose-700 ring-rose-600/20",          Icon: AlertTriangle },
  sinplan: { label: "Por planear", accent: "bg-amber-300",   chip: "bg-amber-50 text-amber-700 ring-amber-600/20",       Icon: CalendarClock },
  nofecha: { label: "Sin fecha",   accent: "bg-slate-200",   chip: "bg-slate-100 text-slate-500 ring-slate-500/20",      Icon: MinusCircle },
};
const delivMeta = (d) => DELIV[d] || DELIV.nofecha;

function DeliveryChip({ deliv }) {
  const cfg = delivMeta(deliv);
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 whitespace-nowrap ${cfg.chip}`}>
      {Icon && <Icon size={13} />}{cfg.label}
    </span>
  );
}

// Δ días: +N (rojo) va atrasada, -N / 0 (verde) va a tiempo, — sin datos.
function DeltaDays({ delta }) {
  const tone = delta == null ? "text-slate-300" : delta > 0 ? "text-rose-600" : "text-emerald-600";
  const text = delta == null ? "—" : delta > 0 ? `+${delta}` : `${delta}`;
  return <span className={`tabular-nums font-medium ${tone}`}>{text}</span>;
}

// Barra de distribución con leyenda en línea (a tiempo / atrasadas / por planear).
function DistributionBar({ segments }) {
  const total = segments.reduce((s, x) => s + x.count, 0) || 1;
  return (
    <div className="flex items-center gap-3 flex-1 min-w-[220px]">
      <div className="flex-1 h-2.5 rounded-full overflow-hidden bg-slate-100 flex">
        {segments.map((s, i) => (
          <span key={i} className={s.cls} style={{ width: `${(s.count / total) * 100}%` }} title={`${s.label}: ${s.count}`} />
        ))}
      </div>
      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        {segments.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className={`w-2 h-2 rounded-full ${s.cls}`} />{s.label}<b className="text-slate-700 tabular-nums">{s.count}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

// Filtro segmentado compacto (Todas / A tiempo / Atrasadas / Por planear).
function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex p-0.5 rounded-lg bg-slate-100 border border-slate-200">
      {options.map((o) => {
        const active = value === o.v;
        const Icon = o.Icon;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition whitespace-nowrap
              ${active ? "bg-white text-slate-900 shadow-sm font-medium" : "text-slate-500 hover:text-slate-800"}`}
          >
            {Icon && <Icon size={14} />}{o.label}
          </button>
        );
      })}
    </div>
  );
}

export default function MerchantDashboard() {
  const [tab, setTab] = useState("master"); // "master" | "estilos" | "pre" | "po" | "plan" | "estado"

  // Pre-órdenes: el panel se monta al abrir su pestaña, pero los conteos se
  // piden al cargar el dashboard para que el KPI y el badge no salgan en 0.
  const [preCounts, setPreCounts] = useState({ pending: 0, converted: 0, cancelled: 0, all: 0 });
  const [preRefresh, setPreRefresh] = useState(0);
  // Estilos: count for the badge / KPI (filled on mount, then kept in sync by
  // the tab itself) and a refresh token the navbar's refresh button bumps.
  const [styleCount, setStyleCount] = useState(0);
  const [stylesRefresh, setStylesRefresh] = useState(0);

  const [records, setRecords] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [apiOnline, setApiOnline] = useState(false);
  const [filters, setFilters] = useState({ q: "", tipo: "", modelo: "", cliente: "" });
  const [poQuery, setPoQuery] = useState("");
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [estadoQuery, setEstadoQuery] = useState("");
  const [estadoStatus, setEstadoStatus] = useState("all");
  const [estadoDeliv, setEstadoDeliv] = useState("all"); // "all" | "ontime" | "late" | "unplanned"
  const [estadoWorst, setEstadoWorst] = useState(true);  // más atrasadas primero
  const [assignments, setAssignments] = useState([]);    // fechas de plan (inicio/fin) por orden
  const [view, setView] = useState("grid"); // "grid" | "table"
  const [selected, setSelected] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const authHeaders = () => ({
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'application/json',
  });

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.q) params.append('q', filters.q);
      if (filters.tipo) params.append('tipo', filters.tipo);
      if (filters.modelo) params.append('modelo', filters.modelo);
      if (filters.cliente) params.append('cliente', filters.cliente);

      const url = `${API_URL}/api/master-codes${params.toString() ? '?' + params.toString() : ''}`;
      const res = await fetch(url, { headers: authHeaders() });

      if (!res.ok) {
        if (res.status === 401) { window.location.href = '/login'; return; }
        throw new Error(`API error: ${res.status}`);
      }
      const data = await res.json();
      setRecords(
        data.map((r) => ({
          ...r,
          type: r.type || r.tipo,
          sam: r.sam || r.sam_minutes,
          photoUrl: r.photoUrl || null,
          createdAt: r.createdAt ? new Date(r.createdAt).toLocaleString() : new Date().toLocaleString(),
        }))
      );
      setApiOnline(true);
    } catch (err) {
      console.error("Fetch error:", err);
      setRecords(DEMO_RECORDS);
      setApiOnline(false);
      if (err.message !== 'API error: 401') {
        showToast("⚠️ Usando datos de demostración - API no disponible", true);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchOrders = async () => {
    setOrdersLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/work-orders`, { headers: authHeaders() });
      if (!res.ok) {
        if (res.status === 401) { window.location.href = '/login'; return; }
        throw new Error(`API error: ${res.status}`);
      }
      const data = await res.json();
      setOrders(data.workOrders || []);
    } catch (err) {
      console.error("Orders fetch error:", err);
      setOrders(DEMO_ORDERS);
    } finally {
      setOrdersLoading(false);
    }
  };

  // PO status / lines / producido vs asignado. Reads the same read-only endpoint
  // the CEO monitor uses, but scoped to this merchant's own tracking table. A wide
  // window (last ~12 months) so older still-open POs remain visible.
  const fetchAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const end = new Date();
      const start = new Date(); start.setDate(start.getDate() - 365);
      const ymd = (d) => d.toISOString().slice(0, 10);
      const params = new URLSearchParams({ startDate: ymd(start), endDate: ymd(end) });
      const res = await fetch(`${API_URL}/api/merchant/analytics?${params.toString()}`, { headers: authHeaders() });
      if (!res.ok) {
        if (res.status === 401) { window.location.href = '/login'; return; }
        throw new Error(`API error: ${res.status}`);
      }
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'analytics failed');
      setAnalytics(data);
    } catch (err) {
      console.error("Analytics fetch error:", err);
      setAnalytics(DEMO_ANALYTICS);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  // Asignaciones de línea: dan el inicio (mín. assigned_date) y el fin de plan
  // (máx. assigned_date) por orden, con los que se compara la fecha de entrega
  // del merchant. Mismo endpoint de solo lectura que usa el panel del CEO.
  const fetchAssignments = async () => {
    try {
      const res = await fetch(`${API_URL}/api/line-assignments`, { headers: authHeaders() });
      if (!res.ok) {
        if (res.status === 401) { window.location.href = '/login'; return; }
        throw new Error(`API error: ${res.status}`);
      }
      const data = await res.json();
      setAssignments(data?.success ? (data.assignments || []) : []);
    } catch (err) {
      console.error("Assignments fetch error:", err);
      setAssignments([]); // el detalle demo ya trae fechas propias para previsualizar
    }
  };

  // Solo los conteos por estado (el panel trae el detalle cuando se abre).
  const fetchPreCounts = async () => {
    try {
      const res = await fetch(`${API_URL}/api/pre-orders?status=pending`, { headers: authHeaders() });
      if (!res.ok) return;                       // sin backend todavía: se queda en 0
      const data = await res.json();
      if (data.counts) setPreCounts(data.counts);
    } catch { /* el dashboard sigue funcionando sin pre-órdenes */ }
  };

  // Conteo de estilos para la pestaña y el KPI, sin tener que abrir la pestaña.
  const fetchStyleCount = async () => {
    try {
      const res = await fetch(`${API_URL}/api/style-orders`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setStyleCount((data.orders || []).length);
    } catch { /* sin backend de estilos: se queda en 0 */ }
  };

  // La pestaña Estilos avisa cada vez que recarga (al volver del wizard, tras
  // convertir a pre-orden…). Se aprovecha para refrescar el conteo de
  // pre-órdenes, que cambia cuando un estilo se convierte.
  const handleStyleCount = (n) => {
    setStyleCount(n);
    fetchPreCounts();
  };

  // Permite entrar directo a una pestaña: /merchant-dashboard?tab=pre
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (["master", "estilos", "pre", "po", "estado", "plan"].includes(t)) setTab(t);
  }, []);

  // Master codes: refetch (debounced) when filters change.
  useEffect(() => {
    const t = setTimeout(fetchRecords, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.tipo, filters.modelo, filters.cliente]);

  // Orders + PO tracking: load once on mount.
  useEffect(() => { fetchOrders(); fetchAnalytics(); fetchAssignments(); fetchPreCounts(); fetchStyleCount(); }, []);

  const refreshAll = () => {
    fetchRecords(); fetchOrders(); fetchAnalytics(); fetchAssignments(); fetchPreCounts(); fetchStyleCount();
    setPreRefresh((n) => n + 1);          // recarga el panel si está abierto
    setStylesRefresh((n) => n + 1);       // y la pestaña de estilos
  };

  const filtered = useMemo(() => {
    const q = filters.q.trim().toUpperCase();
    return records.filter((r) => {
      if (filters.tipo && r.type !== filters.tipo && r.tipo !== filters.tipo) return false;
      if (filters.modelo && r.modelo !== filters.modelo) return false;
      if (filters.cliente && r.cliente !== filters.cliente) return false;
      if (q) {
        const hay = `${r.code} ${r.description || ''} ${r.cliente || ''} ${r.estilo || ''} ${r.color || ''}`.toUpperCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [records, filters]);

  const filteredOrders = useMemo(() => {
    const q = poQuery.trim().toUpperCase();
    if (!q) return orders;
    return orders.filter((o) =>
      `${o.work_order_no} ${o.customer_name || ''} ${o.style_code || ''} ${o.estilo || ''} ${o.style_description || ''} ${o.color || ''}`
        .toUpperCase().includes(q)
    );
  }, [orders, poQuery]);

  // Inicio/fin de producción por orden. El planner fija planned_start_date /
  // planned_end_date al asignar la orden (y los expande mín.→máx. si abarca
  // varios días); si faltaran, se cae a la fecha asignada. Sin canceladas/rechazadas.
  const planByWo = useMemo(() => {
    const m = new Map();
    for (const a of assignments) {
      if (DEAD.has(String(a.status || "").toLowerCase())) continue;
      const no = String(a.work_order_no || "").trim().toUpperCase();
      if (!no) continue;
      const ad = ymd(a.assigned_date);
      const startC = ymd(a.planned_start_date) || ad;  // día en que arranca producción
      const finishC = ymd(a.planned_end_date) || ad;   // día en que termina
      if (!startC && !finishC) continue;
      let p = m.get(no);
      if (!p) { p = { start: startC || finishC, finish: finishC || startC }; m.set(no, p); }
      if (startC && (!p.start || startC < p.start)) p.start = startC;
      if (finishC && (!p.finish || finishC > p.finish)) p.finish = finishC;
    }
    return m;
  }, [assignments]);

  // Fecha de entrega del merchant (commitment_date) por orden, desde las POs ya cargadas.
  const commitmentByWo = useMemo(() => {
    const m = new Map();
    for (const o of orders) {
      const no = String(o.work_order_no || "").trim().toUpperCase();
      if (no && o.commitment_date) m.set(no, ymd(o.commitment_date));
    }
    return m;
  }, [orders]);

  // Detalle enriquecido con inicio de producción, fin, entrega del merchant, Δ días
  // y veredicto. Se prefieren los campos que ya trae el detalle; si no, se derivan
  // de las asignaciones/POs. planned_start_date es el día en que arranca producción.
  const estadoBase = useMemo(() => {
    const rows = analytics?.detail || [];
    return rows.map((r) => {
      const no = String(r.work_order_no || "").trim().toUpperCase();
      const plan = planByWo.get(no);
      const planStart = ymd(r.planned_start_date) || ymd(r.first_assigned_day) || plan?.start || "";
      const planFinish = ymd(r.planned_end_date) || ymd(r.last_assigned_day) || plan?.finish || "";
      const merchantDate = ymd(r.commitment_date) || commitmentByWo.get(no) || "";
      let deliv;
      if (!merchantDate) deliv = "nofecha";
      else if (!planFinish) deliv = "sinplan";
      else deliv = daysBetween(merchantDate, planFinish) > 0 ? "late" : "ontime";
      const delta = merchantDate && planFinish ? daysBetween(merchantDate, planFinish) : null;
      return { ...r, planStart, planFinish, merchantDate, deliv, delta };
    });
  }, [analytics, planByWo, commitmentByWo]);

  const estadoRows = useMemo(() => {
    const q = estadoQuery.trim().toUpperCase();
    const rank = { late: 0, sinplan: 1, nofecha: 2, ontime: 3 };
    return estadoBase
      .filter((r) => {
        if (estadoStatus !== "all" && r.status !== estadoStatus) return false;
        if (estadoDeliv === "late" && r.deliv !== "late") return false;
        if (estadoDeliv === "ontime" && r.deliv !== "ontime") return false;
        if (estadoDeliv === "unplanned" && !(r.deliv === "sinplan" || r.deliv === "nofecha")) return false;
        if (q) {
          const hay = `${r.work_order_no} ${r.customer_name || ""} ${r.customer_po || ""} ${r.style_code || ""} ${r.estilo || ""} ${r.color || ""}`.toUpperCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .slice()
      .sort((a, b) => {
        if (rank[a.deliv] !== rank[b.deliv]) return rank[a.deliv] - rank[b.deliv];
        const da = a.delta == null ? -Infinity : a.delta;
        const db = b.delta == null ? -Infinity : b.delta;
        return estadoWorst ? db - da : da - db; // más atrasadas primero
      });
  }, [estadoBase, estadoQuery, estadoStatus, estadoDeliv, estadoWorst]);

  // Conteos de entrega para KPIs y barra de distribución (sin canceladas/rechazadas).
  const delivSummary = useMemo(() => {
    let ontime = 0, late = 0, pend = 0;
    for (const r of estadoBase) {
      if (DEAD.has(String(r.status || "").toLowerCase())) continue;
      if (r.deliv === "ontime") ontime++;
      else if (r.deliv === "late") late++;
      else pend++; // sinplan + nofecha
    }
    const judged = ontime + late;
    return { ontime, late, pend, pct: judged ? Math.round((ontime / judged) * 100) : 0 };
  }, [estadoBase]);

  const estadoSummary = useMemo(() => {
    const rows = analytics?.detail || [];
    const assigned = rows.reduce((s, r) => s + (Number(r.assigned_quantity) || 0), 0);
    const produced = rows.reduce((s, r) => s + (Number(r.produced_quantity) || 0), 0);
    return {
      total: rows.length,
      assignedPos: rows.filter((r) => r.assigned).length,
      unassignedPos: rows.filter((r) => !r.assigned).length,
      assigned,
      produced,
      progress: assigned > 0 ? Math.round((produced / assigned) * 100) : 0,
    };
  }, [analytics]);

  const clientes = useMemo(
    () => [...new Set(records.map((r) => r.cliente).filter(Boolean))].sort(),
    [records]
  );

  const stats = useMemo(() => {
    const clients = new Set(records.map((r) => r.cliente).filter(Boolean)).size;
    const models = new Set(records.map((r) => r.modelo)).size;
    return { total: records.length, clients, models, pos: orders.length };
  }, [records, orders]);

  const copyCode = (code) => {
    navigator.clipboard?.writeText(code);
    showToast("📋 Código copiado");
  };

  const duplicateCode = (code) => {
    window.location.href = `/merchant?copy=${encodeURIComponent(code)}`;
  };

  // ---- Edit: master codes -------------------------------------------------
  const openEditRecord = (record) => {
    setSelected(null);
    setEditingRecord(record);
  };

  const handleMasterSaved = (updated, original) => {
    setRecords((rs) =>
      rs.map((r) => {
        const same = original?.id ? r.id === original.id : r.code === original?.code;
        return same ? { ...r, ...updated } : r;
      })
    );
    setEditingRecord(null);
    showToast("✅ Código actualizado");
    if (apiOnline) fetchRecords(); // resync (fresh photo URLs, correlativo, etc.)
  };

  // ---- Edit: production orders -------------------------------------------
  const openEditOrder = (order) => setEditingOrder(order);

  const handleOrderSaved = (updated, original) => {
    setOrders((os) =>
      os.map((o) => {
        const same = original?.id ? o.id === original.id : o.work_order_no === original?.work_order_no;
        return same ? { ...o, ...updated } : o;
      })
    );
    setEditingOrder(null);
    showToast("✅ Orden actualizada");
    if (apiOnline) fetchOrders();
  };

  const deleteRecord = async (record) => {
    if (!window.confirm(`¿Eliminar ${record.code}?`)) return;
    if (apiOnline) {
      try {
        const id = record.id || record._id || record.code;
        const res = await fetch(`${API_URL}/api/master-codes/${encodeURIComponent(id)}`, {
          method: "DELETE", headers: authHeaders(),
        });
        if (!res.ok) {
          if (res.status === 401) { window.location.href = '/login'; return; }
          throw new Error('Failed to delete');
        }
        setRecords((rs) => rs.filter((r) => (record.id ? r.id !== record.id : r.code !== record.code)));
        setSelected(null);
        showToast("✅ Código eliminado");
        return;
      } catch (err) {
        console.error("Delete error:", err);
        showToast("❌ No se pudo eliminar en el servidor", true);
        return;
      }
    }
    setRecords((rs) => rs.filter((r) => r.code !== record.code));
    setSelected(null);
    showToast("✅ Código eliminado (local)");
  };

  const handleFilterChange = (newFilters) => setFilters(newFilters);

  const TabButton = ({ id, label, count }) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all
        ${tab === id ? "bg-slate-900 text-white shadow-sm" : "bg-white text-slate-600 border border-slate-200 hover:border-slate-400"}`}
    >
      {label}
      <span className={`text-[11px] rounded-full px-1.5 py-0.5 ${tab === id ? "bg-white/20" : "bg-slate-100 text-slate-500"}`}>
        {count}
      </span>
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-100">
      <MerchantNavbar
        title="Dashboard · Códigos maestros y PO"
        onRefresh={refreshAll}
        isRefreshing={loading || ordersLoading}
        showStatus={!loading}
        isOnline={apiOnline}
      />

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard icon={Scissors} label="Estilos" value={styleCount} />
          <StatCard icon={Hash} label="Códigos maestros" value={stats.total} />
          <StatCard icon={Users} label="Clientes" value={stats.clients} />
          <StatCard icon={Shirt} label="Modelos distintos" value={stats.models} />
          <StatCard icon={ClipboardList} label="Órdenes de producción" value={stats.pos} />
          <StatCard icon={FileText} label="Pre-órdenes pendientes" value={preCounts.pending ?? 0} />
        </div>

        {/* View switch: master codes vs POs */}
        <div className="flex flex-wrap gap-2">
          <TabButton id="master" label="Códigos maestros" count={records.length} />
          <TabButton id="estilos" label="Estilos" count={styleCount} />
          <TabButton id="pre" label="Pre-órdenes" count={preCounts.pending ?? 0} />
          <TabButton id="po" label="Órdenes de producción" count={orders.length} />
          <TabButton id="estado" label="Seguimiento" count={analytics?.detail?.length ?? 0} />
          <TabButton id="plan" label="Planeación" count={orders.length} />
        </div>

        {/* ---------------- MASTER CODES ---------------- */}
        {tab === "master" && (
          <>
            <FilterBar
              filters={filters}
              onChange={handleFilterChange}
              view={view}
              onViewChange={setView}
              clientes={clientes}
            />

            {loading ? (
              <div className="text-center py-20 text-slate-400 text-sm">
                <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
                Cargando códigos…
              </div>
            ) : filtered.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl py-16 text-center">
                <p className="text-slate-500 text-sm">
                  {records.length === 0
                    ? (apiOnline ? "No hay códigos maestros. ¡Crea el primero!" : "No se pudieron cargar los datos.")
                    : "No hay códigos que coincidan con los filtros."}
                </p>
                {records.length > 0 && (
                  <button type="button" onClick={() => handleFilterChange({ q: "", tipo: "", modelo: "", cliente: "" })}
                    className="mt-2 text-xs text-slate-900 font-semibold hover:underline">
                    Limpiar filtros
                  </button>
                )}
              </div>
            ) : view === "grid" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map((r) => (
                  <MasterCodeCard key={r.id || r.code} record={r}
                    onOpen={setSelected} onCopy={copyCode} onDuplicate={duplicateCode} onEdit={openEditRecord} onDelete={deleteRecord} />
                ))}
              </div>
            ) : (
              <MasterCodeTable records={filtered}
                onOpen={setSelected} onCopy={copyCode} onDuplicate={duplicateCode} onEdit={openEditRecord} onDelete={deleteRecord} />
            )}

            <p className="text-xs text-slate-400 text-right">
              Mostrando {filtered.length} de {records.length} códigos
              {apiOnline && ` · Conectado a ${API_URL}`}
            </p>
          </>
        )}

        {/* ---------------- ESTILOS ----------------
            Crear estilo (número → BOM → tallas → confección → colorway →
            imagen) y, ya completo: muestras, costeo y convertir a pre-orden.
            El wizard se abre a pantalla completa sobre el dashboard. */}
        {tab === "estilos" && (
          <StylesTab
            embedded
            reloadToken={stylesRefresh}
            onCount={handleStyleCount}
            // "Órdenes" on a style → the PO tab, searched by the style number
            // (or by one PO number when a single PO chip was clicked)
            onOpenOrders={(style, poNo) => {
              setPoQuery(poNo || style.styleCode || "");
              setTab("po");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        )}

        {/* ---------------- PRE-ÓRDENES ---------------- */}
        {tab === "pre" && (
          <PreOrdenesPanel
            refreshKey={preRefresh}
            onCountsChange={setPreCounts}
            onToast={showToast}
          />
        )}

        {/* ---------------- PRODUCTION ORDERS ---------------- */}
        {tab === "po" && (
          <>
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-3">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={poQuery}
                  onChange={(e) => setPoQuery(e.target.value)}
                  placeholder="Buscar por N° de orden, cliente, estilo…"
                  className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>

            {ordersLoading ? (
              <div className="text-center py-20 text-slate-400 text-sm">
                <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
                Cargando órdenes…
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl py-16 text-center">
                <p className="text-slate-500 text-sm">
                  {orders.length === 0 ? "Aún no hay órdenes de producción." : "No hay órdenes que coincidan con la búsqueda."}
                </p>
              </div>
            ) : (
              <WorkOrderTable orders={filteredOrders} onEdit={openEditOrder} />
            )}

            <p className="text-xs text-slate-400 text-right">
              Mostrando {filteredOrders.length} de {orders.length} órdenes
              {apiOnline && ` · Conectado a ${API_URL}`}
            </p>
          </>
        )}

        {/* ---------------- PO TRACKING (estado · líneas · producido vs asignado) ---------------- */}
        {tab === "estado" && (
          <>
            {/* KPIs de entrega: fin de plan vs fecha de entrega del merchant */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={CheckCircle2} label="A tiempo" value={delivSummary.ontime} />
              <StatCard icon={AlertTriangle} label="Atrasadas" value={delivSummary.late} />
              <StatCard icon={CalendarClock} label="Por planear" value={delivSummary.pend} />
              <StatCard icon={Truck} label="% a tiempo" value={`${delivSummary.pct}%`} />
            </div>

            {/* KPIs de asignación / producción */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={ClipboardList} label="POs en seguimiento" value={estadoSummary.total} />
              <StatCard icon={Layers} label="Asignadas a línea" value={`${estadoSummary.assignedPos} / ${estadoSummary.total}`} />
              <StatCard icon={PackageCheck} label="Producido / asignado" value={`${fmtInt(estadoSummary.produced)} / ${fmtInt(estadoSummary.assigned)}`} />
              <StatCard icon={Gauge} label="Avance vs asignado" value={`${estadoSummary.progress}%`} />
            </div>

            {/* Filters */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-3 flex flex-col gap-2">
              <div className="flex flex-col lg:flex-row gap-2 lg:items-center">
                <Segmented
                  value={estadoDeliv}
                  onChange={setEstadoDeliv}
                  options={[
                    { v: "all", label: "Todas" },
                    { v: "ontime", label: "A tiempo", Icon: CheckCircle2 },
                    { v: "late", label: "Atrasadas", Icon: AlertTriangle },
                    { v: "unplanned", label: "Por planear", Icon: CalendarClock },
                  ]}
                />
                <div className="relative flex-1 lg:ml-auto lg:max-w-sm">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={estadoQuery}
                    onChange={(e) => setEstadoQuery(e.target.value)}
                    placeholder="Buscar por N° de orden, cliente, estilo, color…"
                    className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <select
                  value={estadoStatus}
                  onChange={(e) => setEstadoStatus(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="all">Todos los estados</option>
                  {Object.keys(STATUS_META).map((s) => (
                    <option key={s} value={s}>{STATUS_META[s].label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setEstadoWorst((v) => !v)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                >
                  <ArrowUpDown size={15} />
                  {estadoWorst ? "Peores primero" : "Mejores primero"}
                </button>
              </div>

              {/* Distribución de entrega + regla */}
              <div className="flex flex-col md:flex-row md:items-center gap-2 pt-1 border-t border-slate-100">
                <DistributionBar
                  segments={[
                    { count: delivSummary.ontime, cls: "bg-emerald-500", label: "A tiempo" },
                    { count: delivSummary.late, cls: "bg-rose-500", label: "Atrasadas" },
                    { count: delivSummary.pend, cls: "bg-amber-300", label: "Por planear" },
                  ]}
                />
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 shrink-0">
                  <Info size={13} /> El fin de plan debe caer <b className="text-slate-600 font-medium">antes o el mismo día</b> que la entrega del merchant.
                </span>
              </div>
            </div>

            {analyticsLoading ? (
              <div className="text-center py-20 text-slate-400 text-sm">
                <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
                Cargando seguimiento…
              </div>
            ) : estadoRows.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl py-16 text-center">
                <Factory size={26} className="mx-auto mb-2 text-slate-300" />
                <p className="text-slate-500 text-sm">
                  {(analytics?.detail?.length ?? 0) === 0
                    ? "Aún no hay órdenes para dar seguimiento."
                    : "No hay órdenes que coincidan con los filtros."}
                </p>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="w-1 p-0" />
                        <th className="px-4 py-3 font-medium">Orden</th>
                        <th className="px-4 py-3 font-medium">Estilo / color</th>
                        <th className="px-4 py-3 font-medium">Estado</th>
                        <th className="px-4 py-3 font-medium">Líneas asignadas</th>
                        <th className="px-4 py-3 font-medium text-right">Asignado</th>
                        <th className="px-4 py-3 font-medium">Producido vs asignado</th>
                        <th className="px-4 py-3 font-medium text-right">Entrega merchant</th>
                        <th className="px-4 py-3 font-medium text-right">Inicio prod.</th>
                        <th className="px-4 py-3 font-medium text-right">Fin de plan</th>
                        <th className="px-4 py-3 font-medium text-right">Δ días</th>
                        <th className="px-4 py-3 font-medium text-right">Entrega</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {estadoRows.map((r) => (
                        <tr key={r.id || r.work_order_no} className="align-top hover:bg-slate-50">
                          <td className={`w-1 p-0 ${delivMeta(r.deliv).accent}`} />
                          <td className="px-4 py-3">
                            <span className="font-mono font-semibold text-slate-800">{r.work_order_no}</span>
                            <span className="block text-[11px] text-slate-400 truncate max-w-[200px]">
                              {r.customer_name || "—"}{r.customer_po ? ` · ${r.customer_po}` : ""}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="font-mono text-slate-700">{r.style_code || r.estilo || "—"}</span>
                            {r.color && <span className="block text-[11px] text-slate-400 font-mono">{r.color}</span>}
                          </td>
                          <td className="px-4 py-3"><StatusChip status={r.status} /></td>
                          <td className="px-4 py-3">
                            <LineBadges lines={r.assigned_lines} />
                            {r.assigned_days > 1 && (
                              <span className="block text-[10px] text-slate-400 mt-0.5">{r.assigned_days} días</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap font-mono text-slate-700">
                            {fmtInt(r.assigned_quantity)}
                            <span className="block text-[10px] text-slate-400">obj. {fmtInt(r.target_quantity)}</span>
                          </td>
                          <td className="px-4 py-3">
                            <ProducedVsAssigned
                              produced={r.produced_quantity}
                              assigned={r.assigned_quantity}
                              target={r.target_quantity}
                            />
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums text-slate-700">
                            {fmtDate(r.merchantDate) || <span className="text-slate-300">sin fecha</span>}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums text-slate-700">
                            {fmtDate(r.planStart) || <span className="text-slate-300">sin asignar</span>}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums text-slate-800">
                            {fmtDate(r.planFinish) || <span className="text-slate-300">sin plan</span>}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <DeltaDays delta={r.delta} />
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <DeliveryChip deliv={r.deliv} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <p className="text-xs text-slate-400 text-right">
              Mostrando {estadoRows.length} de {analytics?.detail?.length ?? 0} órdenes
              {apiOnline && ` · Conectado a ${API_URL}`}
            </p>
          </>
        )}

        {/* ---------------- PLANNING BOARD ---------------- */}
        {tab === "plan" && (
          <MerchantPlanner
            orders={orders}
            loading={ordersLoading}
            apiOnline={apiOnline}
            onRefresh={fetchOrders}
          />
        )}
      </main>

      {/* Detail modal (master codes) */}
      {selected && (
        <MasterCodeDetailModal
          record={selected}
          onClose={() => setSelected(null)}
          onCopy={copyCode}
          onEdit={openEditRecord}
        />
      )}

      {/* Edit modal (master codes) */}
      {editingRecord && (
        <MasterCodeEditModal
          record={editingRecord}
          apiOnline={apiOnline}
          onClose={() => setEditingRecord(null)}
          onSaved={handleMasterSaved}
        />
      )}

      {/* Edit modal (production orders) */}
      {editingOrder && (
        <WorkOrderEditModal
          order={editingOrder}
          apiOnline={apiOnline}
          onClose={() => setEditingOrder(null)}
          onSaved={handleOrderSaved}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 text-sm px-4 py-2 rounded-full shadow-lg flex items-center gap-2
          ${toast.isError ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'}`}>
          {toast.isError ? <AlertCircle size={14} /> : <Check size={14} className="text-emerald-400" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}