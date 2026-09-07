// components/cutting/CutPlanning.jsx
//
// PANTALLA DEL PLANNER (planeación de marcadas).
// ------------------------------------------------------------------------
// El planner arma cada MARCADA (trazo): tela, longitud, y por cada talla los
// paneles (tendidos) y las piezas por panel. Al terminar pulsa "Guardar corte",
// que persiste las marcadas en la CORTE (cada marcada queda `saved`).
//
// Aquí NO se completan/verifican marcadas ni se imprimen tickets: eso vive en
// CutVerification.jsx (supervisor de corte). Las marcadas ya verificadas
// (`done`) se muestran BLOQUEADAS; para re-planearlas el supervisor debe
// reabrirlas primero.
//
// Nota: este archivo es autónomo (trae sus propios helpers) para poder
// entregarse como pieza suelta. Si más adelante quieren, todos los helpers
// marcados abajo pueden moverse a un `lib/cutting/marcadas.js` compartido con
// CutVerification.jsx y CuttingDashboard.jsx.
//
import { useState, useEffect, useMemo } from "react";
import {
  Search, RefreshCw, Camera, Calendar, CheckCircle,
  Plus, Minus, Copy, Trash2, Layers, AlertTriangle, Lock,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";
import { colorForWO } from "../../lib/workOrderColors";

/* ======================================================================== */
/* Helpers compartibles (candidatos a lib/cutting/marcadas.js)              */
/* ======================================================================== */
const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});
const num = (v) => Number(v) || 0;
const uid = () => Math.random().toString(36).slice(2, 9);
const rnd = (v) => Math.round(num(v)).toLocaleString();
const rnd2 = (v) => num(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

const SIZE_LABELS = {
  "130": "XXXS", "132": "XXS", "134": "XS", "136": "S", "138": "M",
  "140": "L", "142": "XL", "144": "XXL",
  "004": "I-XS", "006": "S", "008": "M", "010": "L",
};
const tallaLabel = (talla) => {
  if (talla == null) return "";
  return SIZE_LABELS[String(talla).trim().toUpperCase()] || "";
};

const STATUS = {
  pending: { label: "Pendiente", pill: "bg-yellow-100 text-yellow-700" },
  in_progress: { label: "En corte", pill: "bg-purple-100 text-purple-700" },
  completed: { label: "Cortada", pill: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelada", pill: "bg-gray-100 text-gray-500" },
};

const PRIORITY = {
  urgent:       { label: "Urgente",    pill: "bg-red-100 text-red-700",       dot: "bg-red-500",    rank: 0, accent: "border-l-red-500" },
  intermediate: { label: "Intermedia", pill: "bg-yellow-100 text-yellow-700", dot: "bg-yellow-500", rank: 1, accent: "border-l-yellow-400" },
  normal:       { label: "Normal",     pill: "bg-green-100 text-green-700",   dot: "bg-green-500",  rank: 2, accent: "border-l-green-500" },
};
const priorityMeta = (p) => PRIORITY[p] || PRIORITY.normal;

const markerVerification = (markers) => {
  const list = Array.isArray(markers) ? markers : [];
  const total = list.length;
  const verified = list.filter((m) => m && m.done).length;
  return { total, verified, pending: Math.max(total - verified, 0) };
};

const PLANNED = { label: "Planeada", pill: "bg-blue-100 text-blue-700" };
const VERIFYING = { label: "Verificando", pill: "bg-purple-100 text-purple-700" };
const READY = { label: "Verificada", pill: "bg-green-100 text-green-700" };

const displayStatusMeta = (status, markers) => {
  if (status === "completed") return STATUS.completed;
  if (status === "cancelled") return STATUS.cancelled;
  const { total, verified, pending } = markerVerification(markers);
  if (total === 0) return STATUS.pending;
  if (verified === 0) return PLANNED;
  if (pending > 0) return VERIFYING;
  return READY;
};

const fmtDate = (v) => {
  if (!v) return "—";
  const s = typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v;
  const [y, m, d] = String(s).split("-");
  return d ? `${d}/${m}/${y}` : String(s);
};

const orderFabrics = (co) => {
  const raw = Array.isArray(co?.fabrics) && co.fabrics.length
    ? co.fabrics
    : Array.isArray(co?.wo_fabrics) ? co.wo_fabrics : [];
  const out = [];
  const seen = new Set();
  const push = (name, code) => {
    const nm = (name ?? "").toString().trim();
    const cd = (code ?? "").toString().trim();
    if (!nm && !cd) return;
    const key = `${nm}|${cd}`.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name: nm, code: cd });
  };
  raw.forEach((f) => push(f?.name, f?.code));
  if (!out.length) push(co?.fabric, co?.fabric_code);
  return out;
};
const fkey = (f) => `${(f?.name ?? "").toString()}|${(f?.code ?? "").toString()}`;
const findFabric = (opts, code) => opts.find((o) => o.code === code) || null;

const orderSizes = (co) =>
  Array.isArray(co?.sizes) && co.sizes.length
    ? co.sizes.map((s) => ({ talla: String(s.talla), quantity: num(s.quantity) }))
    : [{ talla: "—", quantity: num(co?.quantity) }];

const buildMarkers = (co) => {
  const saved = Array.isArray(co?.markers) ? co.markers : [];
  if (!saved.length) return [];
  const sizes = orderSizes(co);
  return saved.map((m, i) => {
    const legacyPanels = m.panels != null ? String(m.panels) : "";
    const byTalla = new Map(
      (Array.isArray(m.lines) ? m.lines : []).map((l) => [String(l.talla), l])
    );
    const toLine = (talla, l) => {
      const perPanel = l?.perPanel != null ? String(l.perPanel) : "";
      const panels =
        l?.panels != null ? String(l.panels) : num(perPanel) > 0 ? legacyPanels : "";
      return { talla, panels, perPanel };
    };
    const lines = sizes.map((s) => {
      const l = byTalla.get(s.talla);
      byTalla.delete(s.talla);
      return toLine(s.talla, l);
    });
    byTalla.forEach((l, talla) => lines.push(toLine(talla, l)));
    return {
      id: m.id || uid(),
      name: m.name || `Marcada ${i + 1}`,
      fabricCode: m.fabricCode != null ? String(m.fabricCode) : (co?.fabric_code || ""),
      fabricName: m.fabricName != null ? String(m.fabricName) : (co?.fabric || ""),
      longitud: m.longitud != null ? String(m.longitud) : "",
      yield: m.yield != null ? String(m.yield) : "",
      done: !!m.done,
      completedAt: m.completedAt || null,
      saved: true,
      lines,
    };
  });
};

const emptyMarker = (co, index, fabric = null) => ({
  id: uid(),
  name: `Marcada ${index + 1}`,
  fabricCode: fabric?.code ?? co?.fabric_code ?? "",
  fabricName: fabric?.name ?? co?.fabric ?? "",
  longitud: "",
  yield: "",
  done: false,
  completedAt: null,
  saved: false,
  lines: orderSizes(co).map((s) => ({ talla: s.talla, panels: "", perPanel: "" })),
});

const linePieces = (l) => num(l.panels) * num(l.perPanel);
const markerLines = (m) => m.lines.filter((l) => num(l.panels) > 0 && num(l.perPanel) > 0);
const markerPanels = (m) => markerLines(m).reduce((s, l) => s + num(l.panels), 0);
const markerTotal = (m) => m.lines.reduce((s, l) => s + linePieces(l), 0);
const TOLERANCE = 0.05;
const markerYield = (m) => {
  const panels = markerPanels(m);
  return panels > 0 ? (num(m.longitud) + TOLERANCE) / panels : 0;
};
const markerConsumo = (m) => {
  const panels = markerPanels(m);
  return panels > 0 ? (num(m.longitud) / panels) * markerTotal(m) : 0;
};

const serializeMarkers = (list) =>
  list.map((m) => ({
    id: m.id,
    name: m.name,
    fabricCode: (m.fabricCode || "").toString().trim() || null,
    fabricName: (m.fabricName || "").toString().trim() || null,
    longitud: num(m.longitud),
    yield: markerYield(m),
    consumo: markerConsumo(m),
    panels: markerPanels(m),
    totalPieces: markerTotal(m),
    done: !!m.done,
    completedAt: m.completedAt || null,
    lines: markerLines(m).map((l) => ({
      talla: l.talla,
      panels: num(l.panels),
      perPanel: num(l.perPanel),
      pieces: linePieces(l),
    })),
  }));

/* ======================================================================== */
/* Componente                                                               */
/* ======================================================================== */
export default function CutPlanning() {
  const [cutOrders, setCutOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState("open");
  const [selected, setSelected] = useState(null);

  const [markers, setMarkers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [activeFabric, setActiveFabric] = useState(null);

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
        const hay = `${co.work_order_no} ${co.customer_po || ""} ${co.customer_name || ""} ${co.modelo_code || ""} ${co.style_code || ""} ${co.estilo || ""} ${co.color || ""} ${co.fabric || ""} ${priorityMeta(co.priority).label}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => {
        const pr = priorityMeta(a.priority).rank - priorityMeta(b.priority).rank;
        if (pr !== 0) return pr;
        const da = a.cut_date ? new Date(`${String(a.cut_date).slice(0,10)}T00:00:00`).getTime() : Infinity;
        const db = b.cut_date ? new Date(`${String(b.cut_date).slice(0,10)}T00:00:00`).getTime() : Infinity;
        if (da !== db) return da - db;
        return new Date(b.created_at) - new Date(a.created_at);
      });
  }, [cutOrders, filter, searchTerm]);

  const cutNo = (co) => `CORTE-${String(co.id).padStart(4, "0")}`;

  const pickOrder = (co) => {
    const opts = orderFabrics(co);
    const def = findFabric(opts, co.fabric_code) || opts[0] || null;
    const mk = buildMarkers(co);
    setSelected(co);
    setActiveFabric(def);
    setMarkers(mk.length ? mk : [emptyMarker(co, 0, def)]);
    setMessage("");
    setError("");
  };

  const pedido = useMemo(() => (selected ? orderSizes(selected) : []), [selected]);
  const fabricOptions = useMemo(() => (selected ? orderFabrics(selected) : []), [selected]);

  // ---- Marcadas -----------------------------------------------------------
  const addMarker = () => setMarkers((ms) => [...ms, emptyMarker(selected, ms.length, activeFabric)]);

  const setMarkerFabric = (id, key) =>
    setMarkers((ms) =>
      ms.map((m) => {
        if (m.id !== id) return m;
        const opt = fabricOptions.find((o) => fkey(o) === key) || { code: "", name: "" };
        return { ...m, fabricCode: opt.code || "", fabricName: opt.name || "" };
      })
    );

  const duplicateMarker = (id) =>
    setMarkers((ms) => {
      const i = ms.findIndex((m) => m.id === id);
      if (i < 0) return ms;
      const copy = { ...ms[i], id: uid(), name: `${ms[i].name} (copia)`, done: false, completedAt: null, saved: false, lines: ms[i].lines.map((l) => ({ ...l })) };
      return [...ms.slice(0, i + 1), copy, ...ms.slice(i + 1)];
    });

  const removeMarker = (id) => setMarkers((ms) => ms.filter((m) => m.id !== id));

  const setMarkerField = (id, field, value) =>
    setMarkers((ms) => ms.map((m) => (m.id === id ? { ...m, [field]: value } : m)));

  const setMarkerLine = (id, li, field, value) =>
    setMarkers((ms) =>
      ms.map((m) =>
        m.id === id
          ? { ...m, lines: m.lines.map((l, i) => (i === li ? { ...l, [field]: value } : l)) }
          : m
      )
    );

  const bumpLinePanels = (id, li, delta) =>
    setMarkers((ms) =>
      ms.map((m) =>
        m.id === id
          ? {
              ...m,
              lines: m.lines.map((l, i) =>
                i === li ? { ...l, panels: String(Math.max(0, num(l.panels) + delta)) } : l
              ),
            }
          : m
      )
    );

  const cutByTalla = useMemo(() => {
    const map = new Map();
    markers.forEach((m) => {
      m.lines.forEach((l) => {
        const panels = num(l.panels);
        const per = num(l.perPanel);
        if (panels <= 0 || per <= 0) return;
        const key = String(l.talla);
        const cur = map.get(key) || { pieces: 0, panels: 0 };
        cur.pieces += panels * per;
        cur.panels += panels;
        map.set(key, cur);
      });
    });
    return map;
  }, [markers]);

  const summary = useMemo(() => {
    const base = pedido.map((p) => ({ ...p }));
    const seen = new Set(base.map((b) => b.talla));
    cutByTalla.forEach((_, talla) => {
      if (!seen.has(talla)) base.push({ talla, quantity: 0 });
    });
    return base.map((b) => {
      const agg = cutByTalla.get(b.talla) || { pieces: 0, panels: 0 };
      return {
        ...b,
        panels: agg.panels,
        cut: agg.pieces,
        remaining: Math.max(b.quantity - agg.pieces, 0),
        over: Math.max(agg.pieces - b.quantity, 0),
      };
    });
  }, [pedido, cutByTalla]);

  const totals = useMemo(() => {
    const t = summary.reduce(
      (a, r) => {
        a.quantity += r.quantity;
        a.cut += r.cut;
        a.remaining += r.remaining;
        a.over += r.over;
        return a;
      },
      { quantity: 0, cut: 0, remaining: 0, over: 0 }
    );
    t.panels = markers.reduce((s, m) => s + markerPanels(m), 0);
    t.consumo = markers.reduce((s, m) => s + markerConsumo(m), 0);
    return t;
  }, [summary, markers]);

  const remainingByTalla = useMemo(
    () => new Map(summary.map((r) => [r.talla, r.remaining])),
    [summary]
  );
  const pedidoByTalla = useMemo(
    () => new Map(summary.map((r) => [r.talla, r.quantity])),
    [summary]
  );

  const verification = useMemo(() => markerVerification(markers), [markers]);

  // ---- Guardar (sólo planeación) -----------------------------------------
  const persist = async (list, okMessage) => {
    if (!selected) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      // Planear NO es cortar: aquí sólo se guardan las marcadas y sus paneles.
      // Antes se mandaba también sizeProgress con amountCut = piezas planeadas,
      // así que terminar el plan dejaba la orden con todo "cortado" y remaining
      // en 0 — y el backend la cerraba sola. El avance real de corte lo escribe
      // CutVerification conforme el supervisor va verificando cada marcada.
      const body = {
        markers: serializeMarkers(list),
        panels: list.reduce((s, m) => s + markerPanels(m), 0),
      };

      const res = await fetch(`${API_URL}/api/cut-orders/${selected.id}/cutting`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(okMessage);
        await fetchCutOrders();
        const merged = { ...selected, ...data.cutOrder };
        setSelected(merged);
        const mk = buildMarkers(merged);
        if (mk.length) setMarkers(mk);
      } else {
        setError(data.error || "No se pudo guardar");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (totals.cut <= 0) {
      return setError("Ingrese los paneles y las piezas por panel de cada marcada");
    }
    const v = markerVerification(markers);
    const msg =
      v.total === 0
        ? "Planeación guardada"
        : v.pending > 0
        ? `Planeación guardada · faltan ${v.pending} marcada${v.pending > 1 ? "s" : ""} por verificar (supervisor de corte)`
        : "Planeación guardada · todas las marcadas ya están verificadas";
    persist(markers, msg);
  };

  const lockedCount = markers.filter((m) => m.done).length;

  return (
    <div className="space-y-6">
      {/* Cabecera de la pantalla */}
      <div className="flex items-center gap-2">
        <Layers className="w-5 h-5 text-gray-400" />
        <h1 className="text-lg font-bold text-gray-900">Planeación de marcadas</h1>
        <span className="text-xs text-gray-500">Arme las marcadas y guarde el corte. La verificación e impresión las hace el supervisor de corte.</span>
      </div>

      {/* Selector de orden */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {[{ id: "open", label: "Por planear" }, { id: "completed", label: "Cortadas" }, { id: "all", label: "Todas" }].map((f) => (
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
              const meta = displayStatusMeta(co.status, co.markers);
              const pr = priorityMeta(co.priority);
              const isSel = selected?.id === co.id;
              return (
                <button key={co.id} onClick={() => pickOrder(co)} className={`w-full text-left p-4 flex gap-3 items-center border-l-4 ${pr.accent} hover:bg-gray-50 ${isSel ? "bg-blue-50" : ""}`}>
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorForWO(co.work_order_id).dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold text-gray-900">{cutNo(co)}</span>
                      <span className={`text-[11px] rounded-full px-2 py-0.5 inline-flex items-center gap-1 ${pr.pill}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${pr.dot}`} />
                        {pr.label}
                      </span>
                      <span className={`text-[11px] rounded-full px-2 py-0.5 ${meta.pill}`}>{meta.label}</span>
                      <VerifyPill markers={co.markers} status={co.status} />
                    </div>
                    <p className="text-xs text-gray-500 truncate">
                      {co.work_order_no}{co.customer_po ? ` · PO ${co.customer_po}` : ""} · {co.customer_name}{co.color ? ` · ${co.color}` : ""}{(co.modelo_code || co.style_no) ? ` · Est. ${co.modelo_code || co.style_no}` : ""}
                      {co.fabric || co.fabric_code ? ` · ${[co.fabric_code, co.fabric].filter(Boolean).join(" ")}` : ""}
                    </p>
                  </div>
                  <div className="text-right text-[11px] text-gray-500">
                    <div className="inline-flex items-center gap-1 text-gray-400"><Calendar className="w-3 h-3" /> {fmtDate(co.cut_date)}</div>
                    <div className="mt-0.5">
                      {num(co.remaining_to_cut) > 0 ? <span className="text-amber-600 font-medium">Restan {rnd(co.remaining_to_cut)}</span> : `${rnd(co.quantity)} pzas`}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Editor de planeación */}
      <div>
        {!selected ? (
          <div className="rounded-2xl border bg-white shadow-sm p-8 text-center text-gray-500">
            Elija una orden de corte para planear sus marcadas.
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
                  <span className={`text-[11px] rounded-full px-2 py-0.5 inline-flex items-center gap-1 ${priorityMeta(selected.priority).pill}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${priorityMeta(selected.priority).dot}`} />
                    {priorityMeta(selected.priority).label}
                  </span>
                  <span className={`text-[11px] rounded-full px-2 py-0.5 ${displayStatusMeta(selected.status, markers).pill}`}>
                    {displayStatusMeta(selected.status, markers).label}
                  </span>
                  <VerifyPill markers={markers} status={selected.status} />
                </div>
                <p className="text-sm text-gray-600 truncate">{selected.work_order_no}{selected.customer_po ? ` · PO ${selected.customer_po}` : ""} · {selected.customer_name}</p>
              </div>
            </div>

            <div className="p-5 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 text-sm border-b">
              <Info label="PO cliente" value={selected.customer_po} />
              <Info label="Estilo N°" value={selected.modelo_code || selected.style_no || selected.style_code || selected.estilo} />
              <Info label="Color" value={selected.color} />
              <Info label="Season" value={selected.season} />
              <div className="rounded-xl p-3 border bg-gray-50 border-gray-100">
                <span className="text-[11px] text-gray-500 uppercase tracking-wide">Código de tela</span>
                {fabricOptions.length > 1 ? (
                  <>
                    <select
                      value={fkey(activeFabric)}
                      onChange={(e) =>
                        setActiveFabric(fabricOptions.find((o) => fkey(o) === e.target.value) || null)
                      }
                      title="Código que hereda cada marcada nueva"
                      className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm font-semibold text-gray-900 outline-none focus:ring-2 focus:ring-gray-900/10"
                    >
                      {fabricOptions.map((f) => (
                        <option key={fkey(f)} value={fkey(f)}>{f.code || "(sin código)"}</option>
                      ))}
                    </select>
                    <span className="block text-[10px] text-gray-400 mt-1">
                      {fabricOptions.length} telas · elija la que va a planear
                    </span>
                  </>
                ) : (
                  <div className="mt-1 text-sm font-semibold text-gray-900">
                    {activeFabric?.code || selected.fabric_code || "—"}
                  </div>
                )}
              </div>
              <Info label="Tela" value={activeFabric?.name || selected.fabric} />
              <Info label="A cortar" value={`${rnd(selected.quantity)} pzas`} />
              <Info label="Fecha" value={fmtDate(selected.cut_date)} icon={Calendar} />
            </div>

            <div className="p-5 space-y-5">
              {/* Avance global (planeado) */}
              <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-gray-500">Planeado</div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold text-blue-700">{rnd(totals.cut)}</span>
                      <span className="text-sm text-gray-500">/ {rnd(totals.quantity)} pzas</span>
                    </div>
                  </div>
                  <Metric label="Marcadas" value={`${verification.verified}/${verification.total}`} />
                  <Metric label="Paneles" value={rnd(totals.panels)} />
                  <Metric label="Consumo (m)" value={rnd2(totals.consumo)} tone="text-blue-700" />
                  <Metric
                    label={totals.remaining > 0 ? "Restante" : "Completo"}
                    value={rnd(totals.remaining)}
                    tone={totals.remaining > 0 ? "text-amber-600" : "text-green-600"}
                  />
                </div>
                <div className="mt-3">
                  <Bar value={totals.cut} max={totals.quantity} over={totals.over > 0} />
                </div>
                {totals.over > 0 && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600">
                    <AlertTriangle className="w-3.5 h-3.5" /> Excede el pedido en {rnd(totals.over)} pzas
                  </div>
                )}
              </div>

              {lockedCount > 0 && (
                <div className="flex items-center gap-2 text-xs text-gray-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  {lockedCount} marcada{lockedCount > 1 ? "s" : ""} ya verificada{lockedCount > 1 ? "s" : ""} — bloqueada{lockedCount > 1 ? "s" : ""}. El supervisor de corte debe reabrirla{lockedCount > 1 ? "s" : ""} para re-planear.
                </div>
              )}

              {/* Marcadas */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-gray-400" /> Marcadas
                  </h3>
                  <p className="text-xs text-gray-500">Paneles × pzs/panel de cada talla del trazo.</p>
                </div>
                <button onClick={addMarker} className="inline-flex items-center gap-1.5 text-sm rounded-lg bg-gray-900 px-3 py-2 text-white hover:bg-gray-800">
                  <Plus className="w-4 h-4" /> Añadir marcada
                </button>
              </div>

              {markers.length === 0 ? (
                <button onClick={addMarker} className="w-full rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 hover:border-gray-400 hover:bg-gray-50">
                  Añada la primera marcada para empezar a planear.
                </button>
              ) : (
                <div className="space-y-4">
                  {markers.map((m, mi) => {
                    const panels = markerPanels(m);
                    const tot = markerTotal(m);
                    const consumo = markerConsumo(m);
                    const yieldVal = markerYield(m);
                    const used = markerLines(m).length;
                    const locked = !!m.done; // ya verificada por el supervisor → solo lectura
                    const mCur = { name: m.fabricName || "", code: m.fabricCode || "" };
                    const mHasOpt = fabricOptions.some((o) => fkey(o) === fkey(mCur));
                    const mOpts = mHasOpt ? fabricOptions : [mCur, ...fabricOptions];
                    return (
                      <div key={m.id} className={`rounded-2xl border overflow-hidden ${locked ? "border-green-300" : "border-gray-200"}`}>
                        {/* Header */}
                        <div className={`border-b px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 ${locked ? "bg-green-50" : "bg-gray-50"}`}>
                          <span className={`shrink-0 w-8 h-8 rounded-lg text-white text-xs font-bold flex items-center justify-center ${locked ? "bg-green-600" : "bg-gray-900"}`}>
                            M{mi + 1}
                          </span>
                          <input
                            value={m.name}
                            onChange={(e) => setMarkerField(m.id, "name", e.target.value)}
                            placeholder="Nombre de la marcada"
                            disabled={locked}
                            className="w-40 sm:w-56 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-gray-900 hover:border-gray-200 focus:border-gray-200 focus:bg-white outline-none focus:ring-2 focus:ring-gray-900/10 disabled:hover:border-transparent"
                          />

                          {fabricOptions.length > 1 ? (
                            <label className="flex items-center gap-1.5">
                              <span className="text-[10px] uppercase tracking-wide text-gray-400">Tela</span>
                              <select
                                value={fkey(mCur)}
                                onChange={(e) => setMarkerFabric(m.id, e.target.value)}
                                disabled={locked}
                                title="Código de tela que se corta en esta marcada"
                                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-gray-900/10 disabled:bg-gray-50 disabled:text-gray-500"
                              >
                                {mOpts.map((f) => (
                                  <option key={fkey(f)} value={fkey(f)}>{f.code || "(sin código)"}</option>
                                ))}
                              </select>
                            </label>
                          ) : (
                            (m.fabricCode || m.fabricName) && (
                              <span className="text-[11px] rounded-full px-2 py-0.5 bg-slate-100 text-slate-600" title="Tela de la marcada">
                                {m.fabricCode || m.fabricName}
                              </span>
                            )
                          )}

                          <div className="ml-auto flex items-center gap-3">
                            <div className="text-right leading-tight">
                              <div className="text-base font-bold text-blue-700">{rnd(tot)} <span className="text-xs font-medium text-gray-400">pzas</span></div>
                              <div className="text-[11px] text-gray-500">{rnd(panels)} panel(es) · {used} talla(s)</div>
                            </div>
                            {locked ? (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-green-700">
                                <Lock className="w-3.5 h-3.5" /> Verificada
                              </span>
                            ) : (
                              <>
                                <button onClick={() => duplicateMarker(m.id)} title="Duplicar marcada" className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-white">
                                  <Copy className="w-4 h-4" />
                                </button>
                                <button onClick={() => removeMarker(m.id)} title="Quitar marcada" className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-white">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Longitud · Rendimiento · Consumo */}
                        <div className={`px-3 py-2.5 border-b grid grid-cols-3 gap-2 ${locked ? "bg-green-50/40" : "bg-white"}`}>
                          <label className="block">
                            <span className="block text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Longitud (m)</span>
                            {locked ? (
                              <div className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-right text-sm font-semibold text-gray-700">{rnd2(m.longitud)}</div>
                            ) : (
                              <input
                                type="number" min="0" step="0.01" inputMode="decimal" value={m.longitud}
                                onChange={(e) => setMarkerField(m.id, "longitud", e.target.value)}
                                onFocus={(e) => e.target.select()}
                                placeholder="0"
                                className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-right text-sm font-semibold outline-none focus:ring-2 focus:ring-gray-900/10"
                              />
                            )}
                          </label>

                          <label className="block">
                            <span className="block text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Rendimiento (m/pza)</span>
                            <div className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-right text-sm font-semibold text-gray-700">
                              {rnd2(yieldVal)}
                            </div>
                            <span className="block text-[10px] text-gray-400 mt-0.5 text-right">(long + {TOLERANCE}) ÷ {rnd(panels)} panel(es)</span>
                          </label>

                          <label className="block">
                            <span className="block text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Consumo (m)</span>
                            <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-2 py-2 text-right text-sm font-bold text-blue-700">
                              {rnd2(consumo)}
                            </div>
                            <span className="block text-[10px] text-gray-400 mt-0.5 text-right">(long ÷ {rnd(panels)}) × {rnd(tot)} pzas</span>
                          </label>
                        </div>

                        {/* Tallas del trazo */}
                        <div className="p-3 grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {m.lines.map((l, li) => {
                            const perPanel = num(l.perPanel);
                            const linePanels = num(l.panels);
                            const pieces = linePieces(l);
                            const active = pieces > 0;
                            const ped = pedidoByTalla.get(String(l.talla)) ?? 0;
                            const rest = remainingByTalla.get(String(l.talla)) ?? 0;
                            return (
                              <div
                                key={`${m.id}-${l.talla}-${li}`}
                                className={`rounded-xl border p-2.5 transition ${active ? "border-blue-300 bg-blue-50/50" : "border-gray-200 bg-white"}`}
                              >
                                <div className="flex items-baseline justify-between gap-1">
                                  <span className="text-sm font-bold text-gray-900">
                                    {l.talla}
                                    {tallaLabel(l.talla) && (
                                      <span className="ml-1.5 text-[10px] font-semibold rounded bg-white border border-gray-200 text-gray-600 px-1.5 py-0.5">
                                        {tallaLabel(l.talla)}
                                      </span>
                                    )}
                                  </span>
                                  <span className={`text-xs font-bold ${active ? "text-blue-700" : "text-gray-300"}`}>
                                    {rnd(pieces)} pzas
                                  </span>
                                </div>

                                <div className="mt-2 grid grid-cols-2 gap-1.5">
                                  <label className="block">
                                    <span className="block text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Paneles</span>
                                    {locked ? (
                                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-right text-sm font-semibold text-gray-700">
                                        {rnd(linePanels)}
                                      </div>
                                    ) : (
                                      <div className="flex items-center rounded-lg border border-gray-200 bg-white overflow-hidden">
                                        <button
                                          type="button"
                                          onClick={() => bumpLinePanels(m.id, li, -1)}
                                          className="px-1.5 py-2 text-gray-400 hover:bg-gray-100"
                                          aria-label={`Menos paneles talla ${l.talla}`}
                                        >
                                          <Minus className="w-3 h-3" />
                                        </button>
                                        <input
                                          type="number" min="0" inputMode="numeric" value={l.panels}
                                          onChange={(e) => setMarkerLine(m.id, li, "panels", e.target.value)}
                                          onFocus={(e) => e.target.select()}
                                          placeholder="0"
                                          className="w-full min-w-0 text-center text-sm font-semibold py-2 outline-none"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => bumpLinePanels(m.id, li, 1)}
                                          className="px-1.5 py-2 text-gray-400 hover:bg-gray-100"
                                          aria-label={`Más paneles talla ${l.talla}`}
                                        >
                                          <Plus className="w-3 h-3" />
                                        </button>
                                      </div>
                                    )}
                                  </label>

                                  <label className="block">
                                    <span className="block text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Pzs/panel</span>
                                    <input
                                      type="number" min="0" inputMode="numeric" value={l.perPanel}
                                      onChange={(e) => setMarkerLine(m.id, li, "perPanel", e.target.value)}
                                      onFocus={(e) => e.target.select()}
                                      placeholder="0"
                                      disabled={locked}
                                      className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-right text-sm font-semibold outline-none focus:ring-2 focus:ring-gray-900/10 disabled:bg-gray-50 disabled:text-gray-600"
                                    />
                                  </label>
                                </div>

                                <div className="mt-1.5 text-[10px] text-gray-400">
                                  {linePanels > 0 && perPanel > 0 && (
                                    <span className="text-gray-500">{rnd(linePanels)} × {rnd(perPanel)} · </span>
                                  )}
                                  Pedido {rnd(ped)} · {rest > 0 ? <span className="text-amber-600">restan {rnd(rest)}</span> : <span className="text-green-600">completo</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Pie de la marcada (sólo informativo en planeación) */}
                        <div className={`px-3 py-2.5 border-t text-xs ${locked ? "bg-green-50/60 text-green-700" : "bg-white text-gray-400"}`}>
                          {locked
                            ? "Marcada verificada por el supervisor de corte — bloqueada aquí."
                            : "Se verifica e imprime desde la pantalla de verificación (supervisor de corte)."}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Consolidado por talla */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Total por talla</h3>
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="text-left font-medium px-3 py-2">Talla</th>
                        <th className="text-right font-medium px-2 py-2">Pedido</th>
                        <th className="text-right font-medium px-2 py-2">Paneles</th>
                        <th className="text-right font-medium px-2 py-2">Planeado</th>
                        <th className="px-2 py-2 w-32">Avance</th>
                        <th className="text-right font-medium px-3 py-2">Restante</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {summary.map((r, i) => (
                        <tr key={`s-${r.talla}-${i}`}>
                          <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">
                            {r.talla}
                            {tallaLabel(r.talla) && <span className="ml-1.5 text-[11px] rounded bg-blue-50 text-blue-700 px-1.5 py-0.5 align-middle">{tallaLabel(r.talla)}</span>}
                          </td>
                          <td className="px-2 py-2 text-right text-gray-600">{rnd(r.quantity)}</td>
                          <td className="px-2 py-2 text-right text-gray-600">{rnd(r.panels)}</td>
                          <td className="px-2 py-2 text-right font-semibold text-blue-700">{rnd(r.cut)}</td>
                          <td className="px-2 py-2"><Bar value={r.cut} max={r.quantity} over={r.over > 0} /></td>
                          <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${r.over > 0 ? "text-red-600" : r.remaining > 0 ? "text-amber-600" : "text-green-600"}`}>
                            {r.over > 0 ? `Excede ${rnd(r.over)}` : rnd(r.remaining)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 font-semibold text-gray-800">
                      <tr>
                        <td className="px-3 py-2">Total</td>
                        <td className="px-2 py-2 text-right">{rnd(totals.quantity)}</td>
                        <td className="px-2 py-2 text-right">{rnd(totals.panels)}</td>
                        <td className="px-2 py-2 text-right text-blue-700">{rnd(totals.cut)}</td>
                        <td className="px-2 py-2"><Bar value={totals.cut} max={totals.quantity} over={totals.over > 0} /></td>
                        <td className="px-3 py-2 text-right">
                          {totals.over > 0 && <div className="text-red-600">Excede {rnd(totals.over)}</div>}
                          <div className={totals.remaining > 0 ? "text-amber-600" : "text-green-600"}>{rnd(totals.remaining)}</div>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {error && <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm">{error}</div>}
              {message && <div className="bg-green-50 text-green-700 p-3 rounded-xl text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4" /> {message}</div>}

              {/* Acción única: guardar planeación */}
              <div className="sticky bottom-0 -mx-5 px-5 pt-3 pb-4 bg-white/95 backdrop-blur border-t">
                <button onClick={handleSave} disabled={saving} className="w-full rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
                  {saving ? "Guardando…" : `Guardar corte · ${rnd(totals.cut)} pzas planeadas`}
                </button>
                <p className="mt-2 text-center text-[11px] text-gray-400">
                  La verificación de marcadas y la impresión de tickets se hacen en la pantalla del supervisor de corte.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ======================================================================== */
/* UI atoms (compartibles con CutVerification.jsx)                          */
/* ======================================================================== */
function VerifyPill({ markers, status }) {
  const { total, verified, pending } = markerVerification(markers);
  if (total === 0) return null;
  const base = "text-[11px] rounded-full px-2 py-0.5 inline-flex items-center gap-1";
  if (status === "completed" || status === "cancelled") {
    return (
      <span className={`${base} bg-slate-100 text-slate-600`}>
        <Layers className="w-3 h-3" /> {total}
      </span>
    );
  }
  return pending > 0 ? (
    <span className={`${base} bg-amber-100 text-amber-700`}>
      <AlertTriangle className="w-3 h-3" /> Falta verificar {pending} marcada{pending > 1 ? "s" : ""}
    </span>
  ) : (
    <span className={`${base} bg-green-100 text-green-700`}>
      <CheckCircle className="w-3 h-3" /> {verified} marcada{verified > 1 ? "s" : ""} verificada{verified > 1 ? "s" : ""}
    </span>
  );
}

function Metric({ label, value, tone = "text-gray-900" }) {
  return (
    <div className="text-right">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${tone}`}>{value}</div>
    </div>
  );
}

function Bar({ value, max, over }) {
  const pct = max > 0 ? Math.min((num(value) / num(max)) * 100, 100) : 0;
  const color = over ? "bg-red-500" : pct >= 100 ? "bg-green-500" : "bg-blue-500";
  return (
    <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
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