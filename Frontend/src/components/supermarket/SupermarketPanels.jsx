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
// Sólo las órdenes con status === "completed" y con marcadas guardadas. Dentro
// de una orden completada todas las marcadas están verificadas, así que todas
// cuentan.
//
// Los helpers de marcadas son un espejo de CutVerification.jsx (candidatos a un
// lib/cutting/marcadas.js compartido) para que los números de paneles cuadren
// exactamente con lo que el supervisor de corte vio al verificar.

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { Search, RefreshCw, Layers, Calendar, Package, AlertTriangle } from "lucide-react";
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
export default function SupermarketPanels() {
  const [cutOrders, setCutOrders] = useState([]);
  const [loading, setLoading] = useState(true);   // sólo la primera carga tapa la pantalla
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");

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
      // Al refrescar conservamos lo que ya se veía en vez de dejar la pantalla en
      // blanco; sólo la primera carga limpia.
      if (initial) setCutOrders([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load({ initial: true }); }, [load]);

  // Sólo órdenes CORTADAS con marcadas. Se arma el desglose de paneles por
  // marcada y por talla.
  const orders = useMemo(() => {
    return cutOrders
      .filter((co) => co.status === "completed" && Array.isArray(co.markers) && co.markers.length > 0)
      .map((co) => {
        const markers = buildMarkers(co)
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

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((o) => {
      const hay = `${o.cutNo} ${o.workOrderNo || ""} ${o.customerPo || ""} ${o.customerName || ""} ${o.estilo || ""} ${o.color || ""} ${o.markers.map((m) => `${m.name} ${m.tela}`).join(" ")}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [orders, q]);

  const totalPanels = useMemo(() => shown.reduce((s, o) => s + o.panels, 0), [shown]);

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
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="rounded-2xl border bg-white shadow-sm p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-gray-400" />
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Paneles a surtir</h2>
            <p className="text-xs text-gray-500">
              {shown.length} orden(es) cortada(s) · {rnd(totalPanels)} panel(es)
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar corte, PO, color, tela…"
              className="w-56 sm:w-72 rounded-lg border border-gray-200 bg-gray-50 pl-8 pr-3 py-2 text-sm outline-none focus:border-gray-400 focus:bg-white"
            />
          </div>
          <button
            onClick={() => load()}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 text-sm rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} /> Actualizar
          </button>
        </div>
      </div>

      {/* Aviso de refresco fallido sin perder lo ya cargado */}
      {error && orders.length > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> No se pudo actualizar ({error}). Se muestra la última carga.
        </div>
      )}

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
          {orders.length === 0
            ? "Aún no hay órdenes cortadas con marcadas. Aquí aparecerán los paneles en cuanto el corte complete una orden."
            : "Ninguna orden coincide con la búsqueda."}
        </div>
      ) : (
        shown.map((o) => (
          <div key={o.id} className="rounded-2xl border bg-white shadow-sm overflow-hidden">
            {/* Encabezado de la orden */}
            <div className="px-4 py-3 border-b bg-gray-50/70 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorForWO(o.workOrderId).dot}`} />
              <span className="font-mono text-sm font-bold text-gray-900">{o.cutNo}</span>
              <span className="text-xs text-gray-500 truncate">
                {o.workOrderNo}
                {o.customerPo ? ` · PO ${o.customerPo}` : ""}
                {o.customerName ? ` · ${o.customerName}` : ""}
                {o.estilo ? ` · Est. ${o.estilo}` : ""}
              </span>
              {o.color && (
                <span className="text-[11px] rounded-full px-2 py-0.5 bg-indigo-50 text-indigo-700">
                  Color: {o.color}
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                <Calendar className="w-3 h-3" /> {fmtDate(o.cutDate)}
              </span>
              <div className="ml-auto text-right leading-tight">
                <div className="text-base font-bold text-blue-700">
                  {rnd(o.panels)} <span className="text-xs font-medium text-gray-400">panel(es)</span>
                </div>
                <div className="text-[11px] text-gray-500">
                  {rnd(o.pieces)} pzas · {o.markers.length} marcada(s)
                </div>
              </div>
            </div>

            {/* Desglose por marcada y talla */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-gray-500">
                  <tr className="border-b">
                    <th className="text-left font-medium px-4 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-gray-400" /> Marcada / Tela
                      </span>
                    </th>
                    <th className="text-left font-medium px-3 py-2">Talla</th>
                    <th className="text-right font-medium px-3 py-2">Paneles</th>
                    <th className="text-right font-medium px-4 py-2">Piezas</th>
                  </tr>
                </thead>
                <tbody>
                  {o.markers.map((m, mi) => (
                    <Fragment key={m.id}>
                      {/* Subencabezado de la marcada (con su subtotal) */}
                      <tr className="bg-gray-50/60 border-b">
                        <td className="px-4 py-2" colSpan={2}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="w-6 h-6 rounded-md bg-gray-900 text-white text-[11px] font-bold flex items-center justify-center">
                              M{mi + 1}
                            </span>
                            <span className="font-semibold text-gray-800">{m.name}</span>
                            <span
                              className="text-[11px] rounded-full px-2 py-0.5 bg-slate-100 text-slate-600"
                              title="Tela de la marcada"
                            >
                              {m.tela}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-700">{rnd(m.panels)}</td>
                        <td className="px-4 py-2 text-right font-semibold text-gray-700">{rnd(m.pieces)}</td>
                      </tr>
                      {/* Tallas de la marcada */}
                      {m.lines.map((l, li) => (
                        <tr key={`${m.id}-${l.talla}-${li}`} className="border-b last:border-0">
                          <td className="px-4 py-2" />
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className="font-medium text-gray-800">{l.talla}</span>
                            {tallaLabel(l.talla) && (
                              <span className="ml-1.5 text-[11px] rounded bg-blue-50 text-blue-700 px-1.5 py-0.5 align-middle">
                                {tallaLabel(l.talla)}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-blue-700">{rnd(l.panels)}</td>
                          <td className="px-4 py-2 text-right text-gray-600">{rnd(l.pieces)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 font-semibold text-gray-800">
                  <tr>
                    <td className="px-4 py-2" colSpan={2}>Total del corte</td>
                    <td className="px-3 py-2 text-right text-blue-700">{rnd(o.panels)}</td>
                    <td className="px-4 py-2 text-right">{rnd(o.pieces)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}