// components/warehouse/FinishedWarehouseScan.jsx
// Almacén de Producto Terminado — Escaneo de tickets (intake).
//
// New logic: the line leader prints tickets whose QR carries all the info of that
// batch of pieces. Here the warehouse operator SCANS each physical ticket and the
// system records + shows: número de ticket, PO, orden de trabajo, talla, color,
// fecha, HORA DE ESCANEO y piezas.
//
// Scanning works two ways:
//   1. Hardware scanner (recommended): a USB/Bluetooth 2D scanner acts as a
//      keyboard — it "types" the QR text into the focused box and hits Enter.
//      The box stays auto-focused so the operator just keeps scanning.
//   2. Camera: uses the browser's native BarcodeDetector when available.
//
// Backend used:
//   POST   /api/finished-warehouse/scan             { raw }  -> { ticket, duplicate }
//   GET    /api/finished-warehouse/scanned-tickets           -> { tickets, totals }
//   DELETE /api/finished-warehouse/scanned-tickets/:id
//
//   <FinishedWarehouseScan onNavigate={setTab} />
//
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  ScanLine, Camera, CameraOff, RefreshCw, Loader2, AlertCircle, CheckCircle2,
  Trash2, Package, Boxes, ClipboardList, Clock, ArrowLeft, X,
  PackageCheck, ShieldCheck, Lock,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

// Une API_URL + path sin duplicar la base (evita http://host http://host/...).
function apiUrl(path) {
  const base = String(API_URL || "").replace(/\/+$/, "");
  let p = String(path || "");
  if (/^https?:\/\//i.test(p)) return p;          // ya es absoluta
  if (base && p.startsWith(base)) return p;        // ya incluye la base
  return base + (p.startsWith("/") ? p : `/${p}`);
}

async function api(path, opts = {}) {
  const res = await fetch(apiUrl(path), { headers: authHeaders(), ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

const num = (v) => Math.round(Number(v) || 0).toLocaleString();

// Hora de escaneo (local, con segundos) y fecha corta.
function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtDate(v) {
  if (!v) return "—";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString();
}
const sizeText = (t) => {
  const code = String(t.size_code ?? "").trim();
  const lbl = String(t.size_label ?? "").trim();
  if (code && lbl && lbl !== code) return `${code} · ${lbl}`;
  return code || lbl || "—";
};

// Pitido corto de confirmación (WebAudio). ok=éxito, dup/err=tono distinto.
function beep(kind = "ok") {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = beep._ctx || (beep._ctx = new Ctx());
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "sine";
    o.frequency.value = kind === "ok" ? 880 : kind === "dup" ? 520 : 300;
    g.gain.value = 0.08;
    o.start();
    o.stop(ctx.currentTime + (kind === "ok" ? 0.09 : 0.18));
  } catch { /* silencio si el navegador lo bloquea */ }
}

export default function FinishedWarehouseScan({ onNavigate = null }) {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({ tickets: 0, pieces: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null); // { kind: "ok"|"dup"|"err", ticket, msg }
  const [onlyToday, setOnlyToday] = useState(true);

  // Check-in (verificación de piezas -> inventario)
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);

  const inputRef = useRef(null);
  const submitLock = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = onlyToday ? `?date=${new Date().toISOString().slice(0, 10)}` : "";
      const d = await api(`/api/finished-warehouse/scanned-tickets${qs}`);
      setRows(d.tickets || []);
      setTotals(d.totals || { tickets: 0, pieces: 0 });
    } catch (e) {
      setError(e.message || "No se pudieron cargar los tickets");
    } finally {
      setLoading(false);
    }
  }, [onlyToday]);

  useEffect(() => { load(); }, [load]);

  // Mantener el cuadro de escaneo enfocado: el escáner de hardware "teclea" ahí.
  const focusInput = useCallback(() => {
    const el = inputRef.current;
    if (el && document.activeElement !== el) el.focus();
  }, []);
  useEffect(() => {
    focusInput();
    const onVis = () => { if (!document.hidden) focusInput(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", focusInput);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", focusInput);
    };
  }, [focusInput]);

  const submitScan = useCallback(async (raw) => {
    const text = String(raw ?? "").trim();
    if (!text || submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setValue("");
    try {
      const d = await api("/api/finished-warehouse/scan", {
        method: "POST",
        body: JSON.stringify({ raw: text }),
      });
      const t = d.ticket;
      if (d.duplicate) {
        beep("dup");
        setFlash({ kind: "dup", ticket: t, msg: "Ticket ya escaneado" });
        // Resáltalo si está en la lista; no lo dupliques.
        if (t) setRows((prev) => prev.map((r) => (r.id === t.id ? { ...r, _flash: Date.now() } : r)));
      } else {
        beep("ok");
        setFlash({ kind: "ok", ticket: t, msg: "Ticket registrado" });
        setRows((prev) => [{ ...t, _flash: Date.now() }, ...prev.filter((r) => r.id !== t.id)]);
        setTotals((prev) => ({ tickets: prev.tickets + 1, pieces: prev.pieces + (Number(t.pieces) || 0) }));
      }
    } catch (e) {
      beep("err");
      setFlash({ kind: "err", ticket: null, msg: e.message || "No se pudo leer el ticket" });
    } finally {
      setBusy(false);
      submitLock.current = false;
      focusInput();
    }
  }, [focusInput]);

  // Auto-submit cuando el valor "se ve completo" (QR JSON termina en "}"), y
  // también con Enter. Se limpia el valor al enviar para no duplicar.
  const onInputChange = (e) => {
    const v = e.target.value;
    setValue(v);
    const t = v.trim();
    if (t.startsWith("{") && t.endsWith("}") && t.length > 8) {
      submitScan(t);
    }
  };
  const onInputKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitScan(value);
    }
  };

  const removeRow = async (row) => {
    if (!window.confirm(`¿Quitar el ticket ${row.ticket_no || row.id} del registro?`)) return;
    try {
      await api(`/api/finished-warehouse/scanned-tickets/${row.id}`, { method: "DELETE" });
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      setTotals((prev) => ({
        tickets: Math.max(0, prev.tickets - 1),
        pieces: Math.max(0, prev.pieces - (Number(row.pieces) || 0)),
      }));
    } catch (e) {
      setError(e.message || "No se pudo quitar el ticket");
    }
  };

  // Tickets pendientes de verificar (aún no movidos a inventario).
  const pending = useMemo(() => rows.filter((r) => !r.checked_in), [rows]);
  const pendingPieces = useMemo(
    () => pending.reduce((s, r) => s + (Number(r.pieces) || 0), 0),
    [pending]
  );

  // Check-in: confirma que las piezas fueron verificadas y las suma al inventario.
  const doCheckIn = useCallback(async () => {
    const ids = pending.map((r) => r.id);
    if (ids.length === 0) return;
    setCheckingIn(true);
    try {
      const d = await api("/api/finished-warehouse/check-in", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      const doneIds = new Set((d.tickets || []).map((t) => t.id));
      setRows((prev) =>
        prev.map((r) =>
          doneIds.has(r.id)
            ? { ...r, checked_in: true, checked_in_at: new Date().toISOString(), _flash: Date.now() }
            : r
        )
      );
      setTotals((prev) => ({
        ...prev,
        pendingTickets: 0,
        pendingPieces: 0,
        checkedInTickets: (prev.checkedInTickets || 0) + (d.checkedIn || 0),
        checkedInPieces: (prev.checkedInPieces || 0) + (d.pieces || 0),
      }));
      beep("ok");
      setFlash({ kind: "ok", ticket: null, msg: d.message || `Se verificaron ${d.checkedIn} ticket(s) y se movieron al inventario.` });
      setCheckinOpen(false);
    } catch (e) {
      beep("err");
      setFlash({ kind: "err", ticket: null, msg: e.message || "No se pudo completar el check-in." });
    } finally {
      setCheckingIn(false);
      focusInput();
    }
  }, [pending, focusInput]);

  // Resumen por orden de trabajo (tickets + piezas).
  const byOrder = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const k = r.work_order_no || "—";
      const cur = m.get(k) || { wo: k, tickets: 0, pieces: 0 };
      cur.tickets += 1;
      cur.pieces += Number(r.pieces) || 0;
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.pieces - a.pieces);
  }, [rows]);

  return (
    <div className="max-w-6xl mx-auto p-5 space-y-5" onClick={focusInput}>
      <header className="flex items-center gap-3">
        {onNavigate && (
          <button
            onClick={() => onNavigate("dashboard")}
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border text-gray-600 hover:bg-gray-50"
            title="Volver al tablero"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
        <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
          <ScanLine className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-gray-900">Escaneo de tickets</h1>
          <p className="text-sm text-gray-500">Escanee cada ticket de producción; el sistema registra su información y la hora de escaneo.</p>
        </div>
        <button
          onClick={() => setCheckinOpen(true)}
          disabled={pending.length === 0}
          title={pending.length === 0 ? "No hay tickets pendientes por verificar" : "Verificar piezas y moverlas al inventario"}
          className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          <PackageCheck className="w-4 h-4" />
          Check-in
          {pending.length > 0 && (
            <span className="ml-0.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-white/20 text-xs font-bold">
              {pending.length}
            </span>
          )}
        </button>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Actualizar
        </button>
      </header>

      {/* Scan box + camera */}
      <section className="bg-white rounded-xl border shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <ScanLine className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              ref={inputRef}
              value={value}
              onChange={onInputChange}
              onKeyDown={onInputKeyDown}
              autoFocus
              inputMode="text"
              placeholder="Escanee un ticket o pegue el código y presione Enter…"
              className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {busy && <Loader2 className="w-4 h-4 text-indigo-500 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />}
          </div>
          <button
            onClick={() => submitScan(value)}
            disabled={busy || !value.trim()}
            className="inline-flex items-center gap-2 px-3 py-2.5 rounded-lg bg-gray-900 text-white text-sm font-medium disabled:bg-gray-300"
          >
            Registrar
          </button>
          <CameraScanner onScan={submitScan} />
        </div>

        {/* Last scan feedback */}
        {flash && (
          <div
            className={`rounded-lg px-3 py-2.5 text-sm flex items-start gap-2 ${
              flash.kind === "ok" ? "bg-emerald-50 text-emerald-800"
              : flash.kind === "dup" ? "bg-amber-50 text-amber-800"
              : "bg-red-50 text-red-700"
            }`}
          >
            {flash.kind === "ok" ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
            <div className="min-w-0">
              <div className="font-medium">{flash.msg}</div>
              {flash.ticket && (
                <div className="text-xs mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono">
                  <span className="font-semibold">{flash.ticket.folio || flash.ticket.ticket_no || "—"}</span>
                  {flash.ticket.customer_name && <span>{flash.ticket.customer_name}</span>}
                  <span>OT {flash.ticket.work_order_no || "—"}</span>
                  <span>PO {flash.ticket.customer_po || "—"}</span>
                  <span>{sizeText(flash.ticket)}</span>
                  <span>{flash.ticket.color || "—"}</span>
                  <span>{num(flash.ticket.pieces)} pzas</span>
                </div>
              )}
            </div>
            <button onClick={() => setFlash(null)} className="ml-auto text-current/60 hover:text-current">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </section>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile icon={ClipboardList} label={onlyToday ? "Tickets hoy" : "Tickets"} value={totals.tickets} accent="indigo" />
        <Tile icon={Package} label="Piezas escaneadas" value={totals.pieces} accent="emerald" />
        <Tile icon={Boxes} label="Órdenes distintas" value={byOrder.length} accent="gray" />
        <div className="bg-white rounded-xl border shadow-sm p-3 flex items-center">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyToday}
              onChange={(e) => setOnlyToday(e.target.checked)}
              className="w-4 h-4 accent-indigo-600"
            />
            Solo hoy
          </label>
        </div>
      </div>

      {/* Per-order summary */}
      {byOrder.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {byOrder.map((o) => (
            <span key={o.wo} className="inline-flex items-center gap-1.5 text-xs rounded-lg border border-gray-100 bg-gray-50 px-2 py-1">
              <span className="font-medium text-gray-700">OT {o.wo}</span>
              <span className="text-gray-300">·</span>
              <span className="font-mono text-gray-900">{num(o.pieces)} pzas</span>
              <span className="text-gray-400">({o.tickets} tkt)</span>
            </span>
          ))}
        </div>
      )}

      {/* Scanned tickets table */}
      <section className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <ScanLine className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-800">Tickets escaneados</h2>
          <span className="text-xs text-gray-400">{rows.length} registro(s)</span>
        </div>

        {error ? (
          <div className="p-4 text-sm text-amber-700 bg-amber-50 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        ) : loading ? (
          <div className="p-8 text-center text-gray-400 text-sm flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            Aún no se ha escaneado ningún ticket{onlyToday ? " hoy" : ""}. Escanee uno para empezar.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b bg-gray-50/60">
                  <th className="px-3 py-2 font-medium">Ticket</th>
                  <th className="px-3 py-2 font-medium">Cliente</th>
                  <th className="px-3 py-2 font-medium">Orden</th>
                  <th className="px-3 py-2 font-medium">PO</th>
                  <th className="px-3 py-2 font-medium">Talla</th>
                  <th className="px-3 py-2 font-medium">Color</th>
                  <th className="px-3 py-2 font-medium">Fecha</th>
                  <th className="px-3 py-2 font-medium">Hora escaneo</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 font-medium text-right">Piezas</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={`transition-colors ${r._flash && Date.now() - r._flash < 2500 ? "bg-emerald-50" : "hover:bg-gray-50"}`}
                  >
                    <td
                      className="px-3 py-2 font-mono font-semibold text-gray-900"
                      title={r.ticket_no ? `Ticket impreso: ${r.ticket_no}` : undefined}
                    >
                      {r.folio || r.ticket_no || "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{r.customer_name || r.customer_code || "—"}</td>
                    <td className="px-3 py-2 font-mono">{r.work_order_no || "—"}</td>
                    <td className="px-3 py-2 font-mono">{r.customer_po || "—"}</td>
                    <td className="px-3 py-2">{sizeText(r)}</td>
                    <td className="px-3 py-2">{r.color || "—"}</td>
                    <td className="px-3 py-2 text-gray-600">{fmtDate(r.production_date)}</td>
                    <td className="px-3 py-2 text-gray-600">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3 text-gray-400" />{fmtTime(r.scanned_at)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {r.checked_in ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">
                          <PackageCheck className="w-3 h-3" /> En inventario
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
                          <Clock className="w-3 h-3" /> Pendiente
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-gray-900">{num(r.pieces)}</td>
                    <td className="px-3 py-2 text-right">
                      {r.checked_in ? (
                        <span className="text-gray-300" title="Verificado — ya está en inventario">
                          <Lock className="w-4 h-4 inline" />
                        </span>
                      ) : (
                        <button
                          onClick={() => removeRow(r)}
                          className="text-gray-300 hover:text-red-500"
                          title="Quitar ticket"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-gray-50/60 text-sm">
                  <td className="px-3 py-2 font-medium text-gray-500" colSpan={9}>Total</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-gray-900">
                    {num(rows.reduce((s, r) => s + (Number(r.pieces) || 0), 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* Check-in confirmation modal */}
      {checkinOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !checkingIn && setCheckinOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 p-5 border-b">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-gray-900">Confirmar check-in de piezas</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  Confirme que las piezas de estos tickets fueron <span className="font-medium text-gray-700">verificadas físicamente</span>. Al confirmar, se moverán al inventario de producto terminado.
                </p>
              </div>
            </div>

            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border bg-gray-50 p-3">
                  <div className="text-xs text-gray-500">Tickets por verificar</div>
                  <div className="mt-1 text-2xl font-semibold text-gray-900">{num(pending.length)}</div>
                </div>
                <div className="rounded-xl border bg-emerald-50 p-3">
                  <div className="text-xs text-emerald-700">Piezas a inventario</div>
                  <div className="mt-1 text-2xl font-semibold text-emerald-800">{num(pendingPieces)}</div>
                </div>
              </div>
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Una vez verificados, estos tickets ya no podrán quitarse del registro, porque sus piezas quedarán sumadas al inventario.</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 p-4 bg-gray-50 border-t">
              <button
                onClick={() => setCheckinOpen(false)}
                disabled={checkingIn}
                className="px-4 py-2 rounded-lg border text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={doCheckIn}
                disabled={checkingIn || pending.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:bg-gray-300"
              >
                {checkingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
                Verificar y mover a inventario
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cámara: usa el BarcodeDetector nativo del navegador cuando está disponible.
// Si no lo está (algunos navegadores), se oculta y el operador usa el escáner
// de hardware o el cuadro de texto.
// ---------------------------------------------------------------------------
function CameraScanner({ onScan }) {
  const [supported] = useState(() => typeof window !== "undefined" && "BarcodeDetector" in window);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const lastRef = useRef({ text: "", at: 0 });

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setOn(false);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const start = useCallback(async () => {
    setErr(null);
    try {
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
      });
      streamRef.current = stream;
      setOn(true);
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();

      const tick = async () => {
        if (!streamRef.current) return;
        try {
          const codes = await detector.detect(video);
          if (codes && codes.length) {
            const text = String(codes[0].rawValue || "").trim();
            const now = Date.now();
            // Evita disparar el mismo QR muchas veces mientras sigue frente a la cámara.
            if (text && (text !== lastRef.current.text || now - lastRef.current.at > 2500)) {
              lastRef.current = { text, at: now };
              onScan(text);
            }
          }
        } catch { /* frame sin código */ }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setErr(e.message || "No se pudo abrir la cámara");
      stop();
    }
  }, [onScan, stop]);

  if (!supported) return null;

  return (
    <>
      <button
        onClick={() => (on ? stop() : start())}
        className={`inline-flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border ${
          on ? "border-red-200 text-red-600 hover:bg-red-50" : "text-gray-700 hover:bg-gray-50"
        }`}
      >
        {on ? <CameraOff className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
        {on ? "Cerrar cámara" : "Cámara"}
      </button>

      {on && (
        <div className="w-full mt-2">
          <div className="relative w-full max-w-sm mx-auto rounded-xl overflow-hidden border bg-black">
            <video ref={videoRef} playsInline muted className="w-full h-auto block" />
            <div className="pointer-events-none absolute inset-6 border-2 border-white/70 rounded-lg" />
          </div>
          <p className="text-xs text-gray-400 text-center mt-1">Apunte la cámara al código QR del ticket.</p>
        </div>
      )}
      {err && <p className="text-xs text-red-500 w-full">{err}</p>}
    </>
  );
}

function Tile({ icon: Icon, label, value, accent = "gray" }) {
  const accents = {
    emerald: "text-emerald-600 bg-emerald-50",
    indigo: "text-indigo-600 bg-indigo-50",
    gray: "text-gray-600 bg-gray-100",
  };
  return (
    <div className="bg-white rounded-xl border shadow-sm p-3">
      <div className="flex items-center gap-2">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${accents[accent] || accents.gray}`}>
          {Icon && <Icon className="w-4 h-4" />}
        </span>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className="mt-2 text-xl font-semibold text-gray-900">{num(value)}</div>
    </div>
  );
}