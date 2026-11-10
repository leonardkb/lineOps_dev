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
// AGRUPAR ÓRDENES: el planner puede juntar varias CORTES compatibles y
// planearlas como una sola (tallas sumadas). Sólo se agrupan órdenes con el
// MISMO estilo y la MISMA tela, o (Nike) con el MISMO item code. Al guardar,
// los paneles de cada talla se reparten entre las órdenes del grupo (por
// prioridad, luego fecha) y cada orden recibe su parte de cada marcada, así
// la verificación y los tickets siguen funcionando por orden.
//
// Nota: este archivo es autónomo (trae sus propios helpers) para poder
// entregarse como pieza suelta. Si más adelante quieren, todos los helpers
// marcados abajo pueden moverse a un `lib/cutting/marcadas.js` compartido con
// CutVerification.jsx y CuttingDashboard.jsx.
//
import { useState, useEffect, useMemo, useRef } from "react";
import {
  Search, RefreshCw, Camera, Calendar, CheckCircle, ChevronRight,
  Plus, Minus, Copy, Trash2, Layers, AlertTriangle, Lock,
  Link2, Unlink, X, Check, ChevronLeft,
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
  "146": "XXXL", "148": "S-T", "150": "M-T", "152": "L-T", "154": "XL-T", "156": "2XL-T",
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

// ---- Planeación POR TELA ---------------------------------------------------
// Una CORTE con varias telas (cuerpo, forro, rib…) se planea completa EN CADA
// tela: si la orden es de 500 pzas, la tela 1 lleva marcadas por 500 y la tela
// 2 otras marcadas por 500. Cada marcada pertenece a una tela (fabricCode /
// fabricName) y el avance se mide por tela.
const fup = (v) => (v ?? "").toString().trim().toUpperCase();
// Tela de la orden a la que pertenece una marcada: por código; si la marcada
// no trae código, por nombre. Si no coincide con ninguna, es una tela "suelta"
// (dato viejo o tela que ya no está en la orden) y se muestra aparte.
const markerFabricKey = (m, options) => {
  const code = fup(m?.fabricCode);
  const name = fup(m?.fabricName);
  const hit = (code && options.find((o) => fup(o.code) === code))
    || (!code && name && options.find((o) => fup(o.name) === name))
    || (!code && !name && options.length === 1 ? options[0] : null);
  return hit ? fkey(hit) : `X|${name}|${code}`;
};
// Pestañas de tela: las de la orden + las sueltas que traigan las marcadas.
const fabricTabsOf = (options, markers) => {
  const tabs = options.map((o) => ({ key: fkey(o), code: o.code, name: o.name, extra: false }));
  const seen = new Set(tabs.map((t) => t.key));
  markers.forEach((m) => {
    const k = markerFabricKey(m, options);
    if (seen.has(k)) return;
    seen.add(k);
    tabs.push({ key: k, code: m.fabricCode || "", name: m.fabricName || "", extra: true });
  });
  return tabs;
};

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
      efficiency: m.efficiency != null ? String(m.efficiency) : "",
      comment: m.comment != null ? String(m.comment) : "",
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
  efficiency: "",
  comment: "",
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
    efficiency: m.efficiency === "" || m.efficiency == null ? null : num(m.efficiency),
    comment: (m.comment || "").toString().trim() || null,
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
/* Agrupación de órdenes                                                    */
/* (mismas reglas que cutGroupKey en cut-orders.js)                         */
/* ======================================================================== */
const up = (v) => String(v ?? "").trim().toUpperCase();
const GROUP_BY = {
  style_fabric: { label: "Estilo + tela", hint: "Mismo estilo y misma tela" },
  item_code: { label: "Item code", hint: "Mismo item code (Nike)" },
};
const styleOf = (co) => co?.modelo_code || co?.style_no || co?.style_code || co?.estilo || "";
const fabricKeyOf = (co) => {
  const raw = Array.isArray(co?.fabrics) && co.fabrics.length
    ? co.fabrics
    : Array.isArray(co?.wo_fabrics) ? co.wo_fabrics : [];
  let codes = raw.map((f) => up(f?.code) || up(f?.name)).filter(Boolean);
  if (!codes.length) codes = [up(co?.fabric_code) || up(co?.fabric)].filter(Boolean);
  return [...new Set(codes)].sort().join("+");
};
const itemCodesOf = (co) =>
  [...new Set((Array.isArray(co?.item_codes) ? co.item_codes : []).map(up).filter(Boolean))];
const groupKeyOf = (co, by) => {
  if (by === "item_code") {
    const ics = itemCodesOf(co);
    return ics.length === 1 ? `IC:${ics[0]}` : null;
  }
  const st = up(styleOf(co));
  const fb = fabricKeyOf(co);
  return st && fb ? `${st}|${fb}` : null;
};
// Por qué una orden no se puede marcar para agrupar (null = sí se puede).
const groupBlockReason = (co, by, anchorKey) => {
  if (co.cut_group_id) return "Ya está en un grupo";
  if (co.status === "completed" || co.status === "cancelled") return "Orden cerrada";
  if (markerVerification(co.markers).verified > 0) return "Tiene marcadas verificadas";
  const key = groupKeyOf(co, by);
  if (!key) {
    if (by === "item_code") return itemCodesOf(co).length > 1 ? "Tiene varios item codes" : "Sin item code";
    return "Sin estilo o tela";
  }
  if (anchorKey && key !== anchorKey) return by === "item_code" ? "Otro item code" : "Otro estilo o tela";
  return null;
};

const cutNo = (co) => `CORTE-${String(co.id).padStart(4, "0")}`;
const groupNo = (id) => `GRUPO-${String(id).padStart(4, "0")}`;
const uniq = (list) => [...new Set(list.filter((v) => v != null && String(v).trim() !== "").map((v) => String(v).trim()))];
const memberSort = (a, b) =>
  priorityMeta(a.priority).rank - priorityMeta(b.priority).rank ||
  String(a.cut_date || "9999").localeCompare(String(b.cut_date || "9999")) ||
  Number(a.id) - Number(b.id);

// "Orden virtual" del grupo: tallas sumadas y datos combinados de las órdenes.
// El editor de marcadas la trata igual que una orden normal.
const buildGroupView = (group, members) => {
  const ms = [...members].sort(memberSort);
  const first = ms[0] || {};
  const sizes = [];
  const idx = new Map();
  ms.forEach((co) => {
    orderSizes(co).forEach((s) => {
      if (!idx.has(s.talla)) { idx.set(s.talla, sizes.length); sizes.push({ talla: s.talla, quantity: 0 }); }
      sizes[idx.get(s.talla)].quantity += s.quantity;
    });
  });
  const fabrics = [];
  const seenFab = new Set();
  ms.forEach((co) => orderFabrics(co).forEach((f) => {
    const k = fkey(f).toUpperCase();
    if (!seenFab.has(k)) { seenFab.add(k); fabrics.push(f); }
  }));
  // Una marcada del grupo queda bloqueada si alguna orden ya la verificó.
  const doneIds = new Set();
  ms.forEach((co) => (Array.isArray(co.markers) ? co.markers : []).forEach((m) => m?.done && doneIds.add(m.id)));
  const markers = (Array.isArray(group.markers) ? group.markers : []).map((m) => ({ ...m, done: doneIds.has(m.id) }));
  const allClosed = ms.length > 0 && ms.every((co) => co.status === "completed" || co.status === "cancelled");
  const dates = ms.map((co) => co.cut_date).filter(Boolean).sort();
  return {
    isGroup: true,
    groupId: group.id,
    groupBy: group.group_by,
    groupKey: group.group_key,
    members: ms,
    id: `G${group.id}`,
    status: allClosed ? "completed" : "pending",
    priority: [...ms].sort(memberSort)[0]?.priority || "normal",
    cut_date: dates[0] || null,
    created_at: group.created_at,
    work_order_no: uniq(ms.map((co) => co.work_order_no)).join(", "),
    customer_name: uniq(ms.map((co) => co.customer_name)).join(", "),
    customer_po: uniq(ms.map((co) => co.customer_po)).join(", "),
    color: uniq(ms.map((co) => co.color)).join(", "),
    season: uniq(ms.map((co) => co.season)).join(", "),
    modelo_code: uniq(ms.map(styleOf)).join(", "),
    item_codes: uniq(ms.flatMap(itemCodesOf)),
    fabric: first.fabric,
    fabric_code: first.fabric_code,
    fabrics,
    master_code_photo_url: first.master_code_photo_url,
    sizes,
    quantity: ms.reduce((s, co) => s + num(co.quantity), 0),
    remaining_to_cut: ms.reduce((s, co) => s + num(co.remaining_to_cut), 0),
    markers,
  };
};

// Reparte las marcadas del grupo entre sus órdenes.
// Por cada talla de cada marcada, los paneles se dan a las órdenes en orden de
// prioridad (luego fecha) hasta cubrir lo que pide cada una; lo que sobra va a
// la última orden que lleva esa talla. Las marcadas verificadas no se tocan:
// cuentan con lo que cada orden ya tiene.
// → Map(cutOrderId → { markers: [...serializadas], byFabric: Map(tela → Map(talla → pzas)) })
// Con varias telas, cada tela cubre el pedido completo de cada orden: lo que
// "falta" se lleva por separado para cada tela. byTalla reporta lo planeado de
// la tela que se pida (byFabric → Map(fabricKey → Map(talla → pzas))).
const allocateGroup = (markers, members, fabricOptions = []) => {
  const ms = [...members].sort(memberSort);
  const fkOf = (m) => markerFabricKey(m, fabricOptions);
  const needs = new Map(); // fabricKey → Map(coId → Map(talla → falta))
  const needFor = (fk) => {
    if (!needs.has(fk)) needs.set(fk, new Map(ms.map((co) => [co.id, new Map(orderSizes(co).map((s) => [s.talla, s.quantity]))])));
    return needs.get(fk);
  };
  const out = new Map(ms.map((co) => [co.id, { markers: [], byFabric: new Map() }]));
  const addPieces = (fk, id, talla, pcs) => {
    const bf = out.get(id).byFabric;
    if (!bf.has(fk)) bf.set(fk, new Map());
    const bt = bf.get(fk);
    bt.set(talla, (bt.get(talla) || 0) + pcs);
    const nd = needFor(fk).get(id);
    if (nd.has(talla)) nd.set(talla, nd.get(talla) - pcs);
  };

  // 1) Lo ya verificado (bloqueado) cuenta primero.
  markers.filter((m) => m.done).forEach((m) => {
    const fk = fkOf(m);
    ms.forEach((co) => {
      const copy = (Array.isArray(co.markers) ? co.markers : []).find((x) => x?.id === m.id);
      (copy?.lines || []).forEach((l) => addPieces(fk, co.id, String(l.talla), num(l.panels) * num(l.perPanel)));
    });
  });

  // 2) Marcadas editables, en el orden en que están.
  markers.filter((m) => !m.done).forEach((m) => {
    const [g] = serializeMarkers([m]);
    const fk = fkOf(m);
    const need = needFor(fk);
    const perMember = new Map(ms.map((co) => [co.id, []]));
    markerLines(m).forEach((l) => {
      const talla = String(l.talla);
      const per = num(l.perPanel);
      let left = Math.round(num(l.panels));
      const takers = ms.filter((co) => need.get(co.id).has(talla));
      takers.forEach((co) => {
        if (left <= 0) return;
        const want = need.get(co.id).get(talla);
        if (want <= 0) return;
        const n = Math.min(left, Math.ceil(want / per));
        left -= n;
        perMember.get(co.id).push({ talla, panels: n, perPanel: per });
        addPieces(fk, co.id, talla, n * per);
      });
      if (left > 0) {
        const co = takers[takers.length - 1] || ms[0];
        const lines = perMember.get(co.id);
        const ex = lines.find((x) => x.talla === talla);
        if (ex) ex.panels += left; else lines.push({ talla, panels: left, perPanel: per });
        addPieces(fk, co.id, talla, left * per);
      }
    });
    ms.forEach((co) => {
      const lines = perMember.get(co.id);
      if (!lines.length) return;
      const panels = lines.reduce((s, x) => s + x.panels, 0);
      const totalPieces = lines.reduce((s, x) => s + x.panels * x.perPanel, 0);
      out.get(co.id).markers.push({
        ...g,
        // Rendimiento y consumo del trazo completo, prorrateado a esta orden.
        yield: g.yield,
        consumo: g.totalPieces > 0 ? (g.consumo * totalPieces) / g.totalPieces : 0,
        panels,
        totalPieces,
        groupPanels: g.panels,
        groupPieces: g.totalPieces,
        done: false,
        completedAt: null,
        lines: lines.map((x) => ({ ...x, pieces: x.panels * x.perPanel })),
      });
    });
  });
  return out;
};

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
  // Pestaña de tela activa (clave fkey). Con varias telas, cada una se planea
  // por el pedido completo; ver markerFabricKey.
  const [fabricTab, setFabricTab] = useState(null);

  // Agrupación
  const [groups, setGroups] = useState([]);
  const [groupMode, setGroupMode] = useState(false);
  const [groupBy, setGroupBy] = useState("style_fabric");
  const [picked, setPicked] = useState([]); // ids de CORTE marcadas para agrupar
  const [grouping, setGrouping] = useState(false);

  // Layout: en pantallas chicas se ve la lista o el editor (uno a la vez).
  const [mobileList, setMobileList] = useState(true);
  const editorRef = useRef(null);
  // Firma de las marcadas tal como se cargaron/guardaron → detecta cambios sin guardar.
  const [baseline, setBaseline] = useState("[]");
  const markersSig = (list) => JSON.stringify(serializeMarkers(list));
  const loadMarkers = (list) => { setMarkers(list); setBaseline(markersSig(list)); };

  useEffect(() => { fetchCutOrders(); }, []);

  // Devuelve { orders, groups } frescos (además de guardarlos en el estado).
  const fetchCutOrders = async () => {
    setLoading(true);
    setError("");
    try {
      const [res, gres] = await Promise.all([
        fetch(`${API_URL}/api/cut-orders`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/cut-groups`, { headers: authHeaders() }).catch(() => null),
      ]);
      const data = await res.json();
      const gdata = gres && gres.ok ? await gres.json() : { cutGroups: [] };
      const orders = data.success ? data.cutOrders || [] : [];
      const grps = gdata.cutGroups || [];
      if (data.success) {
        setCutOrders(orders);
        setGroups(grps);
      } else setError(data.error || "No se pudieron cargar las órdenes de corte");
      return { orders, groups: grps };
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const groupViews = useMemo(() => {
    const map = new Map();
    groups.forEach((g) => {
      const members = cutOrders.filter((co) => Number(co.cut_group_id) === Number(g.id));
      if (members.length) map.set(Number(g.id), buildGroupView(g, members));
    });
    return map;
  }, [groups, cutOrders]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return cutOrders
      .filter((co) => (filter === "open" ? co.status !== "completed" && co.status !== "cancelled" : filter === "completed" ? co.status === "completed" : true))
      .filter((co) => {
        if (!q) return true;
        const hay = `${co.work_order_no} ${co.customer_po || ""} ${co.customer_name || ""} ${co.modelo_code || ""} ${co.style_code || ""} ${co.estilo || ""} ${co.color || ""} ${co.fabric || ""} ${co.fabric_code || ""} ${itemCodesOf(co).join(" ")} ${co.cut_group_id ? groupNo(co.cut_group_id) : ""} ${priorityMeta(co.priority).label}`.toLowerCase();
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

  // Lista que se muestra: las órdenes agrupadas se pliegan en UNA fila de grupo
  // (en la posición de su orden más urgente).
  const rows = useMemo(() => {
    const out = [];
    const shown = new Set();
    filtered.forEach((co) => {
      const gid = Number(co.cut_group_id);
      const view = co.cut_group_id ? groupViews.get(gid) : null;
      if (!view) return out.push({ type: "order", co });
      if (shown.has(gid)) return;
      shown.add(gid);
      out.push({ type: "group", view });
    });
    return out;
  }, [filtered, groupViews]);

  const pickedOrders = useMemo(
    () => picked.map((id) => cutOrders.find((co) => co.id === id)).filter(Boolean),
    [picked, cutOrders]
  );
  const anchorKey = pickedOrders.length ? groupKeyOf(pickedOrders[0], groupBy) : null;

  const togglePick = (co) => {
    if (picked.includes(co.id)) return setPicked((p) => p.filter((id) => id !== co.id));
    if (groupBlockReason(co, groupBy, anchorKey)) return;
    setPicked((p) => [...p, co.id]);
  };

  const startGroupMode = () => { setGroupMode(true); setMobileList(true); setPicked([]); setError(""); setMessage(""); };
  const cancelGroupMode = () => { setGroupMode(false); setPicked([]); };
  const changeGroupBy = (by) => { setGroupBy(by); setPicked([]); };

  const openGroup = (gid, data) => {
    const g = (data?.groups || groups).find((x) => Number(x.id) === Number(gid));
    const members = (data?.orders || cutOrders).filter((co) => Number(co.cut_group_id) === Number(gid));
    if (!g || !members.length) { setSelected(null); return; }
    const view = buildGroupView(g, members);
    const opts = orderFabrics(view);
    const def = findFabric(opts, view.fabric_code) || opts[0] || null;
    const mk = buildMarkers(view);
    setSelected(view);
    setFabricTab(def ? fkey(def) : null);
    loadMarkers(mk.length ? mk : [emptyMarker(view, 0, def)]);
  };

  const createGroup = async () => {
    if (pickedOrders.length < 2) return setError("Elija al menos dos órdenes para agrupar");
    const withPlan = pickedOrders.filter((co) => Array.isArray(co.markers) && co.markers.length > 0);
    if (withPlan.length && !window.confirm(
      `${withPlan.map(cutNo).join(", ")} ya tiene${withPlan.length > 1 ? "n" : ""} marcadas sin verificar. ` +
      "Al agrupar se descartan y se planean de nuevo desde el grupo. ¿Continuar?"
    )) return;
    setGrouping(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/api/cut-groups`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ cutOrderIds: picked, groupBy }),
      });
      const data = await res.json();
      if (!data.success) return setError(data.error || "No se pudo agrupar");
      const fresh = await fetchCutOrders();
      setGroupMode(false);
      setPicked([]);
      openGroup(data.cutGroup.id, fresh);
      revealEditor();
      setMessage(`${groupNo(data.cutGroup.id)} creado con ${data.cutGroup.member_ids.length} órdenes`);
    } catch (err) {
      setError(err.message);
    } finally {
      setGrouping(false);
    }
  };

  const ungroup = async () => {
    if (!selected?.isGroup) return;
    if (!window.confirm(
      `¿Desagrupar ${groupNo(selected.groupId)}? Se borran las marcadas del grupo en cada orden y cada una se planea por separado.`
    )) return;
    setGrouping(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/cut-groups/${selected.groupId}`, { method: "DELETE", headers: authHeaders() });
      const data = await res.json();
      if (!data.success) return setError(data.error || "No se pudo desagrupar");
      await fetchCutOrders();
      setSelected(null);
      loadMarkers([]);
      setMobileList(true);
      setMessage("");
    } catch (err) {
      setError(err.message);
    } finally {
      setGrouping(false);
    }
  };


  const pickOrder = (co) => {
    const opts = orderFabrics(co);
    const def = findFabric(opts, co.fabric_code) || opts[0] || null;
    const mk = buildMarkers(co);
    setSelected(co);
    setFabricTab(def ? fkey(def) : null);
    loadMarkers(mk.length ? mk : [emptyMarker(co, 0, def)]);
    setMessage("");
    setError("");
  };

  const dirty = !!selected && markersSig(markers) !== baseline;

  // Cambiar de orden desde la lista: avisa si hay cambios sin guardar, muestra
  // el editor (en celular) y lo trae a la vista si quedó arriba del scroll.
  const confirmLeave = () =>
    !dirty || window.confirm("Hay cambios sin guardar en esta planeación. ¿Descartarlos y abrir otra orden?");
  const revealEditor = () => {
    setMobileList(false);
    requestAnimationFrame(() => {
      const el = editorRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.6) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const selectOrder = (co) => {
    if (selected && !selected.isGroup && selected.id === co.id) return revealEditor();
    if (!confirmLeave()) return;
    pickOrder(co);
    revealEditor();
  };
  const selectGroup = (gid) => {
    if (selected?.isGroup && selected.groupId === gid) return revealEditor();
    if (!confirmLeave()) return;
    openGroup(gid);
    setMessage("");
    setError("");
    revealEditor();
  };

  const pedido = useMemo(() => (selected ? orderSizes(selected) : []), [selected]);
  const fabricOptions = useMemo(() => (selected ? orderFabrics(selected) : []), [selected]);

  // ---- Telas --------------------------------------------------------------
  const fabricTabs = useMemo(() => fabricTabsOf(fabricOptions, markers), [fabricOptions, markers]);
  const activeTab = fabricTabs.find((t) => t.key === fabricTab) || fabricTabs[0] || null;
  const activeFabric = activeTab ? { code: activeTab.code, name: activeTab.name } : null;
  const multiFabric = fabricTabs.length > 1;
  const inTab = (m) => !multiFabric || !activeTab || markerFabricKey(m, fabricOptions) === activeTab.key;
  // Marcadas de la tela activa: son las que se editan y las que suman al avance.
  const visibleMarkers = useMemo(
    () => markers.filter(inTab),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markers, activeTab?.key, multiFabric, fabricOptions]
  );

  // Avance por tela: cada tela debe cubrir el pedido completo.
  const fabricProgress = useMemo(() => {
    const qtyByTalla = new Map(pedido.map((p) => [String(p.talla), p.quantity]));
    const total = pedido.reduce((a, p) => a + p.quantity, 0);
    return new Map(fabricTabs.map((t) => {
      const list = markers.filter((m) => markerFabricKey(m, fabricOptions) === t.key);
      const byTalla = new Map();
      list.forEach((m) => markerLines(m).forEach((l) => {
        const k = String(l.talla);
        byTalla.set(k, (byTalla.get(k) || 0) + linePieces(l));
      }));
      let covered = 0;
      let planned = 0;
      byTalla.forEach((pcs, k) => { planned += pcs; covered += Math.min(pcs, qtyByTalla.get(k) || 0); });
      return [t.key, {
        markers: list.length,
        planned,
        covered,
        total,
        complete: total > 0 && covered >= total,
        verified: list.length > 0 && list.every((m) => m.done),
      }];
    }));
  }, [fabricTabs, markers, pedido, fabricOptions]);
  const pendingFabrics = fabricTabs.filter((t) => !fabricProgress.get(t.key)?.complete);

  // ---- Marcadas -----------------------------------------------------------
  // Nueva marcada: hereda la tela activa y se numera dentro de esa tela.
  const addMarker = () =>
    setMarkers((ms) => [...ms, emptyMarker(selected, ms.filter(inTab).length, activeFabric)]);

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

  // Piezas por panel de la PRIMERA talla de la marcada: sirve de referencia
  // para autocompletar las demás tallas. (La primera talla es lines[0].)
  const firstPerPanel = (m) => (m.lines[0]?.perPanel ?? "");

  // Al capturar paneles en una talla que NO es la primera y que todavía no
  // tiene piezas por panel, se copia el valor de la primera talla. El usuario
  // puede escribirlo distinto después: sólo autocompletamos cuando está vacío.
  const withInheritedPerPanel = (m, li, line) => {
    if (li === 0) return line;                 // la primera talla es la referencia
    if (num(line.panels) <= 0) return line;    // sin paneles no hay nada que planear
    if (num(line.perPanel) > 0) return line;   // respeta un valor ya capturado
    const ref = firstPerPanel(m);
    if (num(ref) <= 0) return line;            // la primera talla aún no tiene piezas
    return { ...line, perPanel: String(ref) };
  };

  const setMarkerLine = (id, li, field, value) =>
    setMarkers((ms) =>
      ms.map((m) => {
        if (m.id !== id) return m;
        return {
          ...m,
          lines: m.lines.map((l, i) => {
            if (i !== li) return l;
            const next = { ...l, [field]: value };
            // Sólo autocompletamos piezas/panel cuando el cambio es en "paneles".
            return field === "panels" ? withInheritedPerPanel(m, li, next) : next;
          }),
        };
      })
    );

  const bumpLinePanels = (id, li, delta) =>
    setMarkers((ms) =>
      ms.map((m) => {
        if (m.id !== id) return m;
        return {
          ...m,
          lines: m.lines.map((l, i) => {
            if (i !== li) return l;
            const next = { ...l, panels: String(Math.max(0, num(l.panels) + delta)) };
            return withInheritedPerPanel(m, li, next);
          }),
        };
      })
    );

  const cutByTalla = useMemo(() => {
    const map = new Map();
    visibleMarkers.forEach((m) => {
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
  }, [visibleMarkers]);

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
    t.panels = visibleMarkers.reduce((s, m) => s + markerPanels(m), 0);
    t.consumo = visibleMarkers.reduce((s, m) => s + markerConsumo(m), 0);
    return t;
  }, [summary, visibleMarkers]);

  const remainingByTalla = useMemo(
    () => new Map(summary.map((r) => [r.talla, r.remaining])),
    [summary]
  );
  const pedidoByTalla = useMemo(
    () => new Map(summary.map((r) => [r.talla, r.quantity])),
    [summary]
  );

  const verification = useMemo(() => markerVerification(visibleMarkers), [visibleMarkers]);

  // Reparto en vivo de las marcadas del grupo entre sus órdenes.
  const allocation = useMemo(
    () => (selected?.isGroup ? allocateGroup(markers, selected.members, fabricOptions) : null),
    [selected, markers, fabricOptions]
  );

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
      if (selected.isGroup) {
        const alloc = allocateGroup(list, selected.members, fabricOptions);
        const res = await fetch(`${API_URL}/api/cut-groups/${selected.groupId}/plan`, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({
            markers: serializeMarkers(list),
            allocations: selected.members.map((co) => ({
              cutOrderId: co.id,
              markers: alloc.get(co.id)?.markers || [],
            })),
          }),
        });
        const data = await res.json();
        if (!data.success) return setError(data.error || "No se pudo guardar");
        const fresh = await fetchCutOrders();
        openGroup(selected.groupId, fresh);
        setMessage(okMessage);
        return;
      }

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
        if (mk.length) loadMarkers(mk);
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
    if (!markers.some((m) => markerTotal(m) > 0)) {
      return setError("Ingrese los paneles y las piezas por panel de cada marcada");
    }
    const v = markerVerification(markers);
    const msg =
      v.total === 0
        ? "Planeación guardada"
        : v.pending > 0
        ? `Planeación guardada · faltan ${v.pending} marcada${v.pending > 1 ? "s" : ""} por verificar (supervisor de corte)`
        : "Planeación guardada · todas las marcadas ya están verificadas";
    // Con varias telas se puede guardar por partes; se avisa qué tela falta.
    const missing = multiFabric && pendingFabrics.length
      ? ` · falta planear ${pendingFabrics.map((t) => t.code || t.name || "tela").join(", ")} por el pedido completo`
      : "";
    persist(markers, msg + missing);
  };

  // Al terminar una tela, pasar a la siguiente que falte.
  const nextPendingTab = multiFabric
    ? pendingFabrics.find((t) => t.key !== activeTab?.key) || null
    : null;

  const lockedCount = visibleMarkers.filter((m) => m.done).length;

  return (
    <div className="space-y-4">
      {/* Cabecera de la pantalla */}
      <div className="flex items-center gap-2">
        <Layers className="w-5 h-5 text-gray-400" />
        <h1 className="text-lg font-bold text-gray-900">Planeación de marcadas</h1>
        <span className="hidden md:inline text-xs text-gray-500">Arme las marcadas y guarde el corte. La verificación e impresión las hace el supervisor de corte.</span>
      </div>

      {/* Maestro–detalle: lista fija a la izquierda, planeación a la derecha.
          En pantallas chicas se ve una a la vez (lista ↔ editor). */}
      <div className="lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-5 lg:items-start">
      {/* Selector de orden */}
      <aside className={`${mobileList ? "flex" : "hidden"} lg:flex flex-col gap-3 lg:sticky lg:top-[4.5rem] lg:h-[calc(100vh-5.5rem)] min-h-0`}>
        <div className="grid grid-cols-3 rounded-xl bg-gray-100 p-1">
          {[{ id: "open", label: "Por planear" }, { id: "completed", label: "Cortadas" }, { id: "all", label: "Todas" }].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`py-1.5 text-sm rounded-lg transition ${filter === f.id ? "bg-white text-gray-900 font-semibold shadow-sm" : "text-gray-500 hover:text-gray-800"}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text" placeholder="Buscar orden, cliente, estilo, tela…"
              value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 bg-white text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>
          <button
            onClick={fetchCutOrders}
            title="Actualizar"
            aria-label="Actualizar"
            className="shrink-0 w-10 rounded-xl border border-gray-200 bg-white text-gray-500 hover:text-gray-900 hover:bg-gray-50 flex items-center justify-center"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {groupMode && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-2.5 space-y-2">
            <div className="grid grid-cols-2 rounded-lg border border-indigo-200 bg-white p-0.5">
              {Object.entries(GROUP_BY).map(([id, g]) => (
                <button
                  key={id}
                  onClick={() => changeGroupBy(id)}
                  className={`py-1 text-sm rounded-md ${groupBy === id ? "bg-indigo-600 text-white" : "text-indigo-800 hover:bg-indigo-50"}`}
                >
                  {g.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-indigo-900/80">
              {GROUP_BY[groupBy].hint}. Marque las órdenes que se cortan juntas.
            </p>
          </div>
        )}

        {error && (!selected || groupMode) && <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm">{error}</div>}

        <div className="flex-1 min-h-0 flex flex-col rounded-2xl border bg-white shadow-sm overflow-hidden">
          <div className="px-3 py-2 border-b flex items-center gap-2 bg-gray-50/80">
            <span className="text-xs text-gray-500">
              {loading ? "Cargando…" : `${rows.length} ${rows.length === 1 ? "elemento" : "elementos"}`}
            </span>
            <button
              onClick={groupMode ? cancelGroupMode : startGroupMode}
              className={`ml-auto inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg ${groupMode ? "bg-indigo-600 text-white hover:bg-indigo-700" : "text-indigo-700 hover:bg-indigo-50"}`}
            >
              {groupMode ? <X className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
              {groupMode ? "Salir de agrupar" : "Agrupar órdenes"}
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto divide-y">
          {loading && rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">Cargando…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">No hay órdenes de corte.</div>
          ) : (
            rows.map((row) => {
              if (row.type === "group") {
                const v = row.view;
                return (
                  <GroupRow
                    key={`g-${v.groupId}`}
                    view={v}
                    selected={!groupMode && selected?.isGroup && selected.groupId === v.groupId}
                    dimmed={groupMode}
                    onClick={() => { if (!groupMode) selectGroup(v.groupId); }}
                  />
                );
              }
              const co = row.co;
              const isPicked = picked.includes(co.id);
              const block = groupMode && !isPicked ? groupBlockReason(co, groupBy, anchorKey) : null;
              const ics = itemCodesOf(co);
              const meta = displayStatusMeta(co.status, co.markers);
              const pr = priorityMeta(co.priority);
              const isSel = !groupMode && !selected?.isGroup && selected?.id === co.id;
              const estilo = co.modelo_code || co.style_no;
              return (
                <button
                  key={co.id}
                  onClick={() => (groupMode ? togglePick(co) : selectOrder(co))}
                  aria-disabled={!!block}
                  aria-current={isSel ? "true" : undefined}
                  title={block || undefined}
                  className={`w-full text-left px-3 py-2.5 flex gap-2.5 border-l-4 ${pr.accent} ${block ? "opacity-45 cursor-not-allowed" : "hover:bg-gray-50"} ${isSel ? "bg-blue-50 hover:bg-blue-50 ring-1 ring-inset ring-blue-200" : ""} ${isPicked ? "bg-indigo-50 hover:bg-indigo-50" : ""}`}
                >
                  {groupMode && (
                    <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-md border flex items-center justify-center ${isPicked ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-gray-300"}`}>
                      {isPicked && <Check className="w-3.5 h-3.5" />}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${colorForWO(co.work_order_id).dot}`} />
                      <span className="font-mono text-[13px] font-bold text-gray-900">{cutNo(co)}</span>
                      <span className="ml-auto text-[11px] text-gray-400 tabular-nums">{fmtDate(co.cut_date)}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-700 truncate">
                      {[co.customer_name, co.color, estilo && `Est. ${estilo}`].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-[11px] text-gray-400 truncate">
                      {[co.work_order_no, co.customer_po && `PO ${co.customer_po}`, [co.fabric_code, co.fabric].filter(Boolean).join(" "), ics.length && `Item ${ics.join(", ")}`].filter(Boolean).join(" · ")}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                      {co.priority !== "normal" && co.priority && (
                        <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${pr.pill}`}>{pr.label}</span>
                      )}
                      <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${meta.pill}`}>{meta.label}</span>
                      <VerifyPill markers={co.markers} status={co.status} compact />
                      <span className="ml-auto text-[11px] tabular-nums">
                        {num(co.remaining_to_cut) > 0
                          ? <span className="text-amber-600 font-medium">Restan {rnd(co.remaining_to_cut)}</span>
                          : <span className="text-gray-500">{rnd(co.quantity)} pzas</span>}
                      </span>
                    </div>
                    {block && <p className="text-[11px] text-gray-500 mt-1">{block}</p>}
                  </div>
                </button>
              );
            })
          )}
          </div>

          {groupMode && (
            <div className="border-t border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900">
                  {picked.length === 0
                    ? "Marque la primera orden del grupo"
                    : `${picked.length} orden${picked.length > 1 ? "es" : ""} · ${rnd(pickedOrders.reduce((s, co) => s + num(co.quantity), 0))} pzas`}
                </div>
                {pickedOrders.length > 0 && (
                  <div className="text-xs text-gray-500 truncate">
                    {groupBy === "item_code"
                      ? `Item ${itemCodesOf(pickedOrders[0])[0] || "—"}`
                      : `Est. ${styleOf(pickedOrders[0]) || "—"} · Tela ${fabricKeyOf(pickedOrders[0]) || "—"}`}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={cancelGroupMode} className="flex-1 text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50">Cancelar</button>
                <button
                  onClick={createGroup}
                  disabled={picked.length < 2 || grouping}
                  className="flex-[2] inline-flex items-center justify-center gap-1.5 text-sm rounded-lg bg-indigo-600 px-3 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                >
                  <Link2 className="w-4 h-4" /> {grouping ? "Agrupando…" : "Agrupar y planear"}
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Editor de planeación */}
      <section ref={editorRef} className={`${mobileList ? "hidden" : "block"} lg:block min-w-0 scroll-mt-[4.5rem]`}>
        <button
          onClick={() => setMobileList(true)}
          className="lg:hidden mb-3 inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-2 py-1.5 -ml-2 rounded-lg hover:bg-gray-100"
        >
          <ChevronLeft className="w-4 h-4" /> Órdenes
        </button>
        {!selected ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
            <Layers className="w-8 h-8 text-gray-300 mx-auto" />
            <p className="mt-3 font-semibold text-gray-800">Elija una orden de la lista</p>
            <p className="mt-1 text-sm text-gray-500">Sus marcadas aparecen aquí para planearlas sin salir de la pantalla.</p>
          </div>
        ) : (
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="px-5 py-4 border-b flex items-start gap-3">
              <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                {selected.master_code_photo_url ? <img src={selected.master_code_photo_url} alt="" className="w-full h-full object-cover" /> : <Camera className="w-5 h-5 text-gray-300" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-mono font-bold text-gray-900">{selected.isGroup ? groupNo(selected.groupId) : cutNo(selected)}</h2>
                  {selected.isGroup && (
                    <span className="text-[11px] rounded-full px-2 py-0.5 inline-flex items-center gap-1 bg-indigo-100 text-indigo-700">
                      <Link2 className="w-3 h-3" /> {selected.members.length} órdenes · {GROUP_BY[selected.groupBy]?.label || "Grupo"}
                    </span>
                  )}
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
                {selected.isGroup && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {selected.members.map((co) => (
                      <span key={co.id} className="text-[11px] font-mono rounded bg-gray-100 text-gray-700 px-1.5 py-0.5" title={`${co.work_order_no}${co.customer_po ? ` · PO ${co.customer_po}` : ""}`}>
                        {cutNo(co)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {selected.isGroup && (
                <button
                  onClick={ungroup}
                  disabled={grouping}
                  className="shrink-0 inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  <Unlink className="w-4 h-4" /> Desagrupar
                </button>
              )}
            </div>

            <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm border-b">
              {selected.isGroup && selected.groupBy === "item_code"
                ? <Info label="Item code" value={selected.item_codes.join(", ")} />
                : <Info label="PO cliente" value={selected.customer_po} />}
              <Info label="Estilo N°" value={selected.modelo_code || selected.style_no || selected.style_code || selected.estilo} />
              <Info label="Color" value={selected.color} />
              <Info label="Season" value={selected.season} />
              <Info
                label={multiFabric ? "Telas" : "Código de tela"}
                value={multiFabric ? `${fabricTabs.length} telas · ${fabricTabs.length - pendingFabrics.length} completas` : (activeFabric?.code || selected.fabric_code)}
              />
              <Info label={multiFabric ? "Tela en planeación" : "Tela"} value={multiFabric ? [activeFabric?.code, activeFabric?.name].filter(Boolean).join(" ") : (activeFabric?.name || selected.fabric)} />
              <Info label="A cortar" value={`${rnd(selected.quantity)} pzas`} />
              <Info label="Fecha" value={fmtDate(selected.cut_date)} icon={Calendar} />
            </div>

            <div className="p-5 space-y-5">
              {/* Telas: cada una se planea por el pedido completo */}
              {multiFabric && (
                <div>
                  <div className="flex items-baseline justify-between gap-2 mb-2">
                    <h3 className="font-semibold text-gray-900">Telas de la orden</h3>
                    <span className="text-xs text-gray-500">Cada tela se planea por las {rnd(totals.quantity)} pzas del pedido</span>
                  </div>
                  <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3" role="tablist">
                    {fabricTabs.map((t, ti) => {
                      const pr = fabricProgress.get(t.key) || { covered: 0, total: 0, markers: 0 };
                      const on = activeTab?.key === t.key;
                      const pct = pr.total > 0 ? Math.min(Math.round((pr.covered / pr.total) * 100), 100) : 0;
                      return (
                        <button
                          key={t.key}
                          role="tab"
                          aria-selected={on}
                          onClick={() => setFabricTab(t.key)}
                          className={`text-left rounded-xl border px-3 py-2.5 transition ${on ? "border-gray-900 bg-white ring-1 ring-gray-900" : "border-gray-200 bg-gray-50 hover:bg-white"}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`w-5 h-5 shrink-0 rounded-full text-[10px] font-bold flex items-center justify-center ${pr.complete ? "bg-green-600 text-white" : on ? "bg-gray-900 text-white" : "bg-gray-200 text-gray-600"}`}>
                              {pr.complete ? <Check className="w-3 h-3" /> : ti + 1}
                            </span>
                            <span className="font-mono text-sm font-semibold text-gray-900 truncate">{t.code || "(sin código)"}</span>
                            {t.extra && <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-amber-100 text-amber-700" title="Esta tela no está en la orden">fuera de la orden</span>}
                          </div>
                          {t.name && <div className="mt-0.5 text-xs text-gray-500 truncate">{t.name}</div>}
                          <div className="mt-2 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                            <div className={`h-full ${pr.complete ? "bg-green-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} />
                          </div>
                          <div className="mt-1 flex items-center justify-between text-[11px]">
                            <span className={pr.complete ? "text-green-700 font-medium" : pr.markers ? "text-gray-600" : "text-gray-400"}>
                              {pr.complete ? "Completa" : pr.markers ? `${rnd(pr.covered)} / ${rnd(pr.total)} pzas` : "Sin planear"}
                            </span>
                            <span className="text-gray-400">{pr.markers} marcada{pr.markers === 1 ? "" : "s"}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Avance global (planeado) */}
              <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-gray-500">
                      Planeado{multiFabric && activeTab ? <span className="normal-case tracking-normal"> · {activeTab.code || activeTab.name}</span> : null}
                    </div>
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
                    {multiFabric && activeTab && (
                      <span className="text-xs font-mono font-medium rounded-full px-2 py-0.5 bg-slate-100 text-slate-700">{activeTab.code || activeTab.name}</span>
                    )}
                  </h3>
                  <p className="text-xs text-gray-500">
                    {multiFabric ? "Marcadas de esta tela · paneles × pzs/panel de cada talla." : "Paneles × pzs/panel de cada talla del trazo."}
                  </p>
                </div>
                <button onClick={addMarker} className="inline-flex items-center gap-1.5 text-sm rounded-lg bg-gray-900 px-3 py-2 text-white hover:bg-gray-800">
                  <Plus className="w-4 h-4" /> Añadir marcada
                </button>
              </div>

              {visibleMarkers.length === 0 ? (
                <button onClick={addMarker} className="w-full rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 hover:border-gray-400 hover:bg-gray-50">
                  {multiFabric && activeTab
                    ? <>Planee <span className="font-mono font-semibold text-gray-700">{activeTab.code || activeTab.name}</span> por las {rnd(totals.quantity)} pzas del pedido: añada su primera marcada.</>
                    : "Añada la primera marcada para empezar a planear."}
                </button>
              ) : (
                <div className="space-y-4">
                  {visibleMarkers.map((m, mi) => {
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

                          {multiFabric ? (
                            <span className="text-[11px] font-mono rounded-full px-2 py-0.5 bg-slate-100 text-slate-600" title="La tela la define la pestaña de tela">
                              {m.fabricCode || m.fabricName || "(sin código)"}
                            </span>
                          ) : fabricOptions.length > 1 ? (
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

                        {/* Longitud · Eficiencia · Rendimiento · Consumo */}
                        <div className={`px-3 py-2.5 border-b ${locked ? "bg-green-50/40" : "bg-white"}`}>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
                              <span className="block text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Eficiencia (%)</span>
                              {locked ? (
                                <div className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-right text-sm font-semibold text-gray-700">
                                  {m.efficiency !== "" && m.efficiency != null ? `${rnd2(m.efficiency)}%` : "—"}
                                </div>
                              ) : (
                                <input
                                  type="number" min="0" max="100" step="0.01" inputMode="decimal" value={m.efficiency}
                                  onChange={(e) => setMarkerField(m.id, "efficiency", e.target.value)}
                                  onFocus={(e) => e.target.select()}
                                  placeholder="0"
                                  title="Eficiencia del trazo reportada por el software de marcado"
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

                          {/* Comentario de la marcada */}
                          <label className="block mt-2">
                            <span className="block text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Comentario</span>
                            {locked ? (
                              <div className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-sm text-gray-700 min-h-[38px] whitespace-pre-wrap">
                                {m.comment && m.comment.trim() ? m.comment : "—"}
                              </div>
                            ) : (
                              <textarea
                                rows={2} value={m.comment}
                                onChange={(e) => setMarkerField(m.id, "comment", e.target.value)}
                                placeholder="Notas de esta marcada (opcional)…"
                                className="w-full resize-y rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                              />
                            )}
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
                {multiFabric && fabricProgress.get(activeTab?.key)?.complete && nextPendingTab && (
                  <button
                    onClick={() => setFabricTab(nextPendingTab.key)}
                    className="mb-4 w-full flex items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-left hover:bg-green-100"
                  >
                    <span className="text-sm text-green-800">
                      <CheckCircle className="inline w-4 h-4 mr-1 -mt-0.5" />
                      {activeTab.code || activeTab.name} completa. Ahora planee{" "}
                      <span className="font-mono font-semibold">{nextPendingTab.code || nextPendingTab.name}</span> por las {rnd(totals.quantity)} pzas.
                    </span>
                    <ChevronRight className="w-4 h-4 text-green-700 shrink-0" />
                  </button>
                )}
                <h3 className="font-semibold text-gray-900 mb-2">
                  Total por talla
                  {multiFabric && activeTab && <span className="ml-2 text-xs font-mono font-medium text-slate-600">{activeTab.code || activeTab.name}</span>}
                  {selected.isGroup && <span className="ml-2 text-xs font-normal text-gray-500">suma de las {selected.members.length} órdenes del grupo</span>}
                </h3>
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

              {selected.isGroup && allocation && (
                <GroupAllocation
                  members={selected.members}
                  allocation={allocation}
                  tallas={summary.map((r) => r.talla)}
                  fabricKey={activeTab?.key}
                  fabricLabel={multiFabric ? activeTab?.code || activeTab?.name : ""}
                />
              )}

              {error && !groupMode && <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm">{error}</div>}
              {message && <div className="bg-green-50 text-green-700 p-3 rounded-xl text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4" /> {message}</div>}

              {/* Acción única: guardar planeación */}
              <div className="sticky bottom-0 -mx-5 px-5 pt-3 pb-4 bg-white/95 backdrop-blur border-t">
                <div className="flex items-center gap-3">
                  <div className="hidden sm:block min-w-0 text-xs leading-tight">
                    <div className="font-semibold text-gray-900 tabular-nums">{rnd(totals.cut)} / {rnd(totals.quantity)} pzas</div>
                    <div className={dirty ? "text-amber-600" : "text-gray-400"}>{dirty ? "Cambios sin guardar" : "Todo guardado"}</div>
                    {multiFabric && (
                      <div className={pendingFabrics.length ? "text-amber-600" : "text-green-600"}>
                        {pendingFabrics.length ? `Faltan ${pendingFabrics.length} de ${fabricTabs.length} telas` : "Todas las telas completas"}
                      </div>
                    )}
                  </div>
                  <button onClick={handleSave} disabled={saving} className="flex-1 rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
                    {saving
                      ? "Guardando…"
                      : multiFabric
                      ? `Guardar corte · ${fabricTabs.length - pendingFabrics.length} de ${fabricTabs.length} telas completas`
                      : `Guardar corte · ${rnd(totals.cut)} pzas planeadas`}
                  </button>
                </div>
                <p className="mt-2 text-center text-[11px] text-gray-400">
                  {selected.isGroup && "Al guardar, los paneles se reparten entre las órdenes del grupo. "}
                  La verificación de marcadas y la impresión de tickets se hacen en la pantalla del supervisor de corte.
                </p>
              </div>
            </div>
          </div>
        )}
      </section>
      </div>
    </div>
  );
}

/* ======================================================================== */
/* UI atoms (compartibles con CutVerification.jsx)                          */
/* ======================================================================== */
function VerifyPill({ markers, status, compact = false }) {
  const { total, verified, pending } = markerVerification(markers);
  if (total === 0) return null;
  const base = compact
    ? "text-[10px] rounded-full px-1.5 py-0.5 inline-flex items-center gap-1"
    : "text-[11px] rounded-full px-2 py-0.5 inline-flex items-center gap-1";
  if (compact && status !== "completed" && status !== "cancelled") {
    return pending > 0 ? (
      <span className={`${base} bg-amber-100 text-amber-700`} title={`Falta verificar ${pending} marcada${pending > 1 ? "s" : ""}`}>
        <AlertTriangle className="w-3 h-3" /> {pending} sin verificar
      </span>
    ) : (
      <span className={`${base} bg-green-100 text-green-700`} title={`${verified} marcada${verified > 1 ? "s" : ""} verificada${verified > 1 ? "s" : ""}`}>
        <CheckCircle className="w-3 h-3" /> {verified}/{total}
      </span>
    );
  }
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

function GroupRow({ view, selected, dimmed, onClick }) {
  const pr = priorityMeta(view.priority);
  const meta = displayStatusMeta(view.status, view.markers);
  const keyText = view.groupBy === "item_code"
    ? `Item ${view.item_codes.join(", ")}`
    : [view.modelo_code && `Est. ${view.modelo_code}`, [view.fabric_code, view.fabric].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  return (
    <button
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      title={dimmed ? "Los grupos no se pueden volver a agrupar" : undefined}
      className={`w-full text-left px-3 py-2.5 flex gap-2.5 border-l-4 ${pr.accent} ${dimmed ? "opacity-45 cursor-default" : "hover:bg-gray-50"} ${selected ? "bg-blue-50 hover:bg-blue-50 ring-1 ring-inset ring-blue-200" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
          <span className="font-mono text-[13px] font-bold text-gray-900">{groupNo(view.groupId)}</span>
          <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-indigo-100 text-indigo-700">{view.members.length} órdenes</span>
          <span className="ml-auto text-[11px] text-gray-400 tabular-nums">{fmtDate(view.cut_date)}</span>
        </div>
        <p className="mt-0.5 text-xs text-gray-700 truncate">{keyText}</p>
        <p className="text-[11px] text-gray-400 truncate">{view.members.map(cutNo).join(", ")}</p>
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          {view.priority !== "normal" && (
            <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${pr.pill}`}>{pr.label}</span>
          )}
          <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${meta.pill}`}>{meta.label}</span>
          <VerifyPill markers={view.markers} status={view.status} compact />
          <span className="ml-auto text-[11px] text-gray-500 tabular-nums">{rnd(view.quantity)} pzas</span>
        </div>
      </div>
    </button>
  );
}

// Cuánto se lleva cada orden del grupo, por talla (planeado / pedido).
function GroupAllocation({ members, allocation, tallas, fabricKey, fabricLabel }) {
  const ms = [...members].sort(memberSort);
  return (
    <div>
      <h3 className="font-semibold text-gray-900">
        Reparto por orden{fabricLabel && <span className="ml-2 text-xs font-mono font-medium text-slate-600">{fabricLabel}</span>}
      </h3>
      <p className="text-xs text-gray-500 mb-2">
        Los paneles se asignan por prioridad y fecha; lo que sobra de una talla va a la última orden que la lleva.
      </p>
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="text-left font-medium px-3 py-2">Orden</th>
              {tallas.map((t) => (
                <th key={t} className="text-right font-medium px-2 py-2 whitespace-nowrap">
                  {t}{tallaLabel(t) && <span className="ml-1 text-[10px] text-gray-400">{tallaLabel(t)}</span>}
                </th>
              ))}
              <th className="text-right font-medium px-3 py-2">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {ms.map((co) => {
              const ped = new Map(orderSizes(co).map((s) => [s.talla, s.quantity]));
              const got = allocation.get(co.id)?.byFabric.get(fabricKey) || new Map();
              const pedTot = [...ped.values()].reduce((a, b) => a + b, 0);
              const gotTot = [...got.values()].reduce((a, b) => a + b, 0);
              return (
                <tr key={co.id}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="font-mono text-xs font-semibold text-gray-900">{cutNo(co)}</div>
                    <div className="text-[11px] text-gray-500">{co.work_order_no}{co.customer_po ? ` · PO ${co.customer_po}` : ""}</div>
                  </td>
                  {tallas.map((t) => {
                    const q = ped.get(t) || 0;
                    const c = got.get(t) || 0;
                    const tone = !q && !c ? "text-gray-300" : c > q ? "text-red-600" : c < q ? "text-amber-600" : "text-green-600";
                    return (
                      <td key={t} className="px-2 py-2 text-right whitespace-nowrap tabular-nums">
                        {!q && !c ? "—" : (
                          <>
                            <span className={`font-semibold ${tone}`}>{rnd(c)}</span>
                            <span className="text-gray-400"> / {rnd(q)}</span>
                          </>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    <span className="font-semibold text-blue-700">{rnd(gotTot)}</span>
                    <span className="text-gray-400"> / {rnd(pedTot)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
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
    <div className="rounded-lg px-3 py-2 border bg-gray-50 border-gray-100 min-w-0">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5 text-gray-400" />}
        <span className="text-[11px] text-gray-500">{label}</span>
      </div>
      <div className="mt-0.5 text-sm font-semibold text-gray-900 truncate" title={value ? String(value) : undefined}>{value || "—"}</div>
    </div>
  );
}