// components/cutting/CutVerification.jsx
//
// PANTALLA DEL SUPERVISOR DE CORTE (verificación e impresión).
// ------------------------------------------------------------------------
// El supervisor toma las órdenes que el planner ya planeó (marcadas guardadas)
// y verifica cada MARCADA una a una con "Completar marcada". Al verificarla se
// habilita "Imprimir tickets" de esa marcada. Mientras falte alguna se muestra
// "Falta verificar N marcada(s)". Cuando TODAS quedan verificadas, la CORTE
// pasa automáticamente a "Cortada" (y se puede imprimir todo el corte).
//
// Aquí NO se editan paneles/piezas ni se agregan/borran marcadas: eso es de la
// pantalla del planner (CutPlanning.jsx). Los trazos se muestran en SOLO
// LECTURA. Reabrir una marcada la devuelve a edición del planner y regresa la
// CORTE a "En corte".
//
// Archivo autónomo (helpers propios). Los helpers marcados pueden extraerse a
// un `lib/cutting/marcadas.js` compartido con CutPlanning.jsx y el dashboard.
//
import { useState, useEffect, useMemo } from "react";
import {
  Search, RefreshCw, Camera, Calendar, CheckCircle, Printer,
  Layers, AlertTriangle, RotateCcw, ShieldCheck,
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
  // El cortador terminó de capturar piezas pero nadie ha firmado todavía.
  awaiting_verification: { label: "Por verificar", pill: "bg-sky-100 text-sky-700" },
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
const markerTickets = (m) =>
  markerLines(m).reduce((s, l) => s + Math.max(0, Math.round(num(l.panels))), 0);

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
export default function CutVerification() {
  const [cutOrders, setCutOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState("pending");
  const [selected, setSelected] = useState(null);

  const [markers, setMarkers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // TEMP build-check: if you don't see this in the browser console, the app is
  // NOT running this file (stale bundle / wrong-cased duplicate). Remove later.
  useEffect(() => {
    console.log("%cCutVerification: DONE-FILTER build active", "color:#16a34a;font-weight:bold");
    fetchCutOrders();
  }, []);

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

  // Sólo entran a verificación las órdenes que YA tienen marcadas planeadas.
  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return cutOrders
      .filter((co) => Array.isArray(co.markers) && co.markers.length > 0)
      .filter((co) => {
        const v = markerVerification(co.markers);
        if (filter === "pending") return co.status !== "completed" && co.status !== "cancelled" && v.pending > 0;
        if (filter === "verified") return co.status === "completed" || (v.total > 0 && v.pending === 0);
        return true; // all
      })
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
    setSelected(co);
    setMarkers(buildMarkers(co));
    setMessage("");
    setError("");
  };

  const pedido = useMemo(() => (selected ? orderSizes(selected) : []), [selected]);
  const fabricOptions = useMemo(() => (selected ? orderFabrics(selected) : []), [selected]);

  // Consolidado por talla (solo lectura). "Cortado" = SÓLO las marcadas ya
  // verificadas (m.done). Una marcada planeada pero no verificada aún NO cuenta
  // como cortada: no suma al avance ni descuenta del restante hasta que el
  // supervisor pulse "Completar marcada".
  const cutByTalla = useMemo(() => {
    const map = new Map();
    markers.filter((m) => m.done).forEach((m) => {
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
    // Paneles y consumo también reflejan sólo lo verificado, para que el bloque
    // superior cuadre con la tabla "Total por talla".
    t.panels = markers.filter((m) => m.done).reduce((s, m) => s + markerPanels(m), 0);
    t.consumo = markers.filter((m) => m.done).reduce((s, m) => s + markerConsumo(m), 0);
    return t;
  }, [summary, markers]);

  const verification = useMemo(() => markerVerification(markers), [markers]);

  // Progreso por talla a partir de la lista de marcadas recibida (no del memo
  // `summary`, que va un render por detrás al verificar). Sólo cuentan las
  // marcadas verificadas: así `amount_cut`/`remaining_to_cut` que se guardan en
  // el backend coinciden con el "Cortado" que se ve en pantalla.
  const sizeProgressFrom = (list) => {
    const cut = new Map(); // talla → { pieces, panels }
    list.filter((m) => m.done).forEach((m) => {
      markerLines(m).forEach((l) => {
        const key = String(l.talla);
        const cur = cut.get(key) || { pieces: 0, panels: 0 };
        cur.pieces += num(l.panels) * num(l.perPanel);
        cur.panels += num(l.panels);
        cut.set(key, cur);
      });
    });
    const rows = [];
    const seen = new Set();
    pedido.forEach((p) => {
      const agg = cut.get(String(p.talla)) || { pieces: 0, panels: 0 };
      rows.push({
        talla: p.talla,
        quantity: p.quantity,
        panels: agg.panels,
        amountCut: agg.pieces,
        remaining: Math.max(p.quantity - agg.pieces, 0),
      });
      seen.add(String(p.talla));
    });
    cut.forEach((agg, talla) => {
      if (!seen.has(talla)) rows.push({ talla, quantity: 0, panels: agg.panels, amountCut: agg.pieces, remaining: 0 });
    });
    return rows;
  };

  // ---- Persistencia (guarda el estado `done` de las marcadas) -------------
  const persist = async (list, okMessage) => {
    if (!selected) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const body = {
        sizeProgress: sizeProgressFrom(list),
        markers: serializeMarkers(list),
        panels: list.filter((m) => m.done).reduce((s, m) => s + markerPanels(m), 0),
      };

      const res = await fetch(`${API_URL}/api/cut-orders/${selected.id}/cutting`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        if (okMessage) setMessage(okMessage);
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

  const updateStatus = async (status, okMsg) => {
    if (!selected) return false;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/api/cut-orders/${selected.id}/status`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (data.success) {
        if (okMsg) setMessage(okMsg);
        await fetchCutOrders();
        setSelected((s) => (s ? { ...s, status } : s));
        return true;
      }
      setError(data.error || "No se pudo actualizar el estado");
      return false;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Cerrar el corte. PATCH /status ya NO acepta "completed": el único camino
  // a "Cortada" es /verify, que además sella quién verificó y cuándo.
  const verifyOrder = async (okMsg) => {
    if (!selected) return false;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/api/cut-orders/${selected.id}/verify`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ approved: true }),
      });
      const data = await res.json();
      if (data.success) {
        if (okMsg) setMessage(okMsg);
        await fetchCutOrders();
        setSelected((s) => (s ? { ...s, ...data.cutOrder } : s));
        return true;
      }
      setError(data.error || "No se pudo verificar el corte");
      return false;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Verificar una marcada: se cierra y habilita su impresión.
  const completeMarker = async (id) => {
    const m = markers.find((x) => x.id === id);
    if (!m) return;
    if (markerTotal(m) <= 0) {
      return setError("Esta marcada no tiene paneles ni piezas planeadas");
    }
    const next = markers.map((x) =>
      x.id === id ? { ...x, done: true, completedAt: new Date().toISOString() } : x
    );
    setMarkers(next);
    const allDone = next.length > 0 && next.every((x) => x.done);
    await persist(
      next,
      allDone
        ? `${m.name} verificada — no falta ninguna marcada`
        : `${m.name} verificada — ya puede imprimir sus tickets`
    );
    // Verificada la última marcada, la CORTE pasa automáticamente a "Cortada".
    if (allDone && selected?.status !== "completed") {
      await verifyOrder("Todas las marcadas verificadas · corte completado");
    }
  };

  const reopenMarker = async (id) => {
    const next = markers.map((x) => (x.id === id ? { ...x, done: false, completedAt: null } : x));
    setMarkers(next);
    await persist(next, "Marcada reabierta · devuelta al planner");
    // Reabrir invalida la verificación total: la CORTE vuelve a "En corte".
    if (selected?.status === "completed") {
      await updateStatus("in_progress", "Marcada reabierta · corte en proceso");
    }
  };

  const handleComplete = () => {
    const v = markerVerification(markers);
    if (v.total === 0 || v.pending > 0) {
      return setError(`Falta verificar ${v.pending || v.total} marcada${(v.pending || v.total) > 1 ? "s" : ""} antes de completar el corte`);
    }
    verifyOrder("Corte completado");
  };

  // printTicket(co)            → todas las marcadas
  // printTicket(co, marcada)   → sólo esa marcada
  const printTicket = (co, onlyMarker = null) => {
    if (onlyMarker && markerTickets(onlyMarker) <= 0) {
      return setError("Esta marcada no tiene paneles ni piezas para imprimir");
    }
    const esc = (s) => String(s ?? "—").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const estilo = co.modelo_code || co.style_no || co.style_code || co.estilo || co.style_description || "—";

    const pedidoMap = new Map(
      (Array.isArray(co.sizes) ? co.sizes : []).map((s) => [String(s.talla), num(s.quantity)])
    );

    const panelTickets = [];
    const mk = onlyMarker
      ? [{
          name: onlyMarker.name,
          fabricCode: onlyMarker.fabricCode,
          fabricName: onlyMarker.fabricName,
          lines: markerLines(onlyMarker).map((l) => ({
            talla: l.talla, panels: num(l.panels), perPanel: num(l.perPanel),
          })),
        }].filter((m) => m.lines.length > 0)
      : Array.isArray(co.markers) ? co.markers.filter((m) => Array.isArray(m.lines) && m.lines.length) : [];

    if (mk.length) {
      mk.forEach((m) => {
        const mTela =
          [m.fabricCode, m.fabricName].filter(Boolean).join(" ") ||
          [co.fabric_code, co.fabric].filter(Boolean).join(" ") ||
          "—";
        m.lines.forEach((l) => {
          const per = num(l.perPanel);
          const panels = Math.max(0, Math.round(l.panels != null ? num(l.panels) : num(m.panels)));
          if (per <= 0) return;
          const quantity = pedidoMap.get(String(l.talla)) ?? 0;
          if (panels > 0) {
            for (let i = 1; i <= panels; i++) {
              panelTickets.push({ talla: l.talla, quantity, panelNo: i, panelCount: panels, pieces: per, marker: m.name, tela: mTela });
            }
          } else {
            panelTickets.push({ talla: l.talla, quantity, panelNo: null, panelCount: null, pieces: per, marker: m.name, tela: mTela });
          }
        });
      });
    } else {
      const prog = Array.isArray(co.size_progress) && co.size_progress.length
        ? co.size_progress
        : Array.isArray(co.sizes) && co.sizes.length
        ? co.sizes.map((s) => ({ talla: s.talla, quantity: s.quantity, panels: null, perPanel: null, amountCut: null }))
        : [{ talla: "—", quantity: co.quantity, panels: co.panels, perPanel: null, amountCut: co.amount_cut }];

      prog.forEach((r) => {
        const panels = Math.max(0, Math.round(num(r.panels)));
        const perPanel = num(r.perPanel) > 0
          ? num(r.perPanel)
          : panels > 0 && r.amountCut != null
          ? num(r.amountCut) / panels
          : r.amountCut != null
          ? num(r.amountCut)
          : num(r.quantity);
        if (panels > 0) {
          for (let i = 1; i <= panels; i++) {
            panelTickets.push({ talla: r.talla, quantity: r.quantity, panelNo: i, panelCount: panels, pieces: perPanel, marker: null });
          }
        } else {
          panelTickets.push({ talla: r.talla, quantity: r.quantity, panelNo: null, panelCount: null, pieces: perPanel, marker: null });
        }
      });
    }

    const oneTicket = (t) => {
      const panelTag = t.panelCount ? `P${t.panelNo}/${t.panelCount}` : "";
      const panelNum = t.panelCount ? `${t.panelNo} / ${t.panelCount}` : "—";
      const qrData = encodeURIComponent(`${cutNo(co)}|${co.work_order_no || ""}|${co.color || ""}|${t.talla || ""}|${t.marker || ""}|P${t.panelNo || 1}`);
      const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=0&data=${qrData}`;
      const telaTxt = t.tela || [co.fabric_code, co.fabric].filter(Boolean).join(" ") || "—";
      return `
      <div class="ticket">
        <div class="hdr">
          <div class="who">
            <div class="cust">${esc(co.customer_name)}</div>
            <div class="meta">${esc(co.work_order_no)}</div>
          </div>
          <img class="qr" src="${qrSrc}" alt="" onerror="this.style.display='none'" />
        </div>

        <div class="po1"><span class="l">PO cliente</span><span class="v">${esc(co.customer_po || "—")}</span></div>

        <div class="estilo"><span class="k">Estilo</span><span class="v">${esc(estilo)}</span></div>

        <div class="talla">
          <span class="tv">${esc(t.talla)}</span>
          ${tallaLabel(t.talla) ? `<span class="sz">${esc(tallaLabel(t.talla))}</span>` : ""}
        </div>

        <div class="pieces"><span class="pk">Piezas · panel</span><span class="pv">${rnd(t.pieces)}</span></div>

        <div class="grid">
          <div class="c"><span class="l">Color</span><span class="v">${esc(co.color)}</span></div>
          <div class="c"><span class="l">Season</span><span class="v">${esc(co.season || "—")}</span></div>
          <div class="c stack">
            <div><span class="l">Pedido talla</span><span class="v">${rnd(t.quantity)}</span></div>
            <div><span class="l">Panel</span><span class="v">${esc(panelNum)}</span></div>
          </div>
          <div class="c"><span class="l">Marcada</span><span class="v">${esc(t.marker || "—")}</span></div>
          <div class="c wide"><span class="l">Tela</span><span class="v">${esc(telaTxt)}</span></div>
        </div>

        <div class="code">${esc(cutNo(co))} · T${esc(t.talla)}${panelTag ? ` · ${esc(panelTag)}` : ""}</div>
        <div class="foot"><span>${esc(fmtDate(co.cut_date))}</span><span>LineOps</span></div>
      </div>`;
    };

    const tickets = panelTickets.map(oneTicket).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(cutNo(co))}</title>
      <style>
        :root { --ink:#000; --muted:#333; --line:#000; }
        * { box-sizing:border-box; margin:0; padding:0; }
        html,body { background:#e5e7eb; }
        body { font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:var(--ink); padding:8mm 0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }

        /* Etiqueta térmica de 40 mm × 80 mm */
        .ticket {
          width:40mm; height:80mm; padding:1.6mm 2mm; margin:0 auto 8mm;
          background:#fff; overflow:hidden; position:relative;
          display:flex; flex-direction:column; gap:1mm;
        }

        .hdr { display:flex; justify-content:space-between; align-items:flex-start; gap:1mm; }
        .who { flex:1; min-width:0; }
        .cust { font-size:8pt; font-weight:800; line-height:1.05; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .meta { font-family:ui-monospace,Consolas,monospace; font-size:6pt; color:var(--muted); line-height:1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .qr { width:13mm; height:13mm; flex:none; }

        .estilo { display:flex; align-items:baseline; gap:1.5mm; border-top:0.3mm solid var(--line); padding-top:0.8mm; }
        .estilo .k { font-size:6pt; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); flex:none; }
        .estilo .v { font-size:12pt; font-weight:800; line-height:1.05; word-break:break-all; }

        .talla { display:flex; align-items:center; gap:1.8mm; }
        .talla .tv { font-size:13pt; font-weight:700; line-height:1; }
        .talla .sz { font-size:22pt; font-weight:800; line-height:1; border:0.4mm solid var(--line); border-radius:1.2mm; padding:0.2mm 2mm; }

        .pieces { display:flex; align-items:baseline; justify-content:space-between; gap:1mm; border:0.5mm solid var(--line); border-radius:1mm; padding:0.8mm 2mm; }
        .pieces .pk { font-size:6.5pt; text-transform:uppercase; letter-spacing:.05em; }
        .pieces .pv { font-size:19pt; font-weight:800; line-height:1; }

        .po1 { display:flex; align-items:baseline; gap:1.5mm; border-top:0.3mm solid var(--line); padding-top:0.8mm; }
        .po1 .l { font-size:6pt; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); flex:none; }
        .po1 .v { font-size:15pt; font-weight:800; line-height:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

        .grid { display:grid; grid-template-columns:1fr 1fr; gap:0.8mm 2mm; }
        .grid .c { min-width:0; display:flex; flex-direction:column; line-height:1.1; }
        .grid .l { font-size:5.5pt; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
        .grid .c .v { font-size:8pt; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .grid .stack { gap:0.8mm; }
        .grid .stack > div { display:flex; flex-direction:column; line-height:1.1; }
        .grid .wide { grid-column:1 / -1; }
        .grid .wide .v { white-space:normal; overflow:visible; word-break:break-word; }

        .code { margin-top:auto; text-align:center; font-family:ui-monospace,Consolas,monospace; font-size:6.5pt; letter-spacing:.04em; border-top:0.3mm solid var(--line); padding-top:0.6mm; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .foot { display:flex; justify-content:space-between; font-size:5.5pt; color:var(--muted); }

        @page { size:40mm 80mm; margin:0; }
        @media print {
          html,body { background:#fff; }
          body { padding:0; }
          .ticket { margin:0; page-break-after:always; break-after:page; }
          .ticket:last-child { page-break-after:auto; break-after:auto; }
        }
      </style></head>
      <body>
        ${tickets}
        <script>window.onload=function(){window.print();}</script>
      </body></html>`;
    const w = window.open("", "_blank", "width=520,height=860");
    if (!w) { setError("Permita ventanas emergentes para imprimir."); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
  };

  return (
    <div className="space-y-6">
      {/* Cabecera de la pantalla */}
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-gray-400" />
        <h1 className="text-lg font-bold text-gray-900">Verificación de corte</h1>
        {/* TEMP build-check badge — remove once confirmed */}
        <span className="text-[10px] font-mono rounded bg-green-100 text-green-700 px-1.5 py-0.5">build: done-filter</span>
        <span className="text-xs text-gray-500">Verifique cada marcada e imprima sus tickets. Sólo aparecen órdenes ya planeadas.</span>
      </div>

      {/* Selector de orden */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {[{ id: "pending", label: "Por verificar" }, { id: "verified", label: "Verificadas" }, { id: "all", label: "Todas" }].map((f) => (
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
            <div className="p-8 text-center text-gray-500">No hay marcadas por verificar.</div>
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

      {/* Verificación */}
      <div>
        {!selected ? (
          <div className="rounded-2xl border bg-white shadow-sm p-8 text-center text-gray-500">
            Elija una orden planeada para verificar sus marcadas.
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
              <Info label="Tela(s)" value={fabricOptions.map((f) => f.code || f.name).filter(Boolean).join(" + ") || selected.fabric} />
              <Info label="A cortar" value={`${rnd(selected.quantity)} pzas`} />
              <Info label="Rendimiento" value={selected.yield_per_piece != null ? `${num(selected.yield_per_piece)} m/pza` : "—"} />
              <Info label="Fecha" value={fmtDate(selected.cut_date)} icon={Calendar} />
            </div>

            <div className="p-5 space-y-5">
              {/* Avance global */}
              <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-gray-500">Cortado</div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold text-blue-700">{rnd(totals.cut)}</span>
                      <span className="text-sm text-gray-500">/ {rnd(totals.quantity)} pzas</span>
                    </div>
                  </div>
                  <Metric label="Verificadas" value={`${verification.verified}/${verification.total}`} tone={verification.pending > 0 ? "text-amber-600" : "text-green-600"} />
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

              {/* Marcadas (solo lectura + verificación) */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-gray-400" /> Marcadas
                  </h3>
                  <p className="text-xs text-gray-500">Verifique cada trazo e imprima sus tickets por panel.</p>
                </div>
                {verification.pending > 0 ? (
                  <span className="text-[11px] rounded-full px-2 py-0.5 inline-flex items-center gap-1 bg-amber-100 text-amber-700">
                    <AlertTriangle className="w-3 h-3" /> Falta verificar {verification.pending}
                  </span>
                ) : verification.total > 0 ? (
                  <span className="text-[11px] rounded-full px-2 py-0.5 inline-flex items-center gap-1 bg-green-100 text-green-700">
                    <CheckCircle className="w-3 h-3" /> Todas verificadas
                  </span>
                ) : null}
              </div>

              {markers.length === 0 ? (
                <div className="w-full rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
                  Esta orden aún no tiene marcadas planeadas.
                </div>
              ) : (
                <div className="space-y-4">
                  {markers.map((m, mi) => {
                    const panels = markerPanels(m);
                    const tot = markerTotal(m);
                    const consumo = markerConsumo(m);
                    const yieldVal = markerYield(m);
                    const used = markerLines(m).length;
                    const tickets = markerTickets(m);
                    const locked = !!m.done;
                    return (
                      <div key={m.id} className={`rounded-2xl border overflow-hidden ${locked ? "border-green-300" : "border-gray-200"}`}>
                        {/* Header */}
                        <div className={`border-b px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 ${locked ? "bg-green-50" : "bg-gray-50"}`}>
                          <span className={`shrink-0 w-8 h-8 rounded-lg text-white text-xs font-bold flex items-center justify-center ${locked ? "bg-green-600" : "bg-gray-900"}`}>
                            M{mi + 1}
                          </span>
                          <span className="text-sm font-semibold text-gray-900">{m.name}</span>
                          {(m.fabricCode || m.fabricName) && (
                            <span className="text-[11px] rounded-full px-2 py-0.5 bg-slate-100 text-slate-600" title="Tela de la marcada">
                              {[m.fabricCode, m.fabricName].filter(Boolean).join(" · ")}
                            </span>
                          )}
                          <div className="ml-auto text-right leading-tight">
                            <div className="text-base font-bold text-blue-700">{rnd(tot)} <span className="text-xs font-medium text-gray-400">pzas</span></div>
                            <div className="text-[11px] text-gray-500">{rnd(panels)} panel(es) · {used} talla(s)</div>
                          </div>
                        </div>

                        {/* Longitud · Rendimiento · Consumo (solo lectura) */}
                        <div className={`px-3 py-2.5 border-b grid grid-cols-3 gap-2 ${locked ? "bg-green-50/40" : "bg-white"}`}>
                          <div className="block">
                            <span className="block text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Longitud (m)</span>
                            <div className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-right text-sm font-semibold text-gray-700">{rnd2(m.longitud)}</div>
                          </div>
                          <div className="block">
                            <span className="block text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Rendimiento (m/pza)</span>
                            <div className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-right text-sm font-semibold text-gray-700">{rnd2(yieldVal)}</div>
                            <span className="block text-[10px] text-gray-400 mt-0.5 text-right">(long + {TOLERANCE}) ÷ {rnd(panels)} panel(es)</span>
                          </div>
                          <div className="block">
                            <span className="block text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Consumo (m)</span>
                            <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-2 py-2 text-right text-sm font-bold text-blue-700">{rnd2(consumo)}</div>
                            <span className="block text-[10px] text-gray-400 mt-0.5 text-right">(long ÷ {rnd(panels)}) × {rnd(tot)} pzas</span>
                          </div>
                        </div>

                        {/* Tallas del trazo (solo lectura) */}
                        <div className="p-3 grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {markerLines(m).map((l, li) => {
                            const perPanel = num(l.perPanel);
                            const linePanels = num(l.panels);
                            const pieces = linePieces(l);
                            return (
                              <div
                                key={`${m.id}-${l.talla}-${li}`}
                                className="rounded-xl border border-blue-300 bg-blue-50/50 p-2.5"
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
                                  <span className="text-xs font-bold text-blue-700">{rnd(pieces)} pzas</span>
                                </div>
                                <div className="mt-1.5 text-[11px] text-gray-500">
                                  {rnd(linePanels)} panel(es) × {rnd(perPanel)} pzs/panel
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Acciones de la marcada */}
                        <div className={`px-3 py-2.5 border-t flex flex-wrap items-center gap-2 ${locked ? "bg-green-50/60" : "bg-white"}`}>
                          {locked ? (
                            <>
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700">
                                <CheckCircle className="w-4 h-4" /> Marcada verificada
                              </span>
                              <button
                                onClick={() => reopenMarker(m.id)}
                                disabled={saving}
                                className="ml-auto inline-flex items-center gap-1.5 text-sm rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                              >
                                <RotateCcw className="w-4 h-4" /> Reabrir
                              </button>
                              <button
                                onClick={() => printTicket(selected, m)}
                                className="inline-flex items-center gap-1.5 text-sm rounded-lg bg-gray-900 px-3 py-2 font-medium text-white hover:bg-gray-800"
                              >
                                <Printer className="w-4 h-4" /> Imprimir {tickets} ticket(s)
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="text-xs text-gray-400">
                                {tickets > 0 ? `Al verificar se imprimen ${tickets} ticket(s)` : "Sin paneles ni piezas planeadas"}
                              </span>
                              <button
                                onClick={() => completeMarker(m.id)}
                                disabled={saving || tot <= 0}
                                className="ml-auto inline-flex items-center gap-1.5 text-sm rounded-lg bg-green-600 px-3 py-2 font-medium text-white hover:bg-green-700 disabled:opacity-50"
                              >
                                <CheckCircle className="w-4 h-4" /> Completar marcada
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Consolidado por talla (solo lectura) */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Total por talla</h3>
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="text-left font-medium px-3 py-2">Talla</th>
                        <th className="text-right font-medium px-2 py-2">Pedido</th>
                        <th className="text-right font-medium px-2 py-2">Paneles</th>
                        <th className="text-right font-medium px-2 py-2">Cortado</th>
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

              {/* Acciones del corte */}
              <div className="sticky bottom-0 -mx-5 px-5 pt-3 pb-4 bg-white/95 backdrop-blur border-t flex flex-col sm:flex-row gap-2">
                {selected.status === "completed" ? (
                  <button onClick={() => printTicket(selected)} className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50">
                    <Printer className="w-4 h-4" /> Imprimir todas las marcadas
                  </button>
                ) : verification.total === 0 ? (
                  <div className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-400">
                    Esta orden no tiene marcadas por verificar
                  </div>
                ) : verification.pending > 0 ? (
                  <div className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                    <AlertTriangle className="w-4 h-4" /> Falta verificar {verification.pending} marcada{verification.pending > 1 ? "s" : ""}
                  </div>
                ) : (
                  <button onClick={handleComplete} disabled={saving} className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
                    <CheckCircle className="w-4 h-4" /> Completar corte
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ======================================================================== */
/* UI atoms (compartibles con CutPlanning.jsx)                              */
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