// components/cutting/CutTicketScan.jsx
//
// ESCANEO DE TICKETS DE CORTE (uno por panel).
// ------------------------------------------------------------------------
// Pensado para la mesa que recibe los paneles cortados. Funciona con:
//   · Lector de código tipo teclado (USB / Bluetooth): sólo hay que disparar;
//     el campo de escaneo recupera el foco solo y procesa al recibir Enter.
//   · Cámara del dispositivo (Chrome / Edge / Android, vía BarcodeDetector).
//   · Escribir el código a mano.
//
// Por cada escaneo muestra la orden, talla, PANEL n DE N (con una tira que marca
// qué paneles de esa talla ya se escanearon y cuáles faltan), piezas por panel
// y piezas de la talla. Avisa si el ticket ya se escaneó, si la marcada no está
// verificada o si la marcada cambió después de imprimir.
//
// El historial vive en sessionStorage (por pestaña). Si después se quiere
// registrar la recepción en el servidor, el punto de enganche es `record()`.
//
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  ScanLine, Camera, X, CheckCircle, AlertTriangle, XCircle,
  Trash2, Layers, Volume2, VolumeX, RefreshCw,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";
import { parseTicketCode, ticketKey } from "./ticketCode";

/* ------------------------------------------------------------------------ */
const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});
const num = (v) => Number(v) || 0;
const rnd = (v) => Math.round(num(v)).toLocaleString();
const norm = (s) => String(s ?? "").trim().toUpperCase();
const cutNo = (id) => `CORTE-${String(id).padStart(4, "0")}`;
const hhmm = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const SIZE_LABELS = {
  "130": "XXXS", "132": "XXS", "134": "XS", "136": "S", "138": "M",
  "140": "L", "142": "XL", "144": "XXL",
  "146": "XXXL", "148": "S-T", "150": "M-T", "152": "L-T", "154": "XL-T", "156": "2XL-T",
  "004": "I-XS", "006": "S", "008": "M", "010": "L",
};
const tallaLabel = (t) => SIZE_LABELS[norm(t)] || "";

const STORAGE_KEY = "cutTicketScans.v1";
const loadLog = () => {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
};

// Sonido corto de confirmación / error (sin archivos de audio).
let audioCtx = null;
const beep = (kind) => {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const tones = kind === "ok" ? [[880, 0.09]] : kind === "warn" ? [[660, 0.08], [660, 0.08]] : [[220, 0.3]];
    let t = audioCtx.currentTime;
    tones.forEach(([f, d]) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = f;
      o.type = kind === "error" ? "square" : "sine";
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g).connect(audioCtx.destination);
      o.start(t);
      o.stop(t + d);
      t += d + 0.05;
    });
    if (navigator.vibrate) navigator.vibrate(kind === "ok" ? 40 : [60, 40, 60]);
  } catch { /* sin audio: no pasa nada */ }
};

/* Busca en la orden de corte la marcada + talla del ticket ---------------- */
const resolveTicket = (p, co) => {
  const markers = Array.isArray(co?.markers) ? co.markers : [];
  const named = (m, i) => m?.name || `Marcada ${i + 1}`;
  let mi = p.markerId ? markers.findIndex((m) => m?.id && m.id === p.markerId) : -1;
  if (mi < 0 && p.marker) mi = markers.findIndex((m, i) => norm(named(m, i)) === norm(p.marker));
  const marker = mi >= 0 ? markers[mi] : null;

  let line = null;
  if (marker) {
    line = (marker.lines || []).find((l) => norm(l.talla) === norm(p.talla)) || null;
  } else if (!p.marker) {
    // Tickets de órdenes antiguas sin marcadas.
    const prog = Array.isArray(co?.size_progress) ? co.size_progress : [];
    line = prog.find((r) => norm(r.talla) === norm(p.talla)) || null;
  }
  const panelCountNow = line
    ? Math.round(num(line.panels != null ? line.panels : marker?.panels))
    : 0;
  const perPanel = line
    ? num(line.perPanel) || (panelCountNow > 0 && line.amountCut != null ? num(line.amountCut) / panelCountNow : 0)
    : num(p.pieces);
  const pedido = (Array.isArray(co?.sizes) ? co.sizes : []).find((s) => norm(s.talla) === norm(p.talla));

  return {
    marker,
    markerName: marker ? named(marker, mi) : p.marker || "",
    markerKey: marker?.id || p.markerId || p.marker || "",
    line,
    panelCount: panelCountNow || p.panelCount || 0,
    panelCountPrinted: p.panelCount,
    perPanel,
    talla: line?.talla ?? p.talla,
    pedido: pedido ? num(pedido.quantity) : null,
  };
};

/* ======================================================================== */
export default function CutTicketScan() {
  const [orders, setOrders] = useState(new Map());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [code, setCode] = useState("");
  const [result, setResult] = useState(null); // último escaneo procesado
  const [log, setLog] = useState(loadLog);
  const [sound, setSound] = useState(true);
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef(null);
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const logRef = useRef(log);
  logRef.current = log;
  const handleRef = useRef(null);

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(log.slice(0, 500))); } catch { /* lleno */ }
  }, [log]);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`${API_URL}/api/cut-orders`, { headers: authHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "No se pudieron cargar las órdenes de corte");
      const map = new Map((data.cutOrders || []).map((co) => [Number(co.id), co]));
      setOrders(map);
      return map;
    } catch (err) {
      setLoadError(err.message);
      return ordersRef.current;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // Un lector tipo teclado "escribe" donde esté el foco: si el foco no está en
  // otro campo, lo regresamos al campo de escaneo en cuanto llega una tecla.
  useEffect(() => {
    const onKey = (e) => {
      if (cameraOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key.length === 1) inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cameraOpen]);

  const notify = (kind) => { if (sound) beep(kind); };

  // ---- Procesar un código ------------------------------------------------
  const handleCode = async (rawInput) => {
    const raw = String(rawInput || "").trim();
    setCode("");
    if (!raw) return;

    const p = parseTicketCode(raw);
    if (!p) {
      notify("error");
      return setResult({ state: "error", title: "Este código no es un ticket de corte", detail: raw });
    }

    let co = ordersRef.current.get(p.cutId);
    if (!co) co = (await fetchOrders()).get(p.cutId); // quizá es una orden nueva
    if (!co) {
      notify("error");
      return setResult({ state: "error", title: `No se encontró ${cutNo(p.cutId)}`, detail: "Revise que la orden no se haya eliminado o cancelado." });
    }

    const r = resolveTicket(p, co);
    const key = ticketKey({ cutId: p.cutId, markerId: r.markerKey, talla: r.talla, panelNo: p.panelNo });
    const previous = logRef.current.find((e) => e.key === key);

    const warnings = [];
    if (p.marker && !r.marker) warnings.push(`La marcada "${p.marker}" ya no existe en la orden. Pida reimprimir los tickets.`);
    else if (!r.line) warnings.push(`La talla ${p.talla} no está en esta marcada.`);
    if (r.marker && !r.marker.done) warnings.push("La marcada todavía no está verificada por el supervisor de corte.");
    if (r.panelCountPrinted && r.line && r.panelCountPrinted !== r.panelCount) {
      warnings.push(`El ticket dice ${r.panelCountPrinted} paneles y la marcada ahora tiene ${r.panelCount}. Pida reimprimir.`);
    }
    if (p.panelNo && r.panelCount && p.panelNo > r.panelCount) {
      warnings.push(`El panel ${p.panelNo} no existe: esta talla tiene ${r.panelCount} paneles.`);
    }
    if (co.status === "cancelled") warnings.push("La orden de corte está cancelada.");

    const broken = (p.marker && !r.marker) || !r.line || co.status === "cancelled";
    const state = broken ? "error" : previous ? "duplicate" : warnings.length ? "warn" : "ok";

    const entry = {
      key,
      at: new Date().toISOString(),
      cutId: p.cutId,
      workOrderNo: co.work_order_no || p.workOrderNo,
      customer: co.customer_name || "",
      markerKey: r.markerKey,
      markerName: r.markerName,
      talla: r.talla,
      panelNo: p.panelNo,
      panelCount: r.panelCount,
      pieces: r.perPanel,
      state,
    };
    // Sólo cuentan como recibidos los tickets válidos y que no son repetidos.
    if (state === "ok" || state === "warn") setLog((l) => [entry, ...l]);
    notify(state === "ok" ? "ok" : state === "error" ? "error" : "warn");

    setResult({ state, co, p, r, entry, warnings, previous });
  };

  handleRef.current = handleCode;
  const onCameraCode = useCallback((c) => handleRef.current?.(c), []);
  const onCameraClose = useCallback(() => {
    setCameraOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // ---- Agrupado: paneles escaneados por corte · marcada · talla -----------
  const groups = useMemo(() => {
    const map = new Map();
    log.forEach((e) => {
      const g = `${e.cutId}|${norm(e.markerKey)}|${norm(e.talla)}`;
      const cur = map.get(g) || { id: g, ...e, panels: new Set(), last: e.at, pieces: 0 };
      if (e.panelNo != null && !cur.panels.has(e.panelNo)) {
        cur.panels.add(e.panelNo);
        cur.pieces += num(e.pieces);
      }
      cur.panelCount = Math.max(num(cur.panelCount), num(e.panelCount));
      if (e.at > cur.last) cur.last = e.at;
      map.set(g, cur);
    });
    return [...map.values()].sort((a, b) => (a.last < b.last ? 1 : -1));
  }, [log]);

  const scannedPanelsFor = (cutId, markerKey, talla) =>
    groups.find((g) => g.id === `${cutId}|${norm(markerKey)}|${norm(talla)}`)?.panels || new Set();

  const totals = useMemo(() => ({
    tickets: groups.reduce((s, g) => s + g.panels.size, 0),
    pieces: groups.reduce((s, g) => s + g.pieces, 0),
  }), [groups]);

  const clearLog = () => {
    if (!log.length || !window.confirm("¿Borrar los tickets escaneados en esta sesión?")) return;
    setLog([]);
    setResult(null);
    inputRef.current?.focus();
  };

  /* ---------------------------------------------------------------------- */
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <ScanLine className="w-5 h-5 text-gray-400" />
        <h1 className="text-lg font-bold text-gray-900">Escanear tickets</h1>
        <span className="text-xs text-gray-500">Escanee cada ticket al recibir el panel.</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setSound((s) => !s)}
            title={sound ? "Silenciar" : "Activar sonido"}
            className="p-2 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
          >
            {sound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button
            onClick={fetchOrders}
            title="Actualizar órdenes"
            className="p-2 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Campo de escaneo */}
      <form
        onSubmit={(e) => { e.preventDefault(); handleCode(code); }}
        className="flex gap-2"
      >
        <label className="relative flex-1">
          <span className="sr-only">Código del ticket</span>
          <ScanLine className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={inputRef}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Escanee el ticket o escriba el código"
            autoComplete="off"
            spellCheck={false}
            className="w-full pl-11 pr-3 py-3.5 text-base rounded-xl border-2 border-gray-200 bg-white focus:outline-none focus:border-gray-900 font-mono"
          />
        </label>
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          className="inline-flex items-center gap-2 px-4 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gray-900"
        >
          <Camera className="w-4 h-4" /> <span className="hidden sm:inline">Cámara</span>
        </button>
      </form>

      {loadError && (
        <div className="text-sm rounded-lg bg-red-50 text-red-700 px-3 py-2">
          No se pudieron cargar las órdenes: {loadError}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <ScanResult result={result} scannedPanelsFor={scannedPanelsFor} loading={loading && !orders.size} />

        {/* Historial de la sesión */}
        <aside className="rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div>
              <div className="text-sm font-semibold text-gray-900">Recibido en esta sesión</div>
              <div className="text-xs text-gray-500">
                {rnd(totals.tickets)} panel{totals.tickets === 1 ? "" : "es"} · {rnd(totals.pieces)} piezas
              </div>
            </div>
            {log.length > 0 && (
              <button onClick={clearLog} title="Borrar historial" className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
          {groups.length === 0 ? (
            <p className="px-4 py-8 text-sm text-gray-500 text-center">
              Los tickets que escanee aparecerán aquí, agrupados por marcada y talla.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
              {groups.map((g) => {
                const complete = g.panelCount > 0 && g.panels.size >= g.panelCount;
                return (
                  <li key={g.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-900 truncate">
                        {cutNo(g.cutId)} · T{g.talla}{tallaLabel(g.talla) ? ` (${tallaLabel(g.talla)})` : ""}
                      </span>
                      <span className={`text-xs font-semibold tabular-nums ${complete ? "text-green-700" : "text-gray-700"}`}>
                        {g.panels.size}{g.panelCount ? ` de ${g.panelCount}` : ""}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {g.markerName || "Sin marcada"} · {g.workOrderNo} · {hhmm(g.last)}
                    </div>
                    {g.panelCount > 0 && (
                      <PanelStrip count={g.panelCount} scanned={g.panels} size="sm" />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>

      {cameraOpen && (
        <CameraScanner onClose={onCameraClose} onCode={onCameraCode} last={result} />
      )}
    </div>
  );
}

/* ======================================================================== */
/* Tira de paneles: un segmento por panel de la talla                       */
/* ======================================================================== */
function PanelStrip({ count, scanned, current = null, size = "lg" }) {
  // Con muchos paneles, los segmentos se vuelven una barra continua legible.
  const items = Array.from({ length: count }, (_, i) => i + 1);
  const h = size === "lg" ? "h-3" : "h-1.5";
  return (
    <div
      className={`flex gap-0.5 ${size === "lg" ? "mt-3" : "mt-2"}`}
      role="img"
      aria-label={`${scanned.size} de ${count} paneles escaneados`}
    >
      {items.map((n) => {
        const isCurrent = n === current;
        const done = scanned.has(n);
        return (
          <span
            key={n}
            title={`Panel ${n}${done ? " · escaneado" : " · falta"}`}
            className={`flex-1 rounded-sm ${h} ${
              isCurrent ? "bg-gray-900" : done ? "bg-green-500" : "bg-gray-200"
            }`}
          />
        );
      })}
    </div>
  );
}

/* ======================================================================== */
/* Resultado del último escaneo                                             */
/* ======================================================================== */
const STATE_META = {
  ok:        { icon: CheckCircle,   bar: "bg-green-600", text: "text-white", label: "Ticket recibido" },
  warn:      { icon: AlertTriangle, bar: "bg-amber-400", text: "text-amber-950", label: "Recibido con aviso" },
  duplicate: { icon: AlertTriangle, bar: "bg-amber-400", text: "text-amber-950", label: "Ticket ya escaneado" },
  error:     { icon: XCircle,       bar: "bg-red-600",   text: "text-white", label: "No se pudo recibir" },
};

function ScanResult({ result, scannedPanelsFor, loading }) {
  if (!result) {
    return (
      <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white grid place-items-center text-center px-6 py-16">
        <div>
          <ScanLine className="w-10 h-10 text-gray-300 mx-auto" />
          <p className="mt-3 text-base font-semibold text-gray-800">
            {loading ? "Cargando órdenes de corte…" : "Listo para escanear"}
          </p>
          <p className="mt-1 text-sm text-gray-500 max-w-sm">
            Apunte el lector al código QR del ticket. Verá la talla, el número de panel y cuántos faltan.
          </p>
        </div>
      </div>
    );
  }

  const meta = STATE_META[result.state];
  const Icon = meta.icon;

  // Error sin orden identificada: sólo el aviso.
  if (!result.co) {
    return (
      <div className="rounded-xl overflow-hidden border border-red-200 bg-white">
        <div className={`${meta.bar} ${meta.text} px-5 py-4 flex items-center gap-3`}>
          <Icon className="w-6 h-6 flex-none" />
          <div className="min-w-0">
            <div className="font-semibold">{result.title}</div>
            {result.detail && <div className="text-sm opacity-90 break-all font-mono">{result.detail}</div>}
          </div>
        </div>
      </div>
    );
  }

  const { co, p, r, warnings, previous } = result;
  const scanned = scannedPanelsFor(co.id, r.markerKey, r.talla);
  const estilo = co.modelo_code || co.style_no || co.style_code || co.estilo || "—";
  const tela = [r.marker?.fabricCode, r.marker?.fabricName].filter(Boolean).join(" ")
    || [co.fabric_code, co.fabric].filter(Boolean).join(" ") || "—";
  const missing = r.panelCount > 0
    ? Array.from({ length: r.panelCount }, (_, i) => i + 1).filter((n) => !scanned.has(n))
    : [];
  const markerPanelsTotal = r.marker
    ? (r.marker.lines || []).reduce((s, l) => s + num(l.panels), 0) || num(r.marker.panels)
    : 0;

  return (
    <div key={result.entry?.at} className="rounded-xl overflow-hidden border border-gray-200 bg-white">
      {/* Estado */}
      <div className={`${meta.bar} ${meta.text} px-5 py-3 flex items-center gap-3`}>
        <Icon className="w-6 h-6 flex-none" />
        <div className="font-semibold">{meta.label}</div>
        {previous && (
          <div className="text-sm ml-auto">a las {hhmm(previous.at)}</div>
        )}
      </div>

      <div className="p-5 space-y-5">
        {/* Orden */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm font-mono font-semibold text-gray-900">{cutNo(co.id)}</span>
          <span className="text-sm text-gray-600">{co.work_order_no}</span>
          <span className="text-sm text-gray-900 font-medium truncate">{co.customer_name}</span>
          {co.customer_po && <span className="text-sm text-gray-500">PO {co.customer_po}</span>}
        </div>

        {/* Talla y panel: lo que se lee de lejos */}
        <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
          <div>
            <div className="text-xs text-gray-500">Talla</div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-4xl font-extrabold text-gray-900 tabular-nums leading-none">{r.talla}</span>
              {tallaLabel(r.talla) && (
                <span className="text-2xl font-bold border-2 border-gray-900 rounded-lg px-2 leading-tight">
                  {tallaLabel(r.talla)}
                </span>
              )}
            </div>
          </div>

          <div className="sm:pl-6 sm:border-l sm:border-gray-200">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <div className="text-xs text-gray-500">Panel</div>
                <div className="mt-1 leading-none">
                  <span className="text-5xl font-extrabold text-gray-900 tabular-nums">{p.panelNo ?? "—"}</span>
                  <span className="text-2xl font-bold text-gray-400 tabular-nums"> de {r.panelCount || "?"}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-500">Escaneados</div>
                <div className="mt-1 text-xl font-bold tabular-nums text-gray-900">
                  {scanned.size}<span className="text-gray-400">/{r.panelCount || "?"}</span>
                </div>
              </div>
            </div>
            {r.panelCount > 0 && r.panelCount <= 200 && (
              <PanelStrip count={r.panelCount} scanned={scanned} current={p.panelNo} />
            )}
            <div className="mt-2 text-xs text-gray-500">
              {r.panelCount > 0 && missing.length === 0
                ? <span className="text-green-700 font-medium">Talla completa: todos los paneles recibidos.</span>
                : missing.length > 0 && missing.length <= 12
                ? <>Faltan los paneles {missing.join(", ")}</>
                : missing.length > 12
                ? <>Faltan {missing.length} paneles</>
                : null}
            </div>
          </div>
        </div>

        {/* Avisos */}
        {warnings.length > 0 && (
          <ul className="space-y-1.5">
            {warnings.map((w) => (
              <li key={w} className="flex gap-2 text-sm rounded-lg bg-amber-50 text-amber-900 px-3 py-2">
                <AlertTriangle className="w-4 h-4 flex-none mt-0.5" /> {w}
              </li>
            ))}
          </ul>
        )}

        {/* Cantidades */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-gray-200 rounded-lg overflow-hidden border border-gray-200">
          <Stat label="Piezas en este panel" value={rnd(r.perPanel)} strong />
          <Stat label="Piezas de la talla" value={r.panelCount ? rnd(r.panelCount * r.perPanel) : "—"} hint={r.panelCount ? `${r.panelCount} × ${rnd(r.perPanel)}` : null} />
          <Stat label="Pedido de la talla" value={r.pedido != null ? rnd(r.pedido) : "—"} />
          <Stat label="Paneles de la marcada" value={markerPanelsTotal ? rnd(markerPanelsTotal) : "—"} hint="todas las tallas" />
        </div>

        {/* Detalle */}
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
          <Detail label="Marcada">
            <span className="inline-flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-gray-400" />
              {r.markerName || "—"}
              {r.marker && (
                <span className={`text-[11px] rounded-full px-2 py-0.5 ${r.marker.done ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800"}`}>
                  {r.marker.done ? "Verificada" : "Sin verificar"}
                </span>
              )}
            </span>
          </Detail>
          <Detail label="Estilo">{estilo}</Detail>
          <Detail label="Color">{co.color || "—"}</Detail>
          <Detail label="Tela" wide>{tela}</Detail>
          <Detail label="Season">{co.season || "—"}</Detail>
        </dl>
      </div>
    </div>
  );
}

function Stat({ label, value, hint, strong }) {
  return (
    <div className="bg-white px-3 py-2.5">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`tabular-nums ${strong ? "text-2xl font-extrabold text-gray-900" : "text-xl font-bold text-gray-800"}`}>{value}</div>
      {hint && <div className="text-[11px] text-gray-400">{hint}</div>}
    </div>
  );
}

function Detail({ label, children, wide }) {
  return (
    <div className={`min-w-0 ${wide ? "col-span-2 sm:col-span-1" : ""}`}>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900 break-words">{children}</dd>
    </div>
  );
}

/* ======================================================================== */
/* Cámara (BarcodeDetector)                                                 */
/* ======================================================================== */
function CameraScanner({ onClose, onCode, last }) {
  const videoRef = useRef(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState(false);
  const lastRef = useRef({ code: "", at: 0 });

  useEffect(() => {
    let stream = null;
    let raf = 0;
    let stopped = false;

    const start = async () => {
      if (!("BarcodeDetector" in window)) {
        setError("Este navegador no puede leer códigos con la cámara. Use Chrome o Edge, o un lector USB.");
        return;
      }
      try {
        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped) return;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();

        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(video);
            const value = codes[0]?.rawValue;
            const now = Date.now();
            // Evita leer el mismo ticket varias veces mientras sigue enfrente.
            if (value && (value !== lastRef.current.code || now - lastRef.current.at > 2500)) {
              lastRef.current = { code: value, at: now };
              setFlash(true);
              setTimeout(() => setFlash(false), 250);
              onCode(value);
            }
          } catch { /* cuadro sin código */ }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        setError(
          err?.name === "NotAllowedError"
            ? "Permita el acceso a la cámara en el navegador para escanear."
            : "No se pudo abrir la cámara."
        );
      }
    };
    start();

    const onEsc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      window.removeEventListener("keydown", onEsc);
    };
  }, [onClose, onCode]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Escanear con cámara">
      <div className="w-full max-w-md rounded-xl overflow-hidden bg-gray-900">
        <div className="flex items-center justify-between px-4 py-3 text-white">
          <span className="text-sm font-medium">Apunte al código QR del ticket</span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10" aria-label="Cerrar cámara">
            <X className="w-5 h-5" />
          </button>
        </div>
        {error ? (
          <p className="px-4 pb-6 text-sm text-red-300">{error}</p>
        ) : (
          <div className="relative aspect-square bg-black">
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
            <div className={`absolute inset-[18%] rounded-xl border-4 transition-colors ${flash ? "border-green-400" : "border-white/70"}`} />
          </div>
        )}
        <CameraLastResult result={last} />
      </div>
    </div>
  );
}

// Resumen del último escaneo dentro de la ventana de cámara, para no tener
// que cerrarla entre ticket y ticket.
function CameraLastResult({ result }) {
  if (!result) {
    return <p className="px-4 py-3 text-xs text-gray-400">Puede escanear varios tickets seguidos sin cerrar esta ventana.</p>;
  }
  const meta = STATE_META[result.state];
  const Icon = meta.icon;
  const r = result.r;
  return (
    <div key={result.entry?.at || result.title} className={`${meta.bar} ${meta.text} px-4 py-3 flex items-center gap-3`}>
      <Icon className="w-5 h-5 flex-none" />
      {r ? (
        <div className="min-w-0 flex-1 flex items-baseline justify-between gap-3">
          <span className="font-semibold truncate">
            T{r.talla}{tallaLabel(r.talla) ? ` ${tallaLabel(r.talla)}` : ""} · {meta.label}
          </span>
          <span className="font-bold tabular-nums whitespace-nowrap">
            Panel {result.p.panelNo ?? "—"} de {r.panelCount || "?"}
          </span>
        </div>
      ) : (
        <span className="font-semibold truncate">{result.title}</span>
      )}
    </div>
  );
}