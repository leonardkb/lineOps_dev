// components/warehouse/FinishedWarehouseScan.jsx
// Almacén de Producto Terminado — Escaneo de tickets (intake).
// The line leader prints tickets whose QR carries the batch info. The operator
// scans each ticket; the system records ticket, PO, work order, size, color,
// date, SCAN TIME and pieces, and lets them check it in to inventory.
//
// Scanning: hardware scanner (types into the focused box + Enter, or a JSON QR
// that ends in "}") or the camera (native BarcodeDetector when available).
//
//   POST   /api/finished-warehouse/scan                          { raw } → { ticket, duplicate }
//   GET    /api/finished-warehouse/scanned-tickets?date=&tz=&limit=       → { tickets, totals }
//   DELETE /api/finished-warehouse/scanned-tickets/:id
//   POST   /api/finished-warehouse/scanned-tickets/:id/check-in
//   POST   /api/finished-warehouse/scanned-tickets/check-in-bulk           { ids } → { checkedIn, piecesAdded, tickets }
//   POST   /api/finished-warehouse/scanned-tickets/:id/undo-check-in
//
//   <FinishedWarehouseScan onNavigate={setTab} />
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  ScanLine, Camera, CameraOff, RefreshCw, Loader2, AlertCircle, CheckCircle2,
  Trash2, Package, Boxes, ClipboardList, Clock, X, PackageCheck, RotateCcw, CalendarDays, FilterX, BarChart3,
} from "lucide-react";
import {
  api, num, cx, beep, fmtTime, fmtDate, sizeText, notifyChange, useConfirm,
  PageHeader, Card, CardHeader, Button, Pill, Stat, SegTabs, EmptyState, Loading, Banner, Modal, Th, Td,
  PageFrame,
} from "./finishedShared";

const tSize = (t) => sizeText(t.size_code, t.size_label);
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } })();
const localYmd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const NO_FILTERS = { customer: "", order: "", style: "", sizes: [], hours: [], status: "" };

export default function FinishedWarehouseScan({ onNavigate = null }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null); // { kind: "ok"|"dup"|"err", ticket, msg }
  const [day, setDay] = useState("today");   // "today" | "all" | "YYYY-MM-DD" (scan date)
  const [f, setF] = useState(NO_FILTERS);    // client-side filters over the loaded tickets
  const [view, setView] = useState("tickets"); // "tickets" | "hours"

  const [confirmTicket, setConfirmTicket] = useState(null);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const inputRef = useRef(null);
  const submitLock = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: "1000", tz: TZ });
      if (day !== "all") qs.set("date", day === "today" ? localYmd() : day);
      const d = await api(`/api/finished-warehouse/scanned-tickets?${qs}`);
      setRows(d.tickets || []);
    } catch (e) {
      setError(e.message || "No se pudieron cargar los tickets");
    } finally {
      setLoading(false);
    }
  }, [day]);
  useEffect(() => { load(); }, [load]);

  // Keep the scan box focused: the hardware scanner "types" there.
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
      const d = await api("/api/finished-warehouse/scan", { method: "POST", body: JSON.stringify({ raw: text }) });
      const t = d.ticket;
      if (d.duplicate) {
        beep("dup");
        setFlash({ kind: "dup", ticket: t, msg: "Ticket ya escaneado" });
        if (t) setRows((prev) => prev.map((r) => (r.id === t.id ? { ...r, _flash: Date.now() } : r)));
      } else {
        beep("ok");
        setFlash({ kind: "ok", ticket: t, msg: "Ticket registrado" });
        setRows((prev) => [{ ...t, _flash: Date.now() }, ...prev.filter((r) => r.id !== t.id)]);
        notifyChange();
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

  // Auto-submit when a JSON QR looks complete; also on Enter.
  const onInputChange = (e) => {
    const v = e.target.value;
    setValue(v);
    const t = v.trim();
    if (t.startsWith("{") && t.endsWith("}") && t.length > 8) submitScan(t);
  };
  const onInputKeyDown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); submitScan(value); }
  };

  const removeRow = async (row) => {
    if (!(await confirm({ title: `¿Quitar el ticket ${row.folio || row.ticket_no || row.id}?`, text: "Se borra del registro de escaneos.", confirmLabel: "Quitar", danger: true }))) return focusInput();
    try {
      await api(`/api/finished-warehouse/scanned-tickets/${row.id}`, { method: "DELETE" });
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      notifyChange();
    } catch (e) {
      setError(e.message || "No se pudo quitar el ticket");
    } finally { focusInput(); }
  };

  // Check the ticket's pieces in to inventory.
  const doCheckIn = async () => {
    const t = confirmTicket;
    if (!t || checkinBusy) return;
    setCheckinBusy(true);
    try {
      const d = await api(`/api/finished-warehouse/scanned-tickets/${t.id}/check-in`, { method: "POST" });
      const checkedAt = d.ticket?.checked_in_at || new Date().toISOString();
      const wasAlready = !!d.alreadyCheckedIn;
      setRows((prev) => prev.map((r) => (r.id === t.id ? { ...r, checked_in_at: checkedAt, _flash: Date.now() } : r)));
      setFlash((f) => (f && f.ticket && f.ticket.id === t.id ? { ...f, ticket: { ...f.ticket, checked_in_at: checkedAt } } : f));
      beep("ok");
      setConfirmTicket(null);
      notifyChange();
    } catch (e) {
      setError(e.message || "No se pudo registrar la entrada al inventario");
      setConfirmTicket(null);
    } finally {
      setCheckinBusy(false);
      focusInput();
    }
  };

  // Check in every pending ticket currently shown (respects the active filters).
  const checkInAll = async () => {
    const pending = shown.filter((r) => !r.checked_in_at);
    if (!pending.length || bulkBusy) return;
    const pieces = pending.reduce((t, r) => t + (Number(r.pieces) || 0), 0);
    if (!(await confirm({
      title: `¿Ingresar ${num(pending.length)} ticket(s) al inventario?`,
      text: `Se sumarán ${num(pieces)} pzas al inventario de producto terminado${activeFilters ? " (solo los tickets que coinciden con los filtros)" : ""}.`,
      confirmLabel: "Ingresar todos",
    }))) return focusInput();
    setBulkBusy(true);
    try {
      const d = await api("/api/finished-warehouse/scanned-tickets/check-in-bulk", {
        method: "POST", body: JSON.stringify({ ids: pending.map((r) => r.id) }),
      });
      const byId = new Map((d.tickets || []).map((t) => [t.id, t]));
      const now = Date.now();
      setRows((prev) => prev.map((r) => (byId.has(r.id) ? { ...r, ...byId.get(r.id), _flash: now } : r)));
      beep("ok");
      setFlash({ kind: "ok", ticket: null, msg: `${num(d.checkedIn)} ticket(s) ingresados al inventario · ${num(d.piecesAdded)} pzas` });
      notifyChange();
    } catch (e) {
      setError(e.message || "No se pudieron ingresar los tickets al inventario");
    } finally {
      setBulkBusy(false);
      focusInput();
    }
  };

  // Undo the check-in: back to pending, pieces subtracted from inventory.
  const undoCheckIn = async (row) => {
    if (!(await confirm({
      title: `¿Sacar ${row.folio || row.ticket_no || row.id} del inventario?`,
      text: `Se restarán ${num(row.pieces)} pzas y el ticket volverá a quedar pendiente de entrada.`,
      confirmLabel: "Sacar del inventario", danger: true,
    }))) return focusInput();
    try {
      await api(`/api/finished-warehouse/scanned-tickets/${row.id}/undo-check-in`, { method: "POST" });
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, checked_in_at: null, _flash: Date.now() } : r)));
      setFlash((f) => (f && f.ticket && f.ticket.id === row.id ? { ...f, ticket: { ...f.ticket, checked_in_at: null } } : f));
      notifyChange();
    } catch (e) {
      setError(e.message || "No se pudo deshacer la entrada al inventario");
    } finally { focusInput(); }
  };

  // Interactive filters (client-side over what was loaded for the chosen day).
  const fieldOf = {
    customer: (r) => r.customer_name || r.customer_code || "—",
    order: (r) => r.work_order_no || "—",
    style: (r) => r.style || "—",
    size: (r) => String(r.size_code ?? "").trim() || "—",
    hour: (r) => { const d = new Date(r.scanned_at); return isNaN(d.getTime()) ? -1 : d.getHours(); },
    status: (r) => (r.checked_in_at ? "in" : "pending"),
  };
  const matches = (r, skip) => (
    (skip === "customer" || !f.customer || fieldOf.customer(r) === f.customer) &&
    (skip === "order" || !f.order || fieldOf.order(r) === f.order) &&
    (skip === "style" || !f.style || fieldOf.style(r) === f.style) &&
    (skip === "size" || !f.sizes.length || f.sizes.includes(fieldOf.size(r))) &&
    (skip === "hour" || !f.hours.length || f.hours.includes(fieldOf.hour(r))) &&
    (skip === "status" || !f.status || fieldOf.status(r) === f.status)
  );
  const shown = useMemo(() => rows.filter((r) => matches(r, null)), [rows, f]); // eslint-disable-line react-hooks/exhaustive-deps
  // Options for each filter, counted with the OTHER filters applied (faceted).
  const facet = (key) => {
    const m = new Map();
    for (const r of rows) {
      if (!matches(r, key)) continue;
      const k = fieldOf[key](r);
      const c = m.get(k) || { key: k, tickets: 0, pieces: 0 };
      c.tickets += 1; c.pieces += Number(r.pieces) || 0;
      m.set(k, c);
    }
    return m;
  };
  const facets = useMemo(() => ({
    customer: [...facet("customer").values()].sort((a, b) => b.pieces - a.pieces),
    order: [...facet("order").values()].sort((a, b) => b.pieces - a.pieces),
    style: [...facet("style").values()].sort((a, b) => b.pieces - a.pieces),
    size: [...facet("size").values()].sort((a, b) => String(a.key).localeCompare(String(b.key), "es", { numeric: true })),
    hour: facet("hour"),
    status: facet("status"),
  }), [rows, f]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeFilters = (f.customer ? 1 : 0) + (f.order ? 1 : 0) + (f.style ? 1 : 0) + (f.sizes.length ? 1 : 0) + (f.hours.length ? 1 : 0) + (f.status ? 1 : 0);

  const totals = useMemo(() => shown.reduce((t, r) => {
    const p = Number(r.pieces) || 0;
    t.tickets += 1; t.pieces += p;
    if (!r.checked_in_at) { t.pending += 1; t.pendingPieces += p; }
    t.orders.add(r.work_order_no || "—");
    return t;
  }, { tickets: 0, pieces: 0, pending: 0, pendingPieces: 0, orders: new Set() }), [shown]);
  const dayLabel = day === "today" ? "hoy" : day === "all" ? "" : `del ${day}`;

  const isFresh = (r) => r._flash && Date.now() - r._flash < 2500;
  const pendingShown = totals.pending;

  return (
    <PageFrame onClick={focusInput}>
      <PageHeader
        title="Escaneo de tickets"
        subtitle="Escanee cada ticket de producción e ingréselo al inventario."
        actions={<>
          {onNavigate && <Button variant="secondary" icon={Boxes} onClick={() => onNavigate("inventario")} className="hidden sm:inline-flex">Inventario</Button>}
          <Button variant="secondary" icon={RefreshCw} loading={loading} onClick={load}>Actualizar</Button>
        </>}
      />

      {/* Scanner */}
      <Card className="p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <span className={cx("absolute left-3.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full", busy ? "bg-amber-400 animate-pulse" : "bg-emerald-500")} />
            <input
              ref={inputRef}
              value={value}
              onChange={onInputChange}
              onKeyDown={onInputKeyDown}
              autoFocus
              inputMode="text"
              placeholder="Escanee un ticket o pegue el código y presione Enter…"
              className="w-full pl-9 pr-9 py-3 rounded-xl bg-white ring-2 ring-inset ring-indigo-500/70 text-sm font-mono placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-indigo-600"
            />
            {busy && <Loader2 className="w-4 h-4 text-indigo-500 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />}
          </div>
          <Button size="lg" className="py-2.5" disabled={busy || !value.trim()} onClick={() => submitScan(value)}>Registrar</Button>
          <CameraScanner onScan={submitScan} />
        </div>

        {flash && (
          <div className={cx("rounded-xl px-4 py-3 ring-1 ring-inset flex items-start gap-3",
            flash.kind === "ok" ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
              : flash.kind === "dup" ? "bg-amber-50 text-amber-800 ring-amber-200"
                : "bg-red-50 text-red-700 ring-red-200")}>
            {flash.kind === "ok" ? <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0" /> : <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />}
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold">{flash.msg}</div>
              {flash.ticket && (
                <div className="text-xs mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono">
                  <span className="font-semibold">{flash.ticket.folio || flash.ticket.ticket_no || "—"}</span>
                  {flash.ticket.customer_name && <span>{flash.ticket.customer_name}</span>}
                  <span>OT {flash.ticket.work_order_no || "—"}</span>
                  {flash.ticket.style && <span>Estilo {flash.ticket.style}</span>}
                  <span>PO {flash.ticket.customer_po || "—"}</span>
                  <span>{tSize(flash.ticket)}</span>
                  <span>{flash.ticket.color || "—"}</span>
                  <span className="font-semibold">{num(flash.ticket.pieces)} pzas</span>
                </div>
              )}
              {flash.ticket && flash.kind !== "err" && (
                flash.ticket.checked_in_at
                  ? <div className="mt-2"><Pill tone="emerald" icon={PackageCheck}>Ya está en inventario</Pill></div>
                  : <Button variant="success" size="sm" icon={PackageCheck} className="mt-2" onClick={() => setConfirmTicket(flash.ticket)}>Ingresar a inventario</Button>
              )}
            </div>
            <button onClick={() => setFlash(null)} className="opacity-60 hover:opacity-100" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
        )}
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={ClipboardList} label={`Tickets ${dayLabel}`.trim()} value={totals.tickets} hint={activeFilters ? `de ${num(rows.length)} · con filtros` : null} tone="indigo" />
        <Stat icon={Package} label="Piezas escaneadas" value={totals.pieces} tone="emerald" />
        <Stat icon={PackageCheck} label="Pendientes de entrada" value={totals.pending} hint={`${num(totals.pendingPieces)} pzas`} tone="amber" />
        <Stat icon={Boxes} label="Órdenes distintas" value={totals.orders.size} />
      </div>

      {/* Tickets */}
      <Card className="overflow-hidden">
        <CardHeader
          icon={ScanLine}
          title="Tickets escaneados"
          subtitle={activeFilters ? `${num(shown.length)} de ${num(rows.length)} registro(s)` : `${num(rows.length)} registro(s)${dayLabel ? ` ${dayLabel}` : ""}`}
          actions={<>
            {activeFilters > 0 && <Button size="sm" variant="ghost" icon={FilterX} onClick={() => setF(NO_FILTERS)}>Quitar filtros ({activeFilters})</Button>}
            <Button size="sm" variant="success" icon={PackageCheck} loading={bulkBusy} disabled={!pendingShown || loading}
              onClick={(e) => { e.stopPropagation(); checkInAll(); }}
              title={activeFilters ? "Ingresar al inventario los tickets pendientes que coinciden con los filtros" : "Ingresar al inventario todos los tickets pendientes"}>
              Check-in a todos{pendingShown ? ` (${num(pendingShown)})` : ""}
            </Button>
          </>}
        />
        <div className="px-5 pt-3 pb-3 border-b border-slate-100" onClick={(e) => e.stopPropagation()}>
          <SegTabs
            value={view}
            onChange={setView}
            tabs={[
              { key: "tickets", label: "Tickets", icon: ClipboardList, count: shown.length },
              { key: "hours", label: "Hora de escaneo", icon: BarChart3, count: f.hours.length || undefined },
            ]}
          />
        </div>
        <FilterBar day={day} setDay={setDay} f={f} setF={setF} facets={facets} showHours={view === "tickets"} />

        {error ? (
          <div className="p-5"><Banner kind="err" onClose={() => setError(null)}>{error}</Banner></div>
        ) : loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState icon={ScanLine} title="Sin tickets" text={`Aún no se ha escaneado ningún ticket${dayLabel ? ` ${dayLabel}` : ""}. Escanee uno para empezar.`} />
        ) : view === "hours" ? (
          <HourView f={f} setF={setF} facets={facets} onShowTickets={() => setView("tickets")} />
        ) : shown.length === 0 ? (
          <EmptyState icon={FilterX} title="Ningún ticket coincide" text="Cambie o quite los filtros." action={<Button variant="secondary" size="sm" onClick={() => setF(NO_FILTERS)}>Quitar filtros</Button>} />
        ) : (
          <>
            {/* Phone / PDA: cards */}
            <ul className="lg:hidden divide-y divide-slate-100">
              {shown.map((r) => (
                <li key={r.id} className={cx("px-4 py-3 transition-colors", isFresh(r) && "bg-emerald-50")}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono font-semibold text-slate-900">{r.folio || r.ticket_no || "—"}</div>
                      <div className="text-xs text-slate-500 truncate">OT {r.work_order_no || "—"}{r.style ? ` · ${r.style}` : ""} · {tSize(r)} · {r.color || "—"}</div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5"><Clock className="w-3 h-3" />{fmtTime(r.scanned_at)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-slate-900 tabular-nums">{num(r.pieces)} pzas</div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <TicketStatus r={r} onCheckIn={() => setConfirmTicket(r)} onUndo={() => undoCheckIn(r)} />
                    {!r.checked_in_at && (
                      <button onClick={() => removeRow(r)} className="ml-auto p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50" aria-label="Quitar ticket">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: table */}
            <div className="hidden lg:block overflow-x-auto max-h-[60vh]">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr>
                    <Th>Ticket</Th><Th>Cliente</Th><Th>Orden</Th><Th>Estilo</Th><Th>PO</Th><Th>Talla</Th><Th>Color</Th>
                    <Th>Fecha</Th><Th>Hora escaneo</Th><Th right>Piezas</Th><Th>Estado</Th><Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map((r) => (
                    <tr key={r.id} className={cx("transition-colors", isFresh(r) ? "bg-emerald-50" : "hover:bg-slate-50")}>
                      <Td mono strong title={r.ticket_no ? `Ticket impreso: ${r.ticket_no}` : undefined}>{r.folio || r.ticket_no || "—"}</Td>
                      <Td>{r.customer_name || r.customer_code || "—"}</Td>
                      <Td mono>{r.work_order_no || "—"}</Td>
                      <Td>{r.style || "—"}</Td>
                      <Td mono>{r.customer_po || "—"}</Td>
                      <Td>{tSize(r)}</Td>
                      <Td>{r.color || "—"}</Td>
                      <Td className="text-slate-500">{fmtDate(r.production_date)}</Td>
                      <Td className="text-slate-500"><span className="inline-flex items-center gap-1"><Clock className="w-3 h-3 text-slate-400" />{fmtTime(r.scanned_at)}</span></Td>
                      <Td right strong>{num(r.pieces)}</Td>
                      <Td><TicketStatus r={r} onCheckIn={() => setConfirmTicket(r)} onUndo={() => undoCheckIn(r)} /></Td>
                      <Td right>
                        <button
                          onClick={() => removeRow(r)}
                          disabled={!!r.checked_in_at}
                          className="p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-300"
                          title={r.checked_in_at ? "Ya ingresado; no se puede quitar" : "Quitar ticket"}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 sticky bottom-0">
                  <tr className="border-t border-slate-200">
                    <Td colSpan={9} className="font-medium text-slate-500">Total</Td>
                    <Td right strong>{num(totals.pieces)}</Td>
                    <Td /><Td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </Card>

      <Modal
        open={!!confirmTicket}
        onClose={() => !checkinBusy && setConfirmTicket(null)}
        title="Ingresar a inventario"
        icon={PackageCheck}
        tone="emerald"
        size="sm"
        footer={<>
          <Button variant="secondary" disabled={checkinBusy} onClick={() => setConfirmTicket(null)}>Cancelar</Button>
          <Button variant="success" icon={CheckCircle2} loading={checkinBusy} onClick={doCheckIn}>Ingresar</Button>
        </>}
      >
        {confirmTicket && (
          <>
            <p className="text-sm text-slate-600">Se sumarán <b className="text-slate-900">{num(confirmTicket.pieces)}</b> pzas al inventario de producto terminado.</p>
            <div className="mt-3 rounded-xl ring-1 ring-inset ring-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-700 flex flex-wrap gap-x-3 gap-y-0.5">
              <span className="font-semibold text-slate-900">{confirmTicket.folio || confirmTicket.ticket_no || "—"}</span>
              {confirmTicket.customer_name && <span>{confirmTicket.customer_name}</span>}
              <span>OT {confirmTicket.work_order_no || "—"}</span>
              {confirmTicket.style && <span>Estilo {confirmTicket.style}</span>}
              <span>PO {confirmTicket.customer_po || "—"}</span>
              <span>{tSize(confirmTicket)}</span>
              <span>{confirmTicket.color || "—"}</span>
            </div>
          </>
        )}
      </Modal>
    </PageFrame>
  );
}

// Filters: scan day, client, order, style, status, size chips and an hour histogram.
function FilterBar({ day, setDay, f, setF, facets, showHours }) {
  const set = (patch) => setF((p) => ({ ...p, ...patch }));
  const toggle = (key, v) => setF((p) => ({ ...p, [key]: p[key].includes(v) ? p[key].filter((x) => x !== v) : [...p[key], v] }));
  const isDate = day !== "today" && day !== "all";
  const pend = facets.status.get("pending")?.tickets || 0;
  const inv = facets.status.get("in")?.tickets || 0;

  return (
    <div className="px-5 py-4 border-b border-slate-100 space-y-4 bg-slate-50/40" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Fecha de escaneo">
          <div className="flex items-center gap-2">
            <SegTabs
              value={isDate ? "" : day}
              onChange={setDay}
              tabs={[{ key: "today", label: "Hoy", icon: CalendarDays }, { key: "all", label: "Todos" }]}
            />
            <input
              type="date"
              value={isDate ? day : ""}
              max={localYmd()}
              onChange={(e) => setDay(e.target.value || "today")}
              className={cx("h-9 rounded-lg px-2.5 text-sm ring-1 ring-inset focus:outline-none focus:ring-2 focus:ring-indigo-500",
                isDate ? "ring-indigo-400 bg-indigo-50 text-indigo-800" : "ring-slate-300 bg-white text-slate-700")}
            />
          </div>
        </Field>
        <Select label="Cliente" value={f.customer} onChange={(v) => set({ customer: v })} options={facets.customer} />
        <Select label="Orden" value={f.order} onChange={(v) => set({ order: v })} options={facets.order} mono />
        <Select label="Estilo" value={f.style} onChange={(v) => set({ style: v })} options={facets.style} />
        <Field label="Estado">
          <SegTabs
            value={f.status || "all"}
            onChange={(k) => set({ status: k === "all" ? "" : k })}
            tabs={[
              { key: "all", label: "Todos" },
              { key: "pending", label: "Pendientes", count: pend },
              { key: "in", label: "En inventario", count: inv },
            ]}
          />
        </Field>
      </div>

      <Field label="Talla">
        <div className="flex flex-wrap gap-1.5">
          {facets.size.length === 0 && <span className="text-xs text-slate-400">—</span>}
          {facets.size.map((o) => {
            const on = f.sizes.includes(o.key);
            return (
              <button key={o.key} type="button" onClick={() => toggle("sizes", o.key)}
                className={cx("rounded-lg px-2.5 py-1 text-xs ring-1 ring-inset transition",
                  on ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-300 hover:ring-indigo-300")}>
                <span className="font-medium">{sizeText(o.key)}</span>
                <span className={cx("ml-1.5 tabular-nums", on ? "text-indigo-100" : "text-slate-400")}>{num(o.pieces)}</span>
              </button>
            );
          })}
          {/* Selected sizes that no longer match the other filters stay visible so they can be cleared. */}
          {f.sizes.filter((k) => !facets.size.some((o) => o.key === k)).map((k) => (
            <button key={k} type="button" onClick={() => toggle("sizes", k)} className="rounded-lg px-2.5 py-1 text-xs bg-indigo-600 text-white">{sizeText(k)} · 0</button>
          ))}
        </div>
      </Field>

      {/* The hour histogram lives in its own tab; here we only show what's selected so it can be cleared. */}
      {showHours && f.hours.length > 0 && (
        <Field label="Hora de escaneo">
          <div className="flex flex-wrap gap-1.5">
            {[...f.hours].sort((a, b) => a - b).map((h) => (
              <button key={h} type="button" onClick={() => toggle("hours", h)}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs bg-indigo-600 text-white hover:bg-indigo-700"
                title="Quitar esta hora del filtro">
                {hourLabel(h)}<X className="w-3 h-3" />
              </button>
            ))}
          </div>
        </Field>
      )}
    </div>
  );
}

const hourLabel = (h) => `${String(h).padStart(2, "0")}:00`;

// "Hora de escaneo" tab: pieces per scan hour. Click a bar (or a row) to filter the tickets.
// Counts come from facets.hour, which ignores the hour filter itself, so every hour stays visible.
function HourView({ f, setF, facets, onShowTickets }) {
  const toggle = (h) => setF((p) => ({ ...p, hours: p.hours.includes(h) ? p.hours.filter((x) => x !== h) : [...p.hours, h] }));
  const hours = facets.hour;
  const present = [...hours.keys()].filter((h) => h >= 0);
  const from = present.length ? Math.min(6, ...present) : 6;
  const to = present.length ? Math.max(19, ...present) : 19;
  const range = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const max = Math.max(1, ...[...hours.values()].map((h) => h.pieces));
  const total = present.reduce((t, h) => t + hours.get(h).pieces, 0);
  const sel = f.hours.length;
  const selPieces = f.hours.reduce((t, h) => t + (hours.get(h)?.pieces || 0), 0);
  const listed = range.filter((h) => hours.get(h) || f.hours.includes(h));
  let running = 0;

  return (
    <div className="p-5 space-y-5" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-slate-600 flex-1 min-w-[200px]">
          {sel
            ? <><b className="text-slate-900">{sel}</b> hora(s) seleccionada(s) · <b className="text-slate-900">{num(selPieces)}</b> pzas</>
            : "Haga clic en una barra para filtrar los tickets por hora."}
        </p>
        {sel > 0 && <>
          <Button size="sm" variant="ghost" icon={FilterX} onClick={() => setF((p) => ({ ...p, hours: [] }))}>Quitar horas</Button>
          <Button size="sm" variant="secondary" icon={ClipboardList} onClick={onShowTickets}>Ver tickets</Button>
        </>}
      </div>

      {/* Histogram */}
      <div>
        <div className="flex items-end gap-1 h-48">
          {range.map((h) => {
            const v = hours.get(h);
            const on = f.hours.includes(h);
            const pct = v ? Math.max(4, Math.round((v.pieces / max) * 100)) : 0;
            return (
              <button key={h} type="button" disabled={!v && !on} onClick={() => toggle(h)}
                title={`${hourLabel(h)}–${String(h).padStart(2, "0")}:59 · ${num(v?.pieces)} pzas · ${num(v?.tickets)} ticket(s)`}
                aria-pressed={on}
                className="group flex-1 h-full flex flex-col justify-end items-center disabled:cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded">
                {v && <span className={cx("mb-0.5 text-[10px] tabular-nums hidden sm:block", on ? "text-indigo-700 font-semibold" : "text-slate-400")}>{num(v.pieces)}</span>}
                <div className={cx("w-full rounded-t transition",
                  on ? "bg-indigo-600" : v ? (sel ? "bg-slate-300 group-hover:bg-indigo-300" : "bg-emerald-500 group-hover:bg-emerald-600") : "bg-slate-100")}
                  style={{ height: v ? `${pct}%` : "3px" }} />
              </button>
            );
          })}
        </div>
        <div className="mt-1 flex gap-1 text-[10px] text-slate-400 tabular-nums">
          {range.map((h) => <div key={h} className={cx("flex-1 text-center", f.hours.includes(h) && "text-indigo-700 font-semibold")}>{h}</div>)}
        </div>
      </div>

      {/* Per-hour breakdown */}
      {listed.length === 0 ? (
        <p className="text-sm text-slate-400">No hay escaneos que coincidan con los filtros.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl ring-1 ring-inset ring-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr><Th>Hora</Th><Th right>Tickets</Th><Th right>Piezas</Th><Th right>% del total</Th><Th right>Acumulado</Th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {listed.map((h) => {
                const v = hours.get(h) || { tickets: 0, pieces: 0 };
                const on = f.hours.includes(h);
                running += v.pieces;
                return (
                  <tr key={h} onClick={() => toggle(h)} className={cx("cursor-pointer", on ? "bg-indigo-50" : "hover:bg-slate-50")}>
                    <Td mono strong={on}>{hourLabel(h)}–{String(h).padStart(2, "0")}:59</Td>
                    <Td right>{num(v.tickets)}</Td>
                    <Td right strong>{num(v.pieces)}</Td>
                    <Td right className="text-slate-500">{total ? `${Math.round((v.pieces / total) * 100)}%` : "—"}</Td>
                    <Td right className="text-slate-500">{num(running)}</Td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-50">
              <tr className="border-t border-slate-200">
                <Td className="font-medium text-slate-500">Total</Td>
                <Td right strong>{num(present.reduce((t, h) => t + hours.get(h).tickets, 0))}</Td>
                <Td right strong>{num(total)}</Td>
                <Td /><Td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      {children}
    </div>
  );
}

function Select({ label, value, onChange, options, mono }) {
  const known = !value || options.some((o) => o.key === value);
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx("h-9 max-w-[16rem] rounded-lg pl-2.5 pr-8 text-sm ring-1 ring-inset border-0 focus:outline-none focus:ring-2 focus:ring-indigo-500",
          value ? "ring-indigo-400 bg-indigo-50 text-indigo-800 font-medium" : "ring-slate-300 bg-white text-slate-700", mono && "font-mono")}
      >
        <option value="">Todos ({options.length})</option>
        {!known && <option value={value}>{value} (0)</option>}
        {options.map((o) => <option key={o.key} value={o.key}>{o.key} · {num(o.pieces)} pzas</option>)}
      </select>
    </Field>
  );
}

function TicketStatus({ r, onCheckIn, onUndo }) {
  if (r.checked_in_at) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Pill tone="emerald" icon={PackageCheck}>En inventario</Pill>
        <button onClick={onUndo} className="p-1 rounded-md text-slate-300 hover:text-amber-600 hover:bg-amber-50" title="Deshacer entrada (regresar a pendiente)">
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </span>
    );
  }
  return <Button variant="success" size="sm" icon={PackageCheck} onClick={onCheckIn} title="Ingresar las piezas de este ticket al inventario">Check-in</Button>;
}

// Camera scanner (native BarcodeDetector). Hidden when the browser lacks it.
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
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    setOn(false);
  }, []);
  useEffect(() => () => stop(), [stop]);

  const start = useCallback(async () => {
    setErr(null);
    try {
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
      streamRef.current = stream;
      setOn(true);
      const video = videoRef.current;
      if (!video) { stop(); return; }
      video.srcObject = stream;
      await video.play();
      const tick = async () => {
        if (!streamRef.current) return;
        try {
          const codes = await detector.detect(video);
          if (codes && codes.length) {
            const text = String(codes[0].rawValue || "").trim();
            const now = Date.now();
            if (text && (text !== lastRef.current.text || now - lastRef.current.at > 2500)) {
              lastRef.current = { text, at: now };
              onScan(text);
            }
          }
        } catch { /* frame without a code */ }
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
      <Button variant="secondary" size="lg" className={cx("py-2.5", on && "text-red-600 ring-red-200")} icon={on ? CameraOff : Camera} onClick={() => (on ? stop() : start())}>
        {on ? "Cerrar cámara" : "Cámara"}
      </Button>
      {/* The video stays mounted so start() can attach the stream right away. */}
      <div className={cx("w-full mt-2", !on && "hidden")}>
        <div>
          <div className="relative w-full max-w-sm mx-auto rounded-2xl overflow-hidden bg-black">
            <video ref={videoRef} playsInline muted className="w-full h-auto block" />
            <div className="pointer-events-none absolute inset-6 border-2 border-white/70 rounded-xl" />
          </div>
          <p className="text-xs text-slate-400 text-center mt-1">Apunte la cámara al código QR del ticket.</p>
        </div>
      </div>
      {err && <p className="text-xs text-red-500 w-full">{err}</p>}
    </>
  );
}