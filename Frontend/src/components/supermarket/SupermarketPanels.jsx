// components/supermarket/SupermarketPanels.jsx
//
// Pestaña "Paneles" del supermercado.
// ------------------------------------------------------------------------
// Muestra, por cada ORDEN DE CORTE ya COMPLETADA ("Cortada"), cuántos PANELES
// hay que surtir, desglosados por MARCADA y por TALLA, junto con el COLOR y la
// TELA. Es solo lectura: el supermercado usa esto para preparar el material que
// el corte ya dejó firme.
//
// FUENTE DE DATOS
// ---------------
// Viene de /api/cut-orders (la MISMA fuente que la pantalla de verificación de
// corte, CutVerification.jsx). No usa el snapshot semanal del plan: aquí importa
// lo que YA se cortó, no lo que se planeó para la semana. Por eso este tab trae
// sus propios datos y no depende de los props compartidos de SupermarketPage.
//
// QUÉ ENTRA
// ---------
// Toda MARCADA VERIFICADA (m.done) de cualquier orden no cancelada. Una marcada
// se verifica en corte con "Completar marcada"; en ese momento su material queda
// comprometido y el supermercado ya lo puede surtir, AUNQUE la CORTE completa no
// haya pasado todavía a "Cortada" (cerrar el corte lo firma el supervisor, que
// suele ser otro rol/permiso). Si la orden sí llegó a status "completed", se
// incluyen todas sus marcadas por si alguna quedara sin el flag `done`.
//
// Los helpers de marcadas son un espejo de CutVerification.jsx (candidatos a un
// lib/cutting/marcadas.js compartido) para que los números de paneles cuadren
// exactamente con lo que el supervisor de corte vio al verificar.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Search, RefreshCw, Calendar, Package, AlertTriangle, ChevronLeft, Scissors } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";
import { colorForWO } from "../../lib/workOrderColors";

/* ======================================================================== */
/* Helpers (espejo de CutVerification.jsx)                                  */
/* ======================================================================== */
const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});
const num = (v) => Number(v) || 0;
const uid = () => Math.random().toString(36).slice(2, 9);
const rnd = (v) => Math.round(num(v)).toLocaleString();

const SIZE_LABELS = {
  "130": "XXXS", "132": "XXS", "134": "XS", "136": "S", "138": "M",
  "140": "L", "142": "XL", "144": "XXL",
  "004": "I-XS", "006": "S", "008": "M", "010": "L",
};
const tallaLabel = (talla) => {
  if (talla == null) return "";
  return SIZE_LABELS[String(talla).trim().toUpperCase()] || "";
};

const fmtDate = (v) => {
  if (!v) return "—";
  const s = typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v;
  const [y, m, d] = String(s).split("-");
  return d ? `${d}/${m}/${y}` : String(s);
};

const cutNo = (co) => `CORTE-${String(co.id).padStart(4, "0")}`;

// "Cortada" = la orden completa ya la firmó el supervisor. Cualquier otro estado
// (con marcadas verificadas) se muestra como parcial: los paneles ya cuentan,
// pero el corte aún puede reabrirse.
const orderStatusMeta = (status) =>
  status === "completed"
    ? { label: "Cortada", pill: "bg-green-100 text-green-700" }
    : { label: "Marcadas verificadas", pill: "bg-amber-100 text-amber-700" };

const orderSizes = (co) =>
  Array.isArray(co?.sizes) && co.sizes.length
    ? co.sizes.map((s) => ({ talla: String(s.talla), quantity: num(s.quantity) }))
    : [{ talla: "—", quantity: num(co?.quantity) }];

// Normaliza las marcadas al mismo shape que usa la verificación de corte,
// tolerando el formato viejo (m.panels global) y el nuevo (m.lines por talla).
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
      done: !!m.done,
      lines,
    };
  });
};

const linePieces = (l) => num(l.panels) * num(l.perPanel);
const markerLines = (m) => m.lines.filter((l) => num(l.panels) > 0 && num(l.perPanel) > 0);

// Tela de la marcada, con respaldo a la tela de la orden.
const markerTela = (m, co) =>
  [m.fabricCode, m.fabricName].filter(Boolean).join(" · ") ||
  [co?.fabric_code, co?.fabric].filter(Boolean).join(" · ") ||
  "—";

/* ======================================================================== */
/* Componente                                                               */
/* ======================================================================== */

// Tallas en orden de talla (130 < 132 < … ; las no numéricas al final).
const sortTallas = (list) =>
  [...list].sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    if (Number.isFinite(na)) return -1;
    if (Number.isFinite(nb)) return 1;
    return String(a).localeCompare(String(b));
  });

const STATUS_FILTERS = [
  { v: "all", label: "Todas" },
  { v: "completed", label: "Cortadas" },
  { v: "partial", label: "Marcadas verificadas" },
];

/* ======================================================================== */
/* Componente                                                               */
/* ======================================================================== */
// Diseño maestro–detalle: a la izquierda la lista de cortes (compacta, se
// recorre con ↑/↓), a la derecha el detalle del corte elegido. El desglose es
// una matriz Marcada × Talla, así un corte completo cabe en pantalla sin
// desplazarse. En móvil la lista y el detalle se alternan.
export default function SupermarketPanels() {
  const [cutOrders, setCutOrders] = useState([]);
  const [loading, setLoading] = useState(true);   // sólo la primera carga tapa la pantalla
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [mobileDetail, setMobileDetail] = useState(false);

  const load = useCallback(async ({ initial = false } = {}) => {
    if (initial) setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/cut-orders`, { headers: authHeaders() });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "No se pudieron cargar las órdenes de corte");
      }
      setCutOrders(Array.isArray(json.cutOrders) ? json.cutOrders : []);
    } catch (err) {
      setError(err.message);
      // Al refrescar conservamos lo que ya se veía; sólo la primera carga limpia.
      if (initial) setCutOrders([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load({ initial: true }); }, [load]);

  // Paneles a surtir. Una marcada cuenta en cuanto queda VERIFICADA (m.done),
  // sin esperar a que la CORTE entera pase a "Cortada". Cuando la orden sí
  // llegó a "completed", todas sus marcadas cuentan.
  const orders = useMemo(() => {
    return cutOrders
      .filter((co) => co.status !== "cancelled" && Array.isArray(co.markers) && co.markers.length > 0)
      .map((co) => {
        const completedOrder = co.status === "completed";
        const markers = buildMarkers(co)
          .filter((m) => completedOrder || m.done)
          .map((m) => {
            const lines = markerLines(m).map((l) => ({
              talla: l.talla,
              panels: num(l.panels),
              perPanel: num(l.perPanel),
              pieces: linePieces(l),
            }));
            return {
              id: m.id,
              name: m.name,
              tela: markerTela(m, co),
              panels: lines.reduce((s, l) => s + l.panels, 0),
              pieces: lines.reduce((s, l) => s + l.pieces, 0),
              lines,
            };
          })
          .filter((m) => m.lines.length > 0);
        return {
          id: co.id,
          cutNo: cutNo(co),
          status: co.status,
          completedOrder,
          workOrderNo: co.work_order_no,
          workOrderId: co.work_order_id,
          customerPo: co.customer_po,
          customerName: co.customer_name,
          estilo: co.modelo_code || co.style_no || co.style_code || co.estilo,
          color: co.color,
          cutDate: co.cut_date,
          markers,
          panels: markers.reduce((s, m) => s + m.panels, 0),
          pieces: markers.reduce((s, m) => s + m.pieces, 0),
        };
      })
      .filter((o) => o.markers.length > 0)
      .sort((a, b) => {
        // Más recientes primero (por fecha de corte, luego por id).
        const da = a.cutDate ? new Date(`${String(a.cutDate).slice(0, 10)}T00:00:00`).getTime() : -Infinity;
        const db = b.cutDate ? new Date(`${String(b.cutDate).slice(0, 10)}T00:00:00`).getTime() : -Infinity;
        if (da !== db) return db - da;
        return b.id - a.id;
      });
  }, [cutOrders]);

  const statusCounts = useMemo(() => ({
    all: orders.length,
    completed: orders.filter((o) => o.completedOrder).length,
    partial: orders.filter((o) => !o.completedOrder).length,
  }), [orders]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter === "completed" && !o.completedOrder) return false;
      if (statusFilter === "partial" && o.completedOrder) return false;
      if (!needle) return true;
      const hay = `${o.cutNo} ${o.workOrderNo || ""} ${o.customerPo || ""} ${o.customerName || ""} ${o.estilo || ""} ${o.color || ""} ${o.markers.map((m) => `${m.name} ${m.tela}`).join(" ")}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [orders, q, statusFilter]);

  const totalPanels = useMemo(() => shown.reduce((s, o) => s + o.panels, 0), [shown]);

  // La selección siempre apunta a un corte visible: si el filtro lo esconde o
  // el refresco lo quita, pasamos al primero de la lista.
  useEffect(() => {
    if (!shown.length) { setSelectedId(null); return; }
    if (!shown.some((o) => o.id === selectedId)) setSelectedId(shown[0].id);
  }, [shown, selectedId]);

  const selected = shown.find((o) => o.id === selectedId) || null;

  // Las dos columnas llenan el alto de la ventana y se desplazan por dentro,
  // así el detalle nunca se va de la vista mientras se recorre la lista.
  const shellRef = useRef(null);
  const [shellH, setShellH] = useState(null);
  useEffect(() => {
    const measure = () => {
      if (!shellRef.current) return;
      const top = shellRef.current.getBoundingClientRect().top + window.scrollY;
      setShellH(Math.max(window.innerHeight - top - 16, 420));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [loading, error]);

  const itemRefs = useRef(new Map());
  const selectAt = (idx) => {
    const o = shown[Math.max(0, Math.min(idx, shown.length - 1))];
    if (!o) return;
    setSelectedId(o.id);
    itemRefs.current.get(o.id)?.scrollIntoView({ block: "nearest" });
  };
  const onListKey = (e) => {
    const idx = shown.findIndex((o) => o.id === selectedId);
    if (e.key === "ArrowDown") { e.preventDefault(); selectAt(idx + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); selectAt(idx - 1); }
    else if (e.key === "Home") { e.preventDefault(); selectAt(0); }
    else if (e.key === "End") { e.preventDefault(); selectAt(shown.length - 1); }
    else if (e.key === "Enter") setMobileDetail(true);
  };

  /* ---- estados de carga / error ---------------------------------------- */
  if (loading) {
    return (
      <div className="rounded-2xl border bg-white shadow-sm p-10 text-center text-gray-500">
        <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin text-gray-400" />
        Cargando paneles…
      </div>
    );
  }

  if (error && orders.length === 0) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 shadow-sm p-6 text-center">
        <AlertTriangle className="w-5 h-5 mx-auto mb-2 text-red-500" />
        <p className="text-sm text-red-700 mb-3">{error}</p>
        <button
          onClick={() => load({ initial: true })}
          className="inline-flex items-center gap-1.5 text-sm rounded-lg bg-red-600 px-3 py-2 font-medium text-white hover:bg-red-700"
        >
          <RefreshCw className="w-4 h-4" /> Reintentar
        </button>
      </div>
    );
  }

  /* ---- vista ------------------------------------------------------------ */
  return (
    <div className="space-y-3">
      {error && orders.length > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> No se pudo actualizar ({error}). Se muestra la última carga.
        </div>
      )}

      <div
        ref={shellRef}
        className="rounded-2xl border bg-white shadow-sm overflow-hidden grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)]"
        style={shellH ? { height: shellH } : undefined}
      >
        {/* ---------------- Lista de cortes ---------------- */}
        <section
          className={`min-h-0 flex-col border-r border-gray-200 ${mobileDetail ? "hidden lg:flex" : "flex"}`}
          aria-label="Cortes con paneles a surtir"
        >
          <div className="p-3 border-b border-gray-200 space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }}
                  placeholder="Buscar corte, PO, color, tela…"
                  aria-label="Buscar cortes"
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 pl-8 pr-3 py-2 text-sm outline-none focus:border-gray-400 focus:bg-white"
                />
              </div>
              <button
                onClick={() => load()}
                disabled={refreshing}
                title="Actualizar"
                aria-label="Actualizar"
                className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>

            <div className="flex bg-gray-100 rounded-lg p-0.5" role="group" aria-label="Filtrar por estado">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.v}
                  onClick={() => setStatusFilter(f.v)}
                  aria-pressed={statusFilter === f.v}
                  className={`flex-1 h-7 px-2 text-xs whitespace-nowrap rounded-md transition ${
                    statusFilter === f.v ? "bg-white shadow-sm text-gray-900 font-semibold" : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {f.label} <span className="text-gray-400 tabular-nums">{statusCounts[f.v]}</span>
                </button>
              ))}
            </div>

            <p className="text-xs text-gray-500 flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-gray-400" />
              {shown.length} {shown.length === 1 ? "corte" : "cortes"} · {rnd(totalPanels)} paneles a surtir
            </p>
          </div>

          {shown.length === 0 ? (
            <div className="flex-1 p-6 text-center text-sm text-gray-500">
              {orders.length === 0
                ? "Aún no hay marcadas verificadas. Los paneles aparecen aquí en cuanto corte completa una marcada."
                : "Ningún corte coincide con la búsqueda o el filtro."}
            </div>
          ) : (
            <ul
              role="listbox"
              tabIndex={0}
              aria-label="Cortes"
              aria-activedescendant={selectedId != null ? `corte-${selectedId}` : undefined}
              onKeyDown={onListKey}
              className="flex-1 min-h-0 overflow-y-auto divide-y divide-gray-100 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-400"
            >
              {shown.map((o) => {
                const on = o.id === selectedId;
                const st = orderStatusMeta(o.status);
                return (
                  <li
                    key={o.id}
                    id={`corte-${o.id}`}
                    role="option"
                    aria-selected={on}
                    ref={(el) => { if (el) itemRefs.current.set(o.id, el); else itemRefs.current.delete(o.id); }}
                    onClick={() => { setSelectedId(o.id); setMobileDetail(true); }}
                    className={`relative cursor-pointer px-4 py-3 ${on ? "bg-gray-100" : "hover:bg-gray-50"}`}
                  >
                    {on && <span className="absolute left-0 inset-y-0 w-1 bg-gray-900" aria-hidden="true" />}
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorForWO(o.workOrderId).dot}`} />
                      <span className="font-mono text-sm font-bold text-gray-900">{o.cutNo}</span>
                      <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${st.pill}`}>{st.label}</span>
                      <span className="ml-auto text-right leading-none">
                        <span className="text-base font-bold tabular-nums text-blue-700">{rnd(o.panels)}</span>
                        <span className="text-[11px] text-gray-400 ml-1">pan.</span>
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-gray-600 truncate pl-[18px]">
                      {[o.estilo, o.customerPo && `PO ${o.customerPo}`, o.customerName].filter(Boolean).join(" · ") || o.workOrderNo || "—"}
                    </div>
                    <div className="mt-1 flex items-center gap-2 pl-[18px] text-[11px] text-gray-500">
                      {o.color && <span className="rounded bg-indigo-50 text-indigo-700 px-1.5 py-0.5">Color {o.color}</span>}
                      <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" />{fmtDate(o.cutDate)}</span>
                      <span className="ml-auto tabular-nums">{rnd(o.pieces)} pzas · {o.markers.length} M</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ---------------- Detalle del corte ---------------- */}
        <section
          className={`min-h-0 overflow-y-auto ${mobileDetail ? "block" : "hidden lg:block"}`}
          aria-label="Detalle del corte"
        >
          {selected ? (
            <CutDetail order={selected} onBack={() => setMobileDetail(false)} />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-10 text-sm text-gray-500">
              <Scissors className="w-8 h-8 text-gray-300 mb-2" />
              Elija un corte de la lista para ver sus paneles por marcada y talla.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ======================================================================== */
/* Detalle: encabezado + matriz Marcada × Talla                             */
/* ======================================================================== */
function CutDetail({ order: o, onBack }) {
  const st = orderStatusMeta(o.status);
  const tallas = useMemo(
    () => sortTallas([...new Set(o.markers.flatMap((m) => m.lines.map((l) => String(l.talla))))]),
    [o]
  );
  // Totales por talla (fila de pie de la matriz).
  const byTalla = useMemo(() => {
    const m = new Map();
    o.markers.forEach((mk) => mk.lines.forEach((l) => {
      const k = String(l.talla);
      const cur = m.get(k) || { panels: 0, pieces: 0 };
      m.set(k, { panels: cur.panels + l.panels, pieces: cur.pieces + l.pieces });
    }));
    return m;
  }, [o]);
  // Paneles por tela: es lo que el supermercado va a buscar al almacén.
  const byTela = useMemo(() => {
    const m = new Map();
    o.markers.forEach((mk) => {
      const cur = m.get(mk.tela) || { panels: 0, pieces: 0, markers: 0 };
      m.set(mk.tela, { panels: cur.panels + mk.panels, pieces: cur.pieces + mk.pieces, markers: cur.markers + 1 });
    });
    return [...m.entries()];
  }, [o]);
  const singleTela = byTela.length === 1 ? byTela[0][0] : null;

  return (
    <div className="p-5 lg:p-6">
      <button
        onClick={onBack}
        className="lg:hidden mb-3 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
      >
        <ChevronLeft className="w-4 h-4" /> Cortes
      </button>

      {/* Encabezado */}
      <header className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`w-3 h-3 rounded-full shrink-0 ${colorForWO(o.workOrderId).dot}`} />
            <h2 className="font-mono text-xl font-bold text-gray-900">{o.cutNo}</h2>
            <span className={`text-xs rounded-full px-2 py-0.5 ${st.pill}`}>{st.label}</span>
          </div>
          <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
            <Field k="Orden" v={o.workOrderNo} mono />
            <Field k="PO cliente" v={o.customerPo} />
            <Field k="Cliente" v={o.customerName} />
            <Field k="Estilo" v={o.estilo} />
            <Field k="Color" v={o.color} strong />
            <Field k="Fecha de corte" v={fmtDate(o.cutDate)} />
            {singleTela && <Field k="Tela" v={singleTela} wide />}
          </dl>
        </div>

        <dl className="flex gap-6 shrink-0">
          <div className="text-right">
            <dd className="text-3xl font-bold tabular-nums text-blue-700 leading-none">{rnd(o.panels)}</dd>
            <dt className="text-xs text-gray-500 mt-1">paneles</dt>
          </div>
          <div className="text-right">
            <dd className="text-3xl font-bold tabular-nums text-gray-900 leading-none">{rnd(o.pieces)}</dd>
            <dt className="text-xs text-gray-500 mt-1">piezas</dt>
          </div>
          <div className="text-right">
            <dd className="text-3xl font-bold tabular-nums text-gray-400 leading-none">{o.markers.length}</dd>
            <dt className="text-xs text-gray-500 mt-1">{o.markers.length === 1 ? "marcada" : "marcadas"}</dt>
          </div>
        </dl>
      </header>

      {/* Matriz */}
      <div className="mt-5 rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-500 border-b border-gray-200">
              <th scope="col" className="text-left font-medium px-4 py-2.5 min-w-[180px]">Marcada</th>
              {tallas.map((t) => (
                <th key={t} scope="col" className="font-medium px-3 py-2.5 text-center whitespace-nowrap">
                  <span className="text-gray-900 font-semibold">{t}</span>
                  {tallaLabel(t) && <span className="block text-[10px] text-blue-700 font-semibold leading-none mt-0.5">{tallaLabel(t)}</span>}
                </th>
              ))}
              <th scope="col" className="font-medium px-3 py-2.5 text-right border-l border-gray-200">Paneles</th>
              <th scope="col" className="font-medium px-4 py-2.5 text-right">Piezas</th>
            </tr>
          </thead>
          <tbody>
            {o.markers.map((m, mi) => {
              const lineOf = new Map(m.lines.map((l) => [String(l.talla), l]));
              return (
                <tr key={m.id} className="border-b border-gray-100 last:border-0">
                  <th scope="row" className="text-left font-normal px-4 py-3 align-top">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 shrink-0 rounded-md bg-gray-900 text-white text-[11px] font-bold flex items-center justify-center">
                        M{mi + 1}
                      </span>
                      <span className="font-semibold text-gray-900">{m.name}</span>
                    </div>
                    {!singleTela && (
                      <div className="mt-1 pl-8 text-xs text-gray-500" title="Tela de la marcada">{m.tela}</div>
                    )}
                  </th>
                  {tallas.map((t) => {
                    const l = lineOf.get(t);
                    return (
                      <td
                        key={t}
                        className="px-3 py-3 text-center tabular-nums"
                        title={l ? `${l.panels} panel(es) × ${l.perPanel} pzas = ${l.pieces} pzas` : undefined}
                      >
                        {l ? (
                          <>
                            <span className="block text-base font-bold text-blue-700 leading-none">{rnd(l.panels)}</span>
                            <span className="block text-[11px] text-gray-500 mt-1">{rnd(l.pieces)} pzas</span>
                          </>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-3 text-right tabular-nums font-bold text-gray-900 border-l border-gray-200">{rnd(m.panels)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{rnd(m.pieces)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 border-t border-gray-200 font-semibold">
              <th scope="row" className="text-left px-4 py-2.5 text-gray-900">Total del corte</th>
              {tallas.map((t) => {
                const v = byTalla.get(t);
                return (
                  <td key={t} className="px-3 py-2.5 text-center tabular-nums">
                    <span className="block text-blue-700">{rnd(v?.panels)}</span>
                    <span className="block text-[11px] font-normal text-gray-500">{rnd(v?.pieces)}</span>
                  </td>
                );
              })}
              <td className="px-3 py-2.5 text-right tabular-nums text-blue-700 border-l border-gray-200">{rnd(o.panels)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">{rnd(o.pieces)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Cada casilla muestra paneles y, debajo, las piezas que salen de ellos. Pase el cursor para ver piezas por panel.
      </p>

      {/* Por tela (sólo si las marcadas usan telas distintas) */}
      {!singleTela && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Paneles por tela</h3>
          <ul className="flex flex-wrap gap-2">
            {byTela.map(([tela, v]) => (
              <li key={tela} className="rounded-lg border border-gray-200 px-3 py-2">
                <div className="text-sm font-medium text-gray-900">{tela}</div>
                <div className="text-xs text-gray-500 tabular-nums">
                  <span className="font-semibold text-blue-700">{rnd(v.panels)} paneles</span> · {rnd(v.pieces)} pzas · {v.markers} {v.markers === 1 ? "marcada" : "marcadas"}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Field({ k, v, mono = false, strong = false, wide = false }) {
  return (
    <div className={wide ? "col-span-2 sm:col-span-3" : ""}>
      <dt className="text-xs text-gray-500">{k}</dt>
      <dd className={`text-gray-900 truncate ${mono ? "font-mono" : ""} ${strong ? "font-semibold" : ""}`}>{v || "—"}</dd>
    </div>
  );
}