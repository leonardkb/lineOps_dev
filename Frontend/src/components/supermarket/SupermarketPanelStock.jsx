// components/supermarket/SupermarketPanelStock.jsx
//
// Pestaña "Recibir paneles": el supermercado escanea el QR de cada ticket que
// llega de inspección de paneles. Cada escaneo entra al stock UNA vez y la
// pantalla muestra al instante cuántos paneles de esa orden ya están contra
// los que se cortaron, por marcada y talla.
//
// Tres formas de escanear: la CÁMARA del celular/tableta (botón "Cámara"),
// un lector USB/Bluetooth (escribe el código y manda Enter; el cursor vuelve
// solo al campo) o pegar el enlace del ticket.

import { useState, useEffect, useRef, useCallback } from "react";
import { ScanLine, Search, CheckCircle2, AlertTriangle, XCircle, Undo2, Loader2, PackageCheck, Camera } from "lucide-react";
import CameraScanner from "./CameraScanner";
import { API_URL } from "../../lib/masterCodeCatalog";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});
const n0 = (v) => Math.round(Number(v) || 0).toLocaleString();
const SIZE_LABELS = {
  "130": "XXXS", "132": "XXS", "134": "XS", "136": "S", "138": "M",
  "140": "L", "142": "XL", "144": "XXL",
  "004": "I-XS", "006": "S", "008": "M", "010": "L",
};
const tallaLabel = (t) => SIZE_LABELS[String(t ?? "").trim().toUpperCase()] || "";
const sortTallas = (list) => [...list].sort((a, b) => {
  const na = Number(a), nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a).localeCompare(String(b));
});

// Tonos cortos para que el operador no tenga que mirar la pantalla en cada panel.
function beep(kind) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = beep.ctx || (beep.ctx = new Ctx());
    const seq = kind === "ok" ? [[880, 0.09]] : kind === "duplicate" ? [[520, 0.09], [520, 0.09]] : [[200, 0.35]];
    let t = ctx.currentTime;
    for (const [f, d] of seq) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; o.type = "sine"; g.gain.value = 0.15;
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + d); t += d + 0.06;
    }
  } catch { /* sin audio */ }
}

const RESULT_STYLE = {
  ok: { box: "bg-emerald-50 border-emerald-300", icon: CheckCircle2, iconCls: "text-emerald-600", title: "text-emerald-800" },
  duplicate: { box: "bg-amber-50 border-amber-300", icon: AlertTriangle, iconCls: "text-amber-600", title: "text-amber-800" },
  error: { box: "bg-red-50 border-red-300", icon: XCircle, iconCls: "text-red-600", title: "text-red-800" },
};

export default function SupermarketPanelStock() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);          // última respuesta del escaneo
  const [orders, setOrders] = useState([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(null);  // stock de la corte elegida
  const [session, setSession] = useState([]);      // escaneos de esta sesión (para deshacer)
  const [loadErr, setLoadErr] = useState(null);
  const inputRef = useRef(null);
  const [camOpen, setCamOpen] = useState(false);
  // En pantallas táctiles no se enfoca el campo solo: abriría el teclado
  // encima de todo. Ahí se escanea con la cámara.
  const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const focusScan = () => { if (!touch && !camOpen) setTimeout(() => inputRef.current?.focus(), 0); };

  const loadOrders = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/panel-stock/orders`, { headers: authHeaders() });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) throw new Error(j?.error || `Error ${res.status}`);
      setOrders(j.orders || []); setLoadErr(null);
    } catch (e) { setLoadErr(e.message); }
  }, []);
  useEffect(() => { loadOrders(); focusScan(); }, [loadOrders]);

  // Mantener la lista y el detalle al día con la respuesta de cada escaneo.
  const applyStock = (st) => {
    if (!st) return;
    setSelected(st);
    setOrders((list) => {
      const rest = list.filter((o) => o.cutId !== st.cutId);
      return [st, ...rest];
    });
  };

  const submit = async (raw) => {
    const text = String(raw ?? code).trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/panel-stock/scan`, {
        method: "POST", headers: authHeaders(), body: JSON.stringify({ code: text }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) throw new Error(j?.error || `Error ${res.status}`);
      setLast(j);
      beep(j.result);
      applyStock(j.stock);
      if (j.result === "ok") {
        setSession((s) => [{ id: j.scanId, ...j.panel, at: new Date() }, ...s].slice(0, 30));
      }
    } catch (e) {
      setLast({ result: "error", message: `No se pudo registrar: ${e.message}` });
      beep("error");
    } finally {
      setCode("");
      setBusy(false);
      focusScan();
    }
  };

  const undo = async (scan) => {
    if (!window.confirm(`¿Quitar del stock el panel ${scan.panelNo} de talla ${scan.talla} (${scan.marker}, ${scan.cutNo})?`)) { focusScan(); return; }
    try {
      const res = await fetch(`${API_URL}/api/panel-stock/scans/${scan.id}`, { method: "DELETE", headers: authHeaders() });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) throw new Error(j?.error || `Error ${res.status}`);
      setSession((s) => s.filter((x) => x.id !== scan.id));
      applyStock(j.stock);
      setLast({ result: "duplicate", message: `Se quitó del stock el panel ${scan.panelNo} de talla ${scan.talla}.` });
    } catch (e) {
      setLast({ result: "error", message: e.message });
    } finally {
      focusScan();
    }
  };

  const shown = q.trim()
    ? orders.filter((o) => `${o.cutNo} ${o.workOrderNo} ${o.customerPo} ${o.color} ${o.styleNo}`.toLowerCase().includes(q.trim().toLowerCase()))
    : orders;

  const rs = last ? RESULT_STYLE[last.result] || RESULT_STYLE.error : null;

  return (
    <div className="space-y-4">
      {/* ---------------- Escaneo ---------------- */}
      <div className="rounded-2xl border bg-white shadow-sm p-4">
        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="flex items-center gap-3"
        >
          <ScanLine className="w-6 h-6 text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onPaste={(e) => { const t = e.clipboardData.getData("text"); if (t) { e.preventDefault(); submit(t); } }}
            placeholder="Escanee el QR del ticket del panel…"
            aria-label="Código del ticket"
            autoComplete="off"
            className="flex-1 min-w-0 rounded-xl border-2 border-gray-300 px-4 py-3 text-lg outline-none focus:border-gray-900"
          />
          <button
            type="button"
            onClick={() => setCamOpen(true)}
            className="shrink-0 inline-flex items-center gap-2 rounded-xl border-2 border-gray-900 bg-white px-4 py-3 text-sm font-semibold text-gray-900 hover:bg-gray-50"
          >
            <Camera className="w-5 h-5" /> <span className="hidden sm:inline">Cámara</span>
          </button>
          <button
            type="submit" disabled={busy || !code.trim()}
            className="shrink-0 rounded-xl bg-gray-900 px-5 py-3 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : "Recibir"}
          </button>
        </form>

        {last && rs && (
          <div className={`mt-3 rounded-xl border-2 px-4 py-3 flex items-start gap-3 ${rs.box}`} role="status" aria-live="polite">
            <rs.icon className={`w-8 h-8 shrink-0 ${rs.iconCls}`} />
            <div className="min-w-0 flex-1">
              <p className={`text-lg font-bold ${rs.title}`}>{last.message}</p>
              {last.panel && (
                <p className="mt-0.5 text-sm text-gray-700">
                  <span className="font-mono font-semibold">{last.panel.cutNo}</span> · {last.panel.marker} · Talla{" "}
                  <b>{last.panel.talla}</b>{tallaLabel(last.panel.talla) ? ` ${tallaLabel(last.panel.talla)}` : ""} · Panel{" "}
                  <b>{last.panel.panelNo} de {last.panel.panelCount}</b>
                  {last.panel.pieces ? ` · ${n0(last.panel.pieces)} pzas` : ""}
                  {last.result === "duplicate" && last.previous?.scanned_at
                    ? ` · recibido ${new Date(last.previous.scanned_at).toLocaleString()}${last.previous.scanned_by_name ? ` por ${last.previous.scanned_by_name}` : ""}`
                    : ""}
                </p>
              )}
            </div>
            {last.stock && (
              <div className="text-right shrink-0">
                <div className="text-2xl font-bold tabular-nums text-gray-900 leading-none">
                  {n0(last.stock.totals.receivedPanels)}<span className="text-gray-400 text-lg"> / {n0(last.stock.totals.expectedPanels)}</span>
                </div>
                <div className="text-xs text-gray-500 mt-1">paneles de la orden</div>
              </div>
            )}
          </div>
        )}
      </div>

      {camOpen && (
        <CameraScanner
          onCode={(text) => submit(text)}
          last={last}
          busy={busy}
          onClose={() => { setCamOpen(false); setTimeout(() => !touch && inputRef.current?.focus(), 0); }}
        />
      )}

      {/* ---------------- Stock por orden ---------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-4">
        <section className="rounded-2xl border bg-white shadow-sm overflow-hidden flex flex-col lg:max-h-[70vh]">
          <div className="p-3 border-b">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={q} onChange={(e) => setQ(e.target.value)} onBlur={focusScan}
                placeholder="Buscar corte, orden, PO, color…"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 pl-8 pr-3 py-2 text-sm outline-none focus:border-gray-400 focus:bg-white"
              />
            </div>
          </div>
          {loadErr && <p className="m-3 text-sm text-red-700">{loadErr}</p>}
          <ul className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {shown.length === 0 && <li className="p-6 text-center text-sm text-gray-500">Aún no hay paneles recibidos ni marcadas verificadas.</li>}
            {shown.map((o) => {
              const on = selected?.cutId === o.cutId;
              const pct = o.totals.expectedPanels ? Math.min(100, (o.totals.receivedPanels / o.totals.expectedPanels) * 100) : 0;
              return (
                <li key={o.cutId}>
                  <button
                    onClick={() => { setSelected(o); focusScan(); }}
                    className={`relative w-full text-left px-4 py-3 ${on ? "bg-gray-100" : "hover:bg-gray-50"}`}
                  >
                    {on && <span className="absolute left-0 inset-y-0 w-1 bg-gray-900" />}
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-gray-900">{o.cutNo}</span>
                      {o.color && <span className="rounded bg-gray-100 px-1.5 text-[11px] font-semibold text-gray-700">{o.color}</span>}
                      {o.complete && <PackageCheck className="w-4 h-4 text-emerald-600" />}
                      <span className="ml-auto text-sm font-bold tabular-nums text-gray-900">
                        {o.totals.receivedPanels}<span className="text-gray-400 font-normal">/{o.totals.expectedPanels}</span>
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500 truncate">
                      {[o.workOrderNo, o.customerPo && `PO ${o.customerPo}`].filter(Boolean).join(" · ")}
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full ${o.complete ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${pct}%` }} />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-2xl border bg-white shadow-sm p-5">
          {!selected ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-16 text-sm text-gray-500">
              <ScanLine className="w-8 h-8 text-gray-300 mb-2" />
              Escanee un ticket o elija una orden para ver su stock de paneles.
            </div>
          ) : (
            <OrderStock stock={selected} />
          )}

          {session.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Recibidos en esta sesión</h3>
              <ul className="divide-y divide-gray-100 rounded-xl border">
                {session.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="font-mono font-semibold text-gray-900">{s.cutNo}</span>
                    <span className="text-gray-600">{s.marker} · {s.talla} · panel {s.panelNo}/{s.panelCount}</span>
                    <span className="ml-auto text-xs text-gray-400 tabular-nums">{s.at.toLocaleTimeString()}</span>
                    <button onClick={() => undo(s)} title="Quitar del stock" className="text-gray-400 hover:text-red-600">
                      <Undo2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// Detalle de una corte: recibidos / cortados por marcada × talla.
function OrderStock({ stock: s }) {
  const tallas = sortTallas([...new Set(s.markers.flatMap((m) => m.lines.map((l) => String(l.talla))))]);
  const t = s.totals;
  return (
    <div>
      <header className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-mono text-xl font-bold text-gray-900">{s.cutNo}</h2>
            {s.complete
              ? <span className="text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5">✓ Completa</span>
              : <span className="text-xs font-semibold rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">Faltan {n0(t.expectedPanels - t.receivedPanels)} paneles</span>}
          </div>
          <p className="mt-1 text-sm text-gray-600">
            {[s.workOrderNo, s.customerPo && `PO ${s.customerPo}`, s.customerName, s.color && `Color ${s.color}`].filter(Boolean).join(" · ")}
          </p>
        </div>
        <dl className="flex gap-6">
          <div className="text-right">
            <dd className="text-3xl font-bold tabular-nums leading-none text-gray-900">{n0(t.receivedPanels)}<span className="text-lg text-gray-400"> / {n0(t.expectedPanels)}</span></dd>
            <dt className="text-xs text-gray-500 mt-1">paneles recibidos</dt>
          </div>
          <div className="text-right">
            <dd className="text-3xl font-bold tabular-nums leading-none text-gray-900">{n0(t.receivedPieces)}<span className="text-lg text-gray-400"> / {n0(t.expectedPieces)}</span></dd>
            <dt className="text-xs text-gray-500 mt-1">piezas</dt>
          </div>
        </dl>
      </header>

      <div className="mt-4 rounded-xl border overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-500 border-b">
              <th className="text-left font-medium px-4 py-2.5">Marcada</th>
              {tallas.map((tl) => (
                <th key={tl} className="px-3 py-2.5 text-center font-medium whitespace-nowrap">
                  <span className="text-gray-900 font-semibold">{tl}</span>
                  {tallaLabel(tl) && <span className="block text-[10px] text-blue-700 font-semibold leading-none mt-0.5">{tallaLabel(tl)}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.markers.map((m) => {
              const byT = new Map(m.lines.map((l) => [String(l.talla), l]));
              return (
                <tr key={m.key} className="border-b last:border-0">
                  <th className="text-left font-semibold text-gray-900 px-4 py-3 whitespace-nowrap">{m.name}</th>
                  {tallas.map((tl) => {
                    const l = byT.get(tl);
                    if (!l) return <td key={tl} className="px-3 py-3 text-center text-gray-300">—</td>;
                    const done = l.received >= l.expected;
                    const cls = done ? "bg-emerald-50 text-emerald-800" : l.received > 0 ? "bg-amber-50 text-amber-800" : "text-gray-500";
                    return (
                      <td key={tl} className={`px-3 py-3 text-center tabular-nums ${cls}`}
                        title={l.missing.length ? `Faltan los paneles ${l.missing.join(", ")}` : "Completa"}>
                        <span className="block text-base font-bold leading-none">{l.received}/{l.expected}{done ? " ✓" : ""}</span>
                        {!done && (
                          <span className="block text-[11px] mt-1">
                            falta{l.missing.length > 1 ? "n" : ""} {l.missing.length <= 4 ? `#${l.missing.join(", #")}` : l.missing.length}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">Cada casilla: paneles recibidos / paneles cortados. "#2" es el número de panel que dice el ticket que falta.</p>
    </div>
  );
}