// components/cutting/CuttingDashboard.jsx
//
// Resumen de corte (solo lectura): número de órdenes de corte, su estado,
// y las órdenes con restante por cortar (con su valor en piezas).
//
import { useState, useEffect, useMemo } from "react";
import { RefreshCw, ClipboardList, Clock, CheckCircle, Scissors, Layers, FileSpreadsheet, Calendar, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import * as ExcelJS from "exceljs";
import { API_URL } from "../../lib/masterCodeCatalog";
import { colorForWO } from "../../lib/workOrderColors";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});
const num = (v) => Number(v) || 0;
// "YYYY-MM-DD" → "dd/MM/yyyy" (sin dependencias de fecha).
const fmtDate = (d) => {
  if (!d) return "—";
  const [y, m, day] = String(d).slice(0, 10).split("-");
  return y && m && day ? `${day}/${m}/${y}` : String(d);
};

// --- Lectura de marcadas (con respaldo para marcadas guardadas antes) --------
const markersOf = (co) => (Array.isArray(co?.markers) ? co.markers : []);
const markerName = (m, i) => m?.name || `Marcada ${i + 1}`;
// Tela/código elegido para la marcada en CuttingEntry.
const markerFabric = (m) => [m?.fabricCode, m?.fabricName].filter(Boolean).join(" ");
// Todas las telas de la CORTE: "CÓDIGO nombre + CÓDIGO nombre".
const orderFabricsText = (co) => {
  const fabs = Array.isArray(co?.fabrics) && co.fabrics.length
    ? co.fabrics
    : (co?.fabric || co?.fabric_code ? [{ name: co.fabric, code: co.fabric_code }] : []);
  return fabs.map((f) => [f.code, f.name].filter(Boolean).join(" ")).join(" + ") || "—";
};
const lineOf = (l) => ({
  talla: l?.talla ?? "—",
  panels: num(l?.panels),
  perPanel: num(l?.perPanel),
  pieces: l?.pieces != null ? num(l.pieces) : num(l?.panels) * num(l?.perPanel),
});
const markerLines = (m) => (Array.isArray(m?.lines) ? m.lines.map(lineOf) : []);
const markerTotalPieces = (m) =>
  m?.totalPieces != null ? num(m.totalPieces) : markerLines(m).reduce((s, l) => s + l.pieces, 0);
const markerPanels = (m) =>
  m?.panels != null ? num(m.panels) : markerLines(m).reduce((s, l) => s + l.panels, 0);
// Tolerancia de tela por panel (m), usada en el rendimiento.
const TOLERANCE = 0.05;
// Se recalculan siempre desde longitud + N° paneles + total piezas (así también
// quedan correctas las marcadas guardadas con una fórmula anterior).
// Rendimiento (m/pza) = (longitud + tolerancia) ÷ N° paneles.
const markerYield = (m) => {
  const panels = markerPanels(m);
  return panels > 0 ? (num(m?.longitud) + TOLERANCE) / panels : 0;
};
// Consumo (m) = (longitud ÷ N° paneles) × total piezas.
const markerConsumo = (m) => {
  const panels = markerPanels(m);
  return panels > 0 ? (num(m?.longitud) / panels) * markerTotalPieces(m) : 0;
};
const round2 = (v) => Math.round(num(v) * 100) / 100;

// Size-code → label. Debe coincidir con SIZE_LABELS de CuttingEntry.jsx.
const SIZE_LABELS = {
  "130": "XXXS", "132": "XXS", "134": "XS", "136": "S", "138": "M",
  "140": "L", "142": "XL", "144": "XXL",
  "004": "I-XS", "006": "S", "008": "M", "010": "L",
};
const tallaLabel = (talla) => {
  if (talla == null) return "";
  return SIZE_LABELS[String(talla).trim().toUpperCase()] || "";
};
// Texto para mostrar en el export: "130 XXXS". Nunca usar como clave de Map:
// las búsquedas (byTalla/pedido/totalPorTalla) siguen con el código crudo.
const tallaWithLabel = (talla) => {
  const t = talla == null ? "" : String(talla).trim();
  const lbl = tallaLabel(t);
  return lbl ? `${t} ${lbl}` : t;
};

// Columnas de talla: primero el orden del pedido, luego tallas extra de marcadas.
const orderSizeCols = (co) => {
  const cols = [];
  const seen = new Set();
  (Array.isArray(co?.sizes) ? co.sizes : []).forEach((s) => {
    const t = String(s.talla);
    if (!seen.has(t)) { seen.add(t); cols.push(t); }
  });
  markersOf(co).forEach((m) =>
    markerLines(m).forEach((l) => {
      const t = String(l.talla);
      if (t && t !== "—" && !seen.has(t)) { seen.add(t); cols.push(t); }
    })
  );
  return cols;
};

const pedidoBySize = (co) => {
  const map = new Map();
  (Array.isArray(co?.sizes) ? co.sizes : []).forEach((s) => map.set(String(s.talla), num(s.quantity)));
  return map;
};

// Matriz por orden (tallas en columnas), como hoja de cálculo con estilos.
// Estilos reutilizables.
const C = {
  head:   "FF1F2937", // gris-800 (encabezados)
  headTx: "FFFFFFFF",
  band:   "FFF3F4F6", // gris-100 (nombre de marcada / totales suaves)
  meta:   "FFEFF6FF", // azul-50 (longitud / rendimiento / consumo)
  total:  "FFFEF3C7", // ámbar-100 (TOTAL piezas)
  label:  "FF6B7280", // gris-500 (etiquetas del bloque info)
  line:   "FFD1D5DB", // gris-300 (bordes)
};
const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const THIN = { style: "thin", color: { argb: C.line } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const INT_FMT = "#,##0";
const DEC_FMT = "#,##0.00";

// Descarga un workbook de ExcelJS desde el navegador.
const saveWorkbook = async (wb, filename) => {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// Agrega una hoja con la matriz de una orden.
const addOrderSheet = (wb, co, cutNo) => {
  const sizes = orderSizeCols(co);
  const pedido = pedidoBySize(co);
  const totalCol = 2 + sizes.length;   // A=1 (etiqueta), tallas…, luego Total
  const LON = totalCol + 1;            // Longitud
  const REN = totalCol + 2;            // Rendimiento
  const CON = totalCol + 3;            // Consumo
  const lastCol = CON;
  const ws = wb.addWorksheet(cutNo(co).slice(0, 31));

  ws.getColumn(1).width = 20;
  for (let i = 0; i < sizes.length; i++) ws.getColumn(2 + i).width = 10;
  ws.getColumn(totalCol).width = 9;
  ws.getColumn(LON).width = 10;
  ws.getColumn(REN).width = 13;
  ws.getColumn(CON).width = 11;

  let r = 1;

  // --- Bloque de información (dos pares por fila) ---
  const info = (l1, v1, l2, v2) => {
    const row = ws.getRow(r);
    row.getCell(1).value = l1;
    row.getCell(1).font = { bold: true, color: { argb: C.label } };
    row.getCell(2).value = v1 ?? "—";
    if (totalCol >= 3) ws.mergeCells(r, 2, r, 3);
    if (l2 != null) {
      row.getCell(LON).value = l2;
      row.getCell(LON).font = { bold: true, color: { argb: C.label } };
      row.getCell(REN).value = v2 ?? "—";
      if (CON > REN) ws.mergeCells(r, REN, r, CON);
    }
    r++;
  };
  const estilo = co.modelo_code || co.style_no || co.style_code || co.estilo || "—";
  const tela = orderFabricsText(co);
  info("Orden de corte", cutNo(co), "Color", co.color || "—");
  info("Work Order", co.work_order_no || "—", "Estilo", estilo);
  info("PO Cliente", co.customer_po || "—", "Tela", tela);
  info("Cliente", co.customer_name || "—");
  r++; // fila en blanco

  // --- Cabecera ---
  const headRow = ws.getRow(r);
  const headerRowNo = r;
  headRow.getCell(1).value = "Talla";
  sizes.forEach((t, i) => (headRow.getCell(2 + i).value = tallaWithLabel(t)));
  headRow.getCell(totalCol).value = "Total";
  headRow.getCell(LON).value = "Long. (m)";
  headRow.getCell(REN).value = "Rend. (m/pza)";
  headRow.getCell(CON).value = "Consumo (m)";
  for (let c = 1; c <= lastCol; c++) {
    const cell = headRow.getCell(c);
    cell.fill = fill(C.head);
    cell.font = { bold: true, color: { argb: C.headTx } };
    cell.alignment = { horizontal: "center", wrapText: true };
    cell.border = BORDER;
  }
  r++;

  // Fila de datos de la cuadrícula (tallas + Total). Bordes hasta totalCol.
  const gridRow = (label, values, total, opt = {}) => {
    const row = ws.getRow(r++);
    row.getCell(1).value = label;
    values.forEach((v, i) => {
      const cell = row.getCell(2 + i);
      cell.value = v === "" || v == null ? null : v;
      cell.numFmt = INT_FMT;
      cell.alignment = { horizontal: "right" };
    });
    if (total !== undefined) {
      const tc = row.getCell(totalCol);
      tc.value = total === "" || total == null ? null : total;
      tc.numFmt = INT_FMT;
      tc.alignment = { horizontal: "right" };
    }
    for (let c = 1; c <= totalCol; c++) {
      const cell = row.getCell(c);
      cell.border = BORDER;
      if (opt.fill) cell.fill = fill(opt.fill);
      if (opt.bold) cell.font = { ...(cell.font || {}), bold: true };
    }
    return row;
  };

  gridRow("Pedido", sizes.map((t) => pedido.get(t) ?? 0),
    sizes.reduce((s, t) => s + (pedido.get(t) ?? 0), 0), { fill: C.band, bold: true });
  r++;

  // --- Cada marcada: banda (nombre + Longitud/Rend/Consumo) + 3 filas ---
  const totalPorTalla = new Map(sizes.map((t) => [t, 0]));
  markersOf(co).forEach((m, idx) => {
    const byTalla = new Map(markerLines(m).map((l) => [String(l.talla), l]));

    const band = ws.getRow(r);
    const mFab = markerFabric(m);
    band.getCell(1).value = markerName(m, idx) + (mFab ? ` · ${mFab}` : "");
    ws.mergeCells(r, 1, r, totalCol);
    for (let c = 1; c <= totalCol; c++) {
      band.getCell(c).fill = fill(C.band);
      band.getCell(c).font = { bold: true };
      band.getCell(c).border = BORDER;
    }
    // Meta en línea (a la derecha del Total).
    [[LON, m.longitud], [REN, markerYield(m)], [CON, markerConsumo(m)]].forEach(([col, val]) => {
      const cell = band.getCell(col);
      cell.value = round2(val);
      cell.numFmt = DEC_FMT;
      cell.alignment = { horizontal: "right" };
      cell.font = { bold: true };
      cell.fill = fill(C.meta);
      cell.border = BORDER;
    });
    r++;

    gridRow("  Paneles", sizes.map((t) => (byTalla.get(t) ? byTalla.get(t).panels : 0)), markerPanels(m));
    gridRow("  Pzs/panel", sizes.map((t) => (byTalla.get(t) ? byTalla.get(t).perPanel : 0)), "");
    gridRow("  Piezas", sizes.map((t) => {
      const p = byTalla.get(t) ? byTalla.get(t).pieces : 0;
      totalPorTalla.set(t, (totalPorTalla.get(t) || 0) + p);
      return p;
    }), markerTotalPieces(m), { bold: true });
  });
  r++;

  // --- Totales ---
  const grand = sizes.reduce((s, t) => s + (totalPorTalla.get(t) || 0), 0);
  gridRow("TOTAL piezas", sizes.map((t) => totalPorTalla.get(t) || 0), grand, { fill: C.total, bold: true });
  const rest = sizes.map((t) => Math.max((pedido.get(t) ?? 0) - (totalPorTalla.get(t) || 0), 0));
  gridRow("Restante", rest, rest.reduce((s, v) => s + v, 0), { bold: true });
  const lastRow = r - 1;

  // Congelar la cabecera y la columna de etiquetas para no perder contexto.
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: headerRowNo }];

  // Imprimir TODO en una sola página.
  ws.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    horizontalCentered: true,
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    printArea: `A1:${ws.getColumn(lastCol).letter}${lastRow}`,
  };

  return ws;
};

// Fila plana (una por marcada) para la hoja "Resumen".
const flatMarcadaRow = (co, m, idx, cutNo) => {
  const lines = markerLines(m);
  return {
    "Work Order": co.work_order_no || "",
    "PO Cliente": co.customer_po || "",
    "Orden de corte": cutNo(co),
    "Cliente": co.customer_name || "",
    "Color": co.color || "",
    "Marcada": markerName(m, idx),
    "Tela": markerFabric(m) || [co.fabric_code, co.fabric].filter(Boolean).join(" ") || "",
    "Longitud (m)": m.longitud != null && m.longitud !== "" ? round2(m.longitud) : "",
    "Rendimiento (m/pza)": round2(markerYield(m)),
    "Total piezas": markerTotalPieces(m),
    "N° paneles": markerPanels(m),
    "Consumo (m)": round2(markerConsumo(m)),
    "Piezas por talla": lines.filter((l) => l.pieces > 0)
      .map((l) => `${tallaWithLabel(l.talla)}: ${Math.round(l.pieces).toLocaleString()}`).join(", "),
  };
};

const STATUS = {
  pending: { label: "Pendiente", pill: "bg-yellow-100 text-yellow-700" },
  in_progress: { label: "En corte", pill: "bg-purple-100 text-purple-700" },
  completed: { label: "Cortada", pill: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelada", pill: "bg-gray-100 text-gray-500" },
};

// Verificación de marcadas (misma lógica que CuttingEntry). Guardar el corte
// sólo cierra la PLANEACIÓN; la CORTE no pasa a "Cortada" hasta que TODAS las
// marcadas se verifican (se completan una a una).
const markerVerification = (markers) => {
  const list = Array.isArray(markers) ? markers : [];
  const total = list.length;
  const verified = list.filter((m) => m && m.done).length;
  return { total, verified, pending: Math.max(total - verified, 0) };
};

// Sub-estados de presentación derivados de la verificación de marcadas.
const PLANNED = { label: "Planeada", pill: "bg-blue-100 text-blue-700" };
const VERIFYING = { label: "Verificando", pill: "bg-purple-100 text-purple-700" };
const READY = { label: "Verificada", pill: "bg-green-100 text-green-700" };

// Estado a mostrar: combina el status real con la verificación de marcadas.
//   completed → Cortada · cancelled → Cancelada
//   sin marcadas → Pendiente
//   marcadas guardadas, 0 verificadas (recién "Guardar corte") → Planeada
//   algunas verificadas, faltan → Verificando · todas verificadas → Verificada
const displayStatusMeta = (status, markers) => {
  if (status === "completed") return STATUS.completed;
  if (status === "cancelled") return STATUS.cancelled;
  const { total, verified, pending } = markerVerification(markers);
  if (total === 0) return STATUS.pending;
  if (verified === 0) return PLANNED;
  if (pending > 0) return VERIFYING;
  return READY;
};

// Prioridad fijada por el planner. rank ordena de más a menos urgente.
const PRIORITY = {
  urgent:       { label: "Urgente",    pill: "bg-red-100 text-red-700",       dot: "bg-red-500",    rank: 0, accent: "border-l-red-500",    head: "bg-red-50 text-red-700",       count: "bg-red-100 text-red-700" },
  intermediate: { label: "Intermedia", pill: "bg-yellow-100 text-yellow-700", dot: "bg-yellow-500", rank: 1, accent: "border-l-yellow-400", head: "bg-yellow-50 text-yellow-800",  count: "bg-yellow-100 text-yellow-800" },
  normal:       { label: "Normal",     pill: "bg-green-100 text-green-700",   dot: "bg-green-500",  rank: 2, accent: "border-l-green-500",  head: "bg-green-50 text-green-700",    count: "bg-green-100 text-green-700" },
};
const priorityMeta = (p) => PRIORITY[p] || PRIORITY.normal;
const PRIORITY_ORDER = ["urgent", "intermediate", "normal"];

// Encabezado de día: "jueves 14/08/2025" (capitalizado), sin date-fns.
const fmtDayHeader = (d) => {
  if (!d) return "Sin fecha";
  const iso = String(d).slice(0, 10);
  const dt = new Date(`${iso}T00:00:00`);
  if (isNaN(dt.getTime())) return iso;
  const wd = dt.toLocaleDateString("es-MX", { weekday: "long" });
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${fmtDate(iso)}`;
};

// Orden del tablero de corte: primero por prioridad (urgente → normal),
// luego por fecha de corte (más próxima primero).
const byPriorityThenDate = (a, b) => {
  const ra = priorityMeta(a?.priority).rank;
  const rb = priorityMeta(b?.priority).rank;
  if (ra !== rb) return ra - rb;
  const da = a?.cut_date ? new Date(`${a.cut_date}T00:00:00`).getTime() : Infinity;
  const db = b?.cut_date ? new Date(`${b.cut_date}T00:00:00`).getTime() : Infinity;
  if (da !== db) return da - db;
  return num(a?.id) - num(b?.id);
};

export default function CuttingDashboard() {
  const [cutOrders, setCutOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState("priority"); // "priority" | "day"
  const [priorityFilter, setPriorityFilter] = useState("all"); // all | urgent | intermediate | normal
  const [hideDone, setHideDone] = useState(false); // ocultar cortadas/canceladas
  const [collapsed, setCollapsed] = useState({}); // { [groupKey]: true }

  const toggleGroup = (key) =>
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));

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

  const stats = useMemo(() => {
    const s = { total: cutOrders.length, pending: 0, in_progress: 0, completed: 0, remainingOrders: 0, remainingQty: 0 };
    cutOrders.forEach((co) => {
      if (s[co.status] != null) s[co.status]++;
      const rem = num(co.remaining_to_cut);
      if (co.status !== "completed" && co.status !== "cancelled" && rem > 0) {
        s.remainingOrders++;
        s.remainingQty += rem;
      }
    });
    return s;
  }, [cutOrders]);

  const cutNo = (co) => `CORTE-${String(co.id).padStart(4, "0")}`;

  // Ordenadas por prioridad y luego por fecha de corte, para todas las vistas.
  const sortedCutOrders = useMemo(
    () => [...cutOrders].sort(byPriorityThenDate),
    [cutOrders]
  );

  const withRemaining = useMemo(
    () => sortedCutOrders.filter(
      (co) => co.status !== "completed" && co.status !== "cancelled" && num(co.remaining_to_cut) > 0
    ),
    [sortedCutOrders]
  );

  // Conteo por prioridad (sobre todas las órdenes) para los chips de filtro.
  const priorityCounts = useMemo(() => {
    const c = { all: cutOrders.length, urgent: 0, intermediate: 0, normal: 0 };
    cutOrders.forEach((co) => {
      const p = PRIORITY[co.priority] ? co.priority : "normal";
      c[p]++;
    });
    return c;
  }, [cutOrders]);

  // Lista filtrada por prioridad + (opcional) ocultar terminadas.
  const visibleOrders = useMemo(() => {
    return sortedCutOrders.filter((co) => {
      if (priorityFilter !== "all" && (co.priority || "normal") !== priorityFilter) return false;
      if (hideDone && (co.status === "completed" || co.status === "cancelled")) return false;
      return true;
    });
  }, [sortedCutOrders, priorityFilter, hideDone]);

  // Agrupación para "Todas las órdenes": por prioridad o por día de corte.
  const groups = useMemo(() => {
    if (viewMode === "priority") {
      return PRIORITY_ORDER
        .map((key) => ({
          key,
          kind: "priority",
          label: priorityMeta(key).label,
          meta: priorityMeta(key),
          // dentro de cada prioridad, por fecha ascendente
          items: visibleOrders
            .filter((co) => (co.priority || "normal") === key)
            .sort((a, b) => byPriorityThenDate(a, b)),
        }))
        .filter((g) => g.items.length > 0);
    }
    // Por día: fecha ascendente; dentro del día, por prioridad.
    const byDay = new Map();
    visibleOrders.forEach((co) => {
      const d = co.cut_date ? String(co.cut_date).slice(0, 10) : "";
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(co);
    });
    const keys = [...byDay.keys()].sort((a, b) => {
      const da = a ? new Date(`${a}T00:00:00`).getTime() : Infinity;
      const db = b ? new Date(`${b}T00:00:00`).getTime() : Infinity;
      return da - db;
    });
    return keys.map((d) => {
      const items = byDay.get(d).sort(byPriorityThenDate);
      const breakdown = { urgent: 0, intermediate: 0, normal: 0 };
      items.forEach((co) => breakdown[co.priority || "normal"]++);
      return { key: d || "sin-fecha", kind: "day", label: fmtDayHeader(d), items, breakdown };
    });
  }, [visibleOrders, viewMode]);

  // Total de marcadas cargadas (para habilitar/mostrar el export).
  const totalMarkers = useMemo(
    () => cutOrders.reduce((s, co) => s + markersOf(co).length, 0),
    [cutOrders]
  );

  // Exportar a Excel: una fila por marcada + hoja de detalle por talla.
  const exportExcel = async () => {
    const summaryRows = [];
    cutOrders.forEach((co) =>
      markersOf(co).forEach((m, idx) => summaryRows.push(flatMarcadaRow(co, m, idx, cutNo)))
    );

    if (!summaryRows.length) {
      setError("No hay marcadas para exportar.");
      return;
    }

    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = "LineOps";
      wb.created = new Date();

      // Hoja "Resumen": tabla plana (una fila por marcada) con filtros.
      const headers = Object.keys(summaryRows[0]);
      const ws = wb.addWorksheet("Resumen");
      ws.addTable({
        name: "Resumen",
        ref: "A1",
        headerRow: true,
        style: { theme: "TableStyleMedium2", showRowStripes: true },
        columns: headers.map((h) => ({ name: h, filterButton: true })),
        rows: summaryRows.map((row) => headers.map((h) => (row[h] === "" ? null : row[h]))),
      });
      // Cols: A WO, B PO, C Orden, D Cliente, E Color, F Marcada, G Tela,
      // H Longitud, I Rendimiento, J Total pzas, K N° paneles, L Consumo, M por talla.
      const widths = [18, 14, 14, 20, 12, 16, 22, 12, 20, 12, 11, 12, 34];
      widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
      ["H", "I", "L"].forEach((col) => (ws.getColumn(col).numFmt = DEC_FMT));
      ["J", "K"].forEach((col) => (ws.getColumn(col).numFmt = INT_FMT));

      // Una hoja "matriz" por orden.
      cutOrders.forEach((co) => {
        if (markersOf(co).length > 0) addOrderSheet(wb, co, cutNo);
      });

      const today = new Date().toISOString().slice(0, 10);
      await saveWorkbook(wb, `corte-marcadas-${today}.xlsx`);
    } catch (err) {
      setError(`No se pudo generar el Excel: ${err.message}`);
    }
  };

  // Exportar UNA orden en formato matriz (tallas en columnas).
  const exportOrderExcel = async (co) => {
    if (markersOf(co).length === 0) {
      setError(`${cutNo(co)} no tiene marcadas para exportar.`);
      return;
    }
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = "LineOps";
      wb.created = new Date();
      addOrderSheet(wb, co, cutNo);
      await saveWorkbook(wb, `${cutNo(co)}-marcadas.xlsx`);
    } catch (err) {
      setError(`No se pudo generar el Excel: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Resumen de corte</h2>
          <p className="text-sm text-gray-500">Estado de las órdenes de corte y pendientes por cortar</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportExcel}
            disabled={totalMarkers === 0}
            className="inline-flex items-center gap-1.5 text-sm text-white bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg"
          >
            <FileSpreadsheet className="w-4 h-4" /> Exportar Excel
          </button>
          <button
            onClick={fetchCutOrders}
            className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm">{error}</div>}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={ClipboardList} label="Órdenes de corte" value={stats.total} tint="text-gray-700" />
        <StatCard icon={Clock} label="En corte" value={stats.in_progress} sub={`${stats.pending} pendientes`} tint="text-purple-600" />
        <StatCard icon={CheckCircle} label="Cortadas" value={stats.completed} tint="text-green-600" />
        <StatCard
          icon={Scissors}
          label="Restante por cortar"
          value={stats.remainingOrders}
          sub={`${Math.round(stats.remainingQty).toLocaleString()} pzas`}
          tint="text-amber-600"
          highlight
        />
      </div>

      {/* Remaining list */}
      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="px-5 py-4 border-b">
          <h3 className="font-semibold text-gray-900">Pendiente por cortar</h3>
          <p className="text-sm text-gray-500">{withRemaining.length} orden(es) con restante</p>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-500">Cargando…</div>
        ) : withRemaining.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No hay órdenes con restante por cortar.</div>
        ) : (
          <div className="divide-y max-h-[55vh] overflow-y-auto">
            {withRemaining.map((co) => {
              const meta = displayStatusMeta(co.status, co.markers);
              const pr = priorityMeta(co.priority);
              const mks = markersOf(co);
              return (
                <div key={co.id} className="p-4 flex items-center gap-3">
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
                      {co.work_order_no}{co.customer_po ? ` · PO ${co.customer_po}` : ""} · {co.customer_name}{co.color ? ` · ${co.color}` : ""} · 📅 {fmtDate(co.cut_date)}
                    </p>
                    {mks.length > 0 && (
                      <p className="text-[11px] text-gray-400 truncate mt-0.5">
                        {mks.map((m, i) => markerName(m, i)).join(" · ")}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-amber-600">{Math.round(num(co.remaining_to_cut)).toLocaleString()}</div>
                    <div className="text-[11px] text-gray-400">de {Math.round(num(co.quantity)).toLocaleString()} pzas</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Todas las órdenes — categorizadas por prioridad o por día */}
      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="px-5 py-4 border-b space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-semibold text-gray-900">Todas las órdenes de corte</h3>
              <p className="text-sm text-gray-500">
                {visibleOrders.length === cutOrders.length
                  ? `${cutOrders.length} órdenes`
                  : `${visibleOrders.length} de ${cutOrders.length} órdenes`}
                {" · "}agrupadas por {viewMode === "priority" ? "prioridad" : "día de corte"}
              </p>
            </div>

            {/* Toggle de vista */}
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-sm">
              <button
                onClick={() => setViewMode("priority")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${viewMode === "priority" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
              >
                <Scissors className="w-4 h-4" /> Por prioridad
              </button>
              <button
                onClick={() => setViewMode("day")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${viewMode === "day" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
              >
                <Calendar className="w-4 h-4" /> Por día
              </button>
            </div>
          </div>

          {/* Chips de filtro por prioridad + ocultar terminadas */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex flex-wrap gap-2">
              {[
                { key: "all", label: "Todas", dot: "bg-gray-400", on: "bg-gray-900 text-white border-gray-900", off: "bg-white text-gray-600 border-gray-200 hover:bg-gray-50" },
                { key: "urgent", label: "Urgente", dot: "bg-red-500", on: "bg-red-500 text-white border-red-500", off: "bg-white text-red-700 border-red-200 hover:bg-red-50" },
                { key: "intermediate", label: "Intermedia", dot: "bg-yellow-500", on: "bg-yellow-400 text-yellow-950 border-yellow-400", off: "bg-white text-yellow-700 border-yellow-200 hover:bg-yellow-50" },
                { key: "normal", label: "Normal", dot: "bg-green-500", on: "bg-green-500 text-white border-green-500", off: "bg-white text-green-700 border-green-200 hover:bg-green-50" },
              ].map((c) => {
                const active = priorityFilter === c.key;
                return (
                  <button
                    key={c.key}
                    onClick={() => setPriorityFilter(c.key)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${active ? c.on : c.off}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${c.dot} ${active ? "ring-2 ring-white/60" : ""}`} />
                    {c.label}
                    <span className={`rounded-full px-1.5 leading-5 ${active ? "bg-white/25" : "bg-gray-100 text-gray-600"}`}>
                      {priorityCounts[c.key] ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideDone}
                onChange={(e) => setHideDone(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              Ocultar cortadas/canceladas
            </label>
          </div>
        </div>

        {cutOrders.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Sin órdenes de corte.</div>
        ) : visibleOrders.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Ninguna orden coincide con el filtro.</div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            {groups.map((g) => {
              const isCollapsed = !!collapsed[g.key];
              return (
                <div key={g.key} className="border-b last:border-b-0">
                  {/* Encabezado de grupo (sticky) */}
                  <button
                    onClick={() => toggleGroup(g.key)}
                    className={`w-full sticky top-0 z-10 flex items-center gap-2 px-5 py-2.5 text-left backdrop-blur ${g.kind === "priority" ? g.meta.head : "bg-gray-50 text-gray-700"}`}
                  >
                    {isCollapsed ? <ChevronRight className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
                    {g.kind === "priority" ? (
                      <span className={`w-2 h-2 rounded-full ${g.meta.dot}`} />
                    ) : (
                      <Calendar className="w-3.5 h-3.5 shrink-0 opacity-70" />
                    )}
                    <span className="text-sm font-semibold">{g.label}</span>
                    <span className={`text-[11px] rounded-full px-2 leading-5 ${g.kind === "priority" ? g.meta.count : "bg-gray-200 text-gray-700"}`}>
                      {g.items.length}
                    </span>
                    {/* En vista por día: mini-desglose de prioridad */}
                    {g.kind === "day" && (
                      <span className="ml-1 inline-flex items-center gap-2">
                        {PRIORITY_ORDER.map((pk) =>
                          g.breakdown[pk] > 0 ? (
                            <span key={pk} className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                              <span className={`w-1.5 h-1.5 rounded-full ${priorityMeta(pk).dot}`} />
                              {g.breakdown[pk]}
                            </span>
                          ) : null
                        )}
                      </span>
                    )}
                  </button>

                  {/* Filas del grupo */}
                  {!isCollapsed && (
                    <div className="divide-y">
                      {g.items.map((co) => {
                        const meta = displayStatusMeta(co.status, co.markers);
                        const pr = priorityMeta(co.priority);
                        const rem = num(co.remaining_to_cut);
                        const mkCount = markersOf(co).length;
                        return (
                          <div
                            key={co.id}
                            className={`pl-3 pr-3 py-2.5 flex items-center gap-3 border-l-4 ${pr.accent} hover:bg-gray-50`}
                          >
                            <span className="font-mono text-sm font-medium text-gray-800 w-28 shrink-0">{cutNo(co)}</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-gray-600 truncate">
                                {co.work_order_no}{co.customer_po ? ` · PO ${co.customer_po}` : ""} · {co.customer_name}{co.color ? ` · ${co.color}` : ""}
                              </p>
                              <p className="text-[11px] text-gray-400 inline-flex items-center gap-1 mt-0.5">
                                <Calendar className="w-3 h-3" /> {fmtDate(co.cut_date)}
                              </p>
                            </div>
                            {mkCount > 0 && (
                              <VerifyPill markers={co.markers} status={co.status} />
                            )}
                            {/* En vista por día mostramos la prioridad; en vista por prioridad
                                el color de la barra ya la indica, así que se omite. */}
                            {viewMode === "day" && (
                              <span className={`text-[11px] rounded-full px-2 py-0.5 inline-flex items-center gap-1 shrink-0 ${pr.pill}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${pr.dot}`} />
                                {pr.label}
                              </span>
                            )}
                            <span className={`text-[11px] rounded-full px-2 py-0.5 shrink-0 ${meta.pill}`}>{meta.label}</span>
                            <span className="text-xs text-gray-500 w-24 text-right shrink-0">
                              {rem > 0 ? <span className="text-amber-600 font-medium">Restan {Math.round(rem).toLocaleString()}</span> : `${Math.round(num(co.quantity)).toLocaleString()} pzas`}
                            </span>
                            <button
                              onClick={() => exportOrderExcel(co)}
                              disabled={mkCount === 0}
                              title={mkCount === 0 ? "Sin marcadas para exportar" : "Exportar esta orden a Excel"}
                              className="shrink-0 p-1.5 rounded-lg text-green-700 hover:bg-green-50 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <FileSpreadsheet className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Píldora de marcadas: "Falta verificar N marcada(s)" mientras alguna quede sin
// completar; el conteo simple cuando la CORTE ya está cortada/cancelada.
function VerifyPill({ markers, status }) {
  const { total, verified, pending } = markerVerification(markers);
  if (total === 0) return null;
  const base = "text-[11px] rounded-full px-2 py-0.5 inline-flex items-center gap-1 shrink-0";
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
      <CheckCircle className="w-3 h-3" /> {verified} verificada{verified > 1 ? "s" : ""}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, sub, tint, highlight }) {  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${highlight ? "bg-amber-50 border-amber-200" : "bg-white"}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">{label}</span>
        {Icon && <Icon className={`w-5 h-5 ${tint}`} />}
      </div>
      <div className={`mt-1 text-2xl font-bold ${tint}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}