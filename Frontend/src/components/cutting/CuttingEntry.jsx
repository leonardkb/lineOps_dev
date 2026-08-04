// components/cutting/CuttingEntry.jsx
//
// Registrar corte por MARCADA (trazo). Cada marcada agrupa tallas, lleva su
// N° de paneles (tendidos) y las piezas por panel de cada talla:
//
//     piezas de la talla = paneles × pzs/panel
//     total de la marcada = paneles × (suma de pzs/panel)
//
// Todo se consolida por talla contra el pedido para obtener el restante.
// Guardar, completar y luego imprimir el ticket para las líneas.
//
import { useState, useEffect, useMemo } from "react";
import {
  Search, RefreshCw, Camera, Calendar, CheckCircle, Printer,
  Plus, Minus, Copy, Trash2, Layers, AlertTriangle, RotateCcw,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";
import { colorForWO } from "../../lib/workOrderColors";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});
const num = (v) => Number(v) || 0;
const uid = () => Math.random().toString(36).slice(2, 9);
const rnd = (v) => Math.round(num(v)).toLocaleString();

// Size-code → label. Built from the size run in use (see reference chart).
// Swap for a catalog-driven source if master codes start carrying labels.
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

const fmtDate = (v) => {
  if (!v) return "—";
  const s = typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v;
  const [y, m, d] = String(s).split("-");
  return d ? `${d}/${m}/${y}` : String(s);
};

// The size run of an order — the pedido each talla has to reach.
const orderSizes = (co) =>
  Array.isArray(co?.sizes) && co.sizes.length
    ? co.sizes.map((s) => ({ talla: String(s.talla), quantity: num(s.quantity) }))
    : [{ talla: "—", quantity: num(co?.quantity) }];

// Rehydrate saved marcadas into editable state, keeping the full size run visible.
// Los paneles viven en cada talla. Las marcadas guardadas antes traían un solo
// N° de paneles para todo el trazo: se copia a cada talla con piezas.
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
      done: !!m.done,
      completedAt: m.completedAt || null,
      saved: true,          // ya existe en la orden: puede completarse
      lines,
    };
  });
};

const emptyMarker = (co, index) => ({
  id: uid(),
  name: `Marcada ${index + 1}`,
  done: false,
  completedAt: null,
  saved: false,
  lines: orderSizes(co).map((s) => ({ talla: s.talla, panels: "", perPanel: "" })),
});

// Cada talla del trazo lleva sus propios paneles: piezas = paneles × pzs/panel.
const linePieces = (l) => num(l.panels) * num(l.perPanel);
const markerLines = (m) => m.lines.filter((l) => num(l.panels) > 0 && num(l.perPanel) > 0);
const markerPanels = (m) => markerLines(m).reduce((s, l) => s + num(l.panels), 0);
const markerTotal = (m) => m.lines.reduce((s, l) => s + linePieces(l), 0);
// Un ticket por panel de cada talla del trazo.
const markerTickets = (m) =>
  markerLines(m).reduce((s, l) => s + Math.max(0, Math.round(num(l.panels))), 0);

export default function CuttingEntry() {
  const [cutOrders, setCutOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState("open");
  const [selected, setSelected] = useState(null);

  const [markers, setMarkers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

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
        const hay = `${co.work_order_no} ${co.customer_name || ""} ${co.style_code || ""} ${co.estilo || ""} ${co.color || ""} ${co.fabric || ""}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [cutOrders, filter, searchTerm]);

  const cutNo = (co) => `CORTE-${String(co.id).padStart(4, "0")}`;

  const pickOrder = (co) => {
    const mk = buildMarkers(co);
    setSelected(co);
    setMarkers(mk.length ? mk : [emptyMarker(co, 0)]);
    setMessage("");
    setError("");
  };

  // Pedido por talla (base del consolidado).
  const pedido = useMemo(() => (selected ? orderSizes(selected) : []), [selected]);

  // ---- Marcadas -----------------------------------------------------------
  const addMarker = () => setMarkers((ms) => [...ms, emptyMarker(selected, ms.length)]);

  const duplicateMarker = (id) =>
    setMarkers((ms) => {
      const i = ms.findIndex((m) => m.id === id);
      if (i < 0) return ms;
      const copy = { ...ms[i], id: uid(), name: `${ms[i].name} (copia)`, lines: ms[i].lines.map((l) => ({ ...l })) };
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

  // Piezas cortadas por talla, sumadas sobre todas las marcadas.
  const cutByTalla = useMemo(() => {
    const map = new Map(); // talla → { pieces, panels }
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

  // Consolidado por talla: pedido vs cortado en todas las marcadas.
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
    return t;
  }, [summary, markers]);

  // Restante por talla, para mostrarlo dentro de cada marcada.
  const remainingByTalla = useMemo(
    () => new Map(summary.map((r) => [r.talla, r.remaining])),
    [summary]
  );
  const pedidoByTalla = useMemo(
    () => new Map(summary.map((r) => [r.talla, r.quantity])),
    [summary]
  );

  // ---- Guardar ------------------------------------------------------------
  const serializeMarkers = (list) =>
    list.map((m) => ({
      id: m.id,
      name: m.name,
      panels: markerPanels(m),        // suma de los paneles de sus tallas
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

  const persist = async (list, okMessage) => {
    if (!selected) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const body = {
        sizeProgress: summary.map((r) => ({
          talla: r.talla,
          quantity: r.quantity,
          panels: r.panels,
          amountCut: r.cut,
          remaining: r.remaining,
        })),
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
    persist(markers, "Corte guardado");
  };

  // Completar una marcada: se cierra para edición y habilita su impresión.
  const completeMarker = (id) => {
    const m = markers.find((x) => x.id === id);
    if (!m) return;
    if (markerTotal(m) <= 0) {
      return setError("Ingrese paneles y piezas por panel antes de completar la marcada");
    }
    const next = markers.map((x) =>
      x.id === id ? { ...x, done: true, completedAt: new Date().toISOString() } : x
    );
    setMarkers(next);
    persist(next, `${m.name} completada — ya puede imprimir sus tickets`);
  };

  const reopenMarker = (id) => {
    const next = markers.map((x) => (x.id === id ? { ...x, done: false, completedAt: null } : x));
    setMarkers(next);
    persist(next, "Marcada reabierta");
  };

  const handleComplete = async () => {
    if (!selected) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/api/cut-orders/${selected.id}/status`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ status: "completed" }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage("Corte completado");
        await fetchCutOrders();
        setSelected((s) => ({ ...s, status: "completed" }));
      } else {
        setError(data.error || "No se pudo completar");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // printTicket(co)            → todas las marcadas
  // printTicket(co, marcada)   → sólo esa marcada
  const printTicket = (co, onlyMarker = null) => {
    if (onlyMarker && markerTickets(onlyMarker) <= 0) {
      return setError("Esta marcada no tiene paneles ni piezas para imprimir");
    }
    const esc = (s) => String(s ?? "—").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const estilo = co.style_no || co.style_code || co.estilo || co.style_description || "—";

    const pedidoMap = new Map(
      (Array.isArray(co.sizes) ? co.sizes : []).map((s) => [String(s.talla), num(s.quantity)])
    );

    // Un ticket POR PANEL de cada talla dentro de la marcada.
    const panelTickets = [];
    const mk = onlyMarker
      ? [{
          name: onlyMarker.name,
          lines: markerLines(onlyMarker).map((l) => ({
            talla: l.talla, panels: num(l.panels), perPanel: num(l.perPanel),
          })),
        }].filter((m) => m.lines.length > 0)
      : Array.isArray(co.markers) ? co.markers.filter((m) => Array.isArray(m.lines) && m.lines.length) : [];

    if (mk.length) {
      mk.forEach((m) => {
        m.lines.forEach((l) => {
          const per = num(l.perPanel);
          // Marcadas guardadas antes tenían los paneles a nivel del trazo.
          const panels = Math.max(0, Math.round(l.panels != null ? num(l.panels) : num(m.panels)));
          if (per <= 0) return;
          const quantity = pedidoMap.get(String(l.talla)) ?? 0;
          if (panels > 0) {
            for (let i = 1; i <= panels; i++) {
              panelTickets.push({ talla: l.talla, quantity, panelNo: i, panelCount: panels, pieces: per, marker: m.name });
            }
          } else {
            panelTickets.push({ talla: l.talla, quantity, panelNo: null, panelCount: null, pieces: per, marker: m.name });
          }
        });
      });
    } else {
      // Órdenes anteriores sin marcadas: progreso por talla → tallas → orden completa.
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
      const panelTag = t.panelCount ? `Panel ${t.panelNo}/${t.panelCount}` : "";
      const qrData = encodeURIComponent(`${cutNo(co)}|${co.work_order_no || ""}|${co.color || ""}|${t.talla || ""}|${t.marker || ""}|P${t.panelNo || 1}`);
      const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&margin=0&data=${qrData}`;
      return `
      <div class="ticket">
        <div class="top">
          <div class="kicker">Orden a Líneas</div>
          <div class="row">
            <div><div class="title">${esc(co.customer_name)}</div><div class="code">${esc(co.work_order_no)}</div></div>
            <img class="qr" src="${qrSrc}" alt="QR" onerror="this.style.display='none'" />
          </div>
        </div>
        <div class="notch l"></div><div class="notch r"></div>
        <div class="hero">
          <div class="label">Estilo</div><div class="estilo">${esc(estilo)}</div>
        </div>
        <div class="tallabar">Talla <b>${esc(t.talla)}</b>${tallaLabel(t.talla) ? ` <span class="sz">${esc(tallaLabel(t.talla))}</span>` : ""}${panelTag ? `<span class="panel">${esc(panelTag)}</span>` : ""}</div>
        ${t.marker ? `<div class="mkbar">Marcada <b>${esc(t.marker)}</b></div>` : ""}
        <div class="grid">
          <div class="cell"><div class="label">Color</div><div class="value">${esc(co.color)}</div></div>
          <div class="cell"><div class="label">Season</div><div class="value">${esc(co.season)}</div></div>
          <div class="cell"><div class="label">Tela</div><div class="value">${esc(co.fabric)}</div>${co.fabric_code ? `<div class="sub">${esc(co.fabric_code)}</div>` : ""}</div>
          <div class="cell"><div class="label">Pedido talla</div><div class="value">${rnd(t.quantity)}</div></div>
          <div class="cell"><div class="label">Panel</div><div class="value">${t.panelCount ? `${t.panelNo} / ${t.panelCount}` : "—"}</div></div>
          <div class="cell hl"><div class="label">Piezas (panel)</div><div class="value">${rnd(t.pieces)}</div></div>
        </div>
        <div class="barcode"></div>
        <div class="barlabel">${esc(cutNo(co))} · T${esc(t.talla)}${t.marker ? ` · ${esc(t.marker)}` : ""}${t.panelCount ? ` · P${t.panelNo}/${t.panelCount}` : ""}</div>
        <div class="foot"><span>${esc(fmtDate(co.cut_date))}</span><span>LineOps</span></div>
      </div>`;
    };

    const tickets = panelTickets.map(oneTicket).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(cutNo(co))}</title>
      <style>
        :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; }
        * { box-sizing: border-box; }
        html,body { margin:0; padding:0; background:#f1f5f9; }
        body { font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:var(--ink); padding:24px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
        .ticket { width:420px; margin:0 auto 24px; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 10px 30px rgba(0,0,0,.12); position:relative; }
        .top { background:var(--ink); color:#fff; padding:18px 22px; }
        .top .kicker { font-size:11px; letter-spacing:.18em; text-transform:uppercase; opacity:.7; }
        .top .title { font-size:22px; font-weight:800; margin-top:2px; }
        .top .row { display:flex; justify-content:space-between; align-items:flex-end; }
        .top .code { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:13px; opacity:.9; }
        .top .qr { width:64px; height:64px; background:#fff; padding:4px; border-radius:8px; }
        .notch { position:absolute; width:26px; height:26px; background:#f1f5f9; border-radius:50%; top:74px; }
        .notch.l { left:-13px; } .notch.r { right:-13px; }
        .hero { padding:16px 22px 2px; }
        .hero .label { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
        .hero .estilo { font-size:26px; font-weight:800; line-height:1.05; margin-top:2px; }
        .tallabar { margin:8px 22px 0; padding:8px 12px; background:#eff6ff; color:#1e3a8a; border-radius:10px; font-size:18px; }
        .tallabar b { font-size:22px; }
        .tallabar .panel { float:right; font-size:13px; font-weight:700; background:#dbeafe; color:#1e40af; padding:3px 10px; border-radius:8px; }
        .tallabar .sz { font-size:14px; font-weight:700; opacity:.85; margin-left:4px; }
        .mkbar { margin:6px 22px 0; padding:6px 12px; background:#f1f5f9; color:#334155; border-radius:10px; font-size:13px; letter-spacing:.04em; }
        .mkbar b { font-size:15px; }
        .cell .sub { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12px; color:var(--muted); margin-top:2px; }
        .grid { display:grid; grid-template-columns:1fr 1fr; gap:0; padding:6px 22px; }
        .cell { padding:10px 6px; border-top:1px solid var(--line); }
        .cell:nth-child(odd){ border-right:1px solid var(--line); padding-right:14px; }
        .cell:nth-child(even){ padding-left:14px; }
        .cell .label { font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); }
        .cell .value { font-size:18px; font-weight:700; margin-top:2px; }
        .cell.hl .value { color:#1d4ed8; }
        .barcode { height:40px; margin:8px 22px 4px; background:repeating-linear-gradient(90deg,#0f172a 0 2px,#fff 2px 4px,#0f172a 4px 5px,#fff 5px 9px); border-radius:4px; }
        .barlabel { text-align:center; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12px; letter-spacing:.2em; padding-bottom:10px; }
        .foot { border-top:2px dashed var(--line); padding:10px 22px 18px; font-size:11px; color:var(--muted); display:flex; justify-content:space-between; }
        @media print {
          html,body{ background:#fff; } body{ padding:0; }
          .ticket{ box-shadow:none; margin:0 auto; page-break-after:always; break-after:page; }
          .ticket:last-child{ page-break-after:auto; break-after:auto; }
          .notch{ background:#fff; }
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
      {/* Top: pick a cut order */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {[{ id: "open", label: "Por cortar" }, { id: "completed", label: "Cortadas" }, { id: "all", label: "Todas" }].map((f) => (
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
              const meta = STATUS[co.status] || { label: co.status, pill: "bg-gray-100 text-gray-700" };
              const isSel = selected?.id === co.id;
              const mkCount = Array.isArray(co.markers) ? co.markers.length : 0;
              return (
                <button key={co.id} onClick={() => pickOrder(co)} className={`w-full text-left p-4 flex gap-3 items-center hover:bg-gray-50 ${isSel ? "bg-blue-50" : ""}`}>
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorForWO(co.work_order_id).dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold text-gray-900">{cutNo(co)}</span>
                      <span className={`text-[11px] rounded-full px-2 py-0.5 ${meta.pill}`}>{meta.label}</span>
                      {mkCount > 0 && (
                        <span className="text-[11px] rounded-full px-2 py-0.5 bg-slate-100 text-slate-600 inline-flex items-center gap-1">
                          <Layers className="w-3 h-3" /> {mkCount}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate">
                      {co.work_order_no} · {co.customer_name}{co.color ? ` · ${co.color}` : ""}{co.style_no ? ` · Est. ${co.style_no}` : ""}
                      {co.fabric || co.fabric_code ? ` · ${[co.fabric_code, co.fabric].filter(Boolean).join(" ")}` : ""}
                    </p>
                  </div>
                  <div className="text-right text-[11px] text-gray-500">
                    {num(co.remaining_to_cut) > 0 ? <span className="text-amber-600 font-medium">Restan {rnd(co.remaining_to_cut)}</span> : `${rnd(co.quantity)} pzas`}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Below: entry (full width) */}
      <div>
        {!selected ? (
          <div className="rounded-2xl border bg-white shadow-sm p-8 text-center text-gray-500">
            Elija una orden de corte para registrar el corte.
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
                  <span className={`text-[11px] rounded-full px-2 py-0.5 ${(STATUS[selected.status] || {}).pill || "bg-gray-100 text-gray-700"}`}>
                    {(STATUS[selected.status] || {}).label || selected.status}
                  </span>
                </div>
                <p className="text-sm text-gray-600 truncate">{selected.work_order_no} · {selected.customer_name}</p>
              </div>
            </div>

            <div className="p-5 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 text-sm border-b">
              <Info label="Estilo N°" value={selected.style_no || selected.style_code || selected.estilo} />
              <Info label="Color" value={selected.color} />
              <Info label="Season" value={selected.season} />
              <Info label="Código de tela" value={selected.fabric_code} />
              <Info label="Tela" value={selected.fabric} />
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
                  <Metric label="Marcadas" value={`${markers.filter((m) => m.done).length}/${markers.length}`} />
                  <Metric label="Paneles" value={rnd(totals.panels)} />
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
                  Añada la primera marcada para empezar a capturar.
                </button>
              ) : (
                <div className="space-y-4">
                  {markers.map((m, mi) => {
                    const panels = markerPanels(m);
                    const tot = markerTotal(m);
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
                          <input
                            value={m.name}
                            onChange={(e) => setMarkerField(m.id, "name", e.target.value)}
                            placeholder="Nombre de la marcada"
                            disabled={locked}
                            className="w-40 sm:w-56 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-gray-900 hover:border-gray-200 focus:border-gray-200 focus:bg-white outline-none focus:ring-2 focus:ring-gray-900/10 disabled:hover:border-transparent"
                          />

                          <div className="ml-auto flex items-center gap-3">
                            <div className="text-right leading-tight">
                              <div className="text-base font-bold text-blue-700">{rnd(tot)} <span className="text-xs font-medium text-gray-400">pzas</span></div>
                              <div className="text-[11px] text-gray-500">{rnd(panels)} panel(es) · {used} talla(s)</div>
                            </div>
                            {!locked && (
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

                        {/* Acciones de la marcada */}
                        <div className={`px-3 py-2.5 border-t flex flex-wrap items-center gap-2 ${locked ? "bg-green-50/60" : "bg-white"}`}>
                          {locked ? (
                            <>
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700">
                                <CheckCircle className="w-4 h-4" /> Marcada completada
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
                          ) : !m.saved ? (
                            <span className="text-xs text-gray-400">
                              Guarde el corte para poder completar e imprimir esta marcada.
                            </span>
                          ) : (
                            <>
                              <span className="text-xs text-gray-400">
                                {tickets > 0 ? `Al completar se imprimen ${tickets} ticket(s)` : "Falta capturar paneles y piezas"}
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

              {/* Acciones */}
              <div className="sticky bottom-0 -mx-5 px-5 pt-3 pb-4 bg-white/95 backdrop-blur border-t flex flex-col sm:flex-row gap-2">
                <button onClick={handleSave} disabled={saving} className="flex-1 rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
                  {saving ? "Guardando…" : `Guardar corte · ${rnd(totals.cut)} pzas`}
                </button>
                {selected.status === "completed" ? (
                  <button onClick={() => printTicket(selected)} className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50">
                    <Printer className="w-4 h-4" /> Imprimir todas las marcadas
                  </button>
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