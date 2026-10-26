// components/FabricWH/FabricReconciliation.jsx
// Almacén de Tela — Conciliación: rollos solicitados a Skytex vs. rollos
// recibidos (escaneados en Recepción).
//
//   • Por PO          requested / received / pending / overdue per PO
//   • Pendientes      requested but not scanned in yet (overdue = arrival date passed)
//   • Sin solicitud   scanned in Recepción but NOT in any Skytex request.
//                     They stay here (and on the dashboard) until they are
//                     requested from Skytex — then they link by themselves —
//                     or someone marks them as reviewed with a note.
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  AlertTriangle, CheckCircle2, Download, ChevronRight, X, ClipboardCheck, Undo2, DownloadCloud, PackageCheck, Clock,
} from "lucide-react";
import {
  api, post, num, cx, Card, CardHeader, Button, SegTabs, RollTable, EmptyState, StatusBadge, Modal, Field, Banner,
  inputCls, locationText, fmtDateTime, downloadCsv, todayStr, useToast, notifyChange,
} from "./fabricShared";

const RANGES = [[30, "30 días"], [60, "60 días"], [90, "90 días"], [180, "6 meses"], [365, "1 año"]];

// arrival_date = fecha de entrega (Skytex transfer date); + FABRIC_TRANSIT_DAYS if ever set
let TRANSIT = 0;
const daysLate = (ymd) => {
  if (!ymd) return null;
  const d = Math.floor((new Date(`${todayStr()}T00:00:00`) - new Date(`${ymd}T00:00:00`)) / 86400000) - TRANSIT;
  return d > 0 ? d : null;
};

export default function FabricReconciliation({ tab = "po", onTab = () => {}, version = 0, onChanged = () => {} }) {
  const toast = useToast();
  const [days, setDays] = useState(60);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [po, setPo] = useState(null);             // PO filter for «Pendientes»
  const [showReviewed, setShowReviewed] = useState(false);
  const [review, setReview] = useState(null);     // roll being reviewed
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await api(`/reconciliation?days=${days}`);
      TRANSIT = Number(d.transitDays) || 0;
      setData(d);
    }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [days]);
  useEffect(() => { load(); }, [load, version]);

  const t = data?.totals || {};
  const pct = t.requested ? Math.round((t.received / t.requested) * 100) : 0;
  const pending = useMemo(() => (data?.pending || []).filter((r) => !po || (r.po_number || "Sin PO") === po), [data, po]);
  const unreq = useMemo(() => (data?.unrequested || []).filter((r) => showReviewed || !r.unrequested_reviewed_at), [data, showReviewed]);

  const saveReview = async (undo = false, roll = review) => {
    if (!undo && !note.trim()) return toast({ kind: "warn", text: "Escriba qué se revisó." });
    setSaving(true);
    try {
      await post(`/rolls/${roll.id}/review-unrequested`, undo ? { undo: true } : { note: note.trim() });
      toast({ kind: "ok", text: undo ? `${roll.roll_no} vuelve a la lista de pendientes de revisar.` : `${roll.roll_no} marcado como revisado.` });
      setReview(null); setNote("");
      notifyChange(); onChanged();
      await load();
    } catch (e) { toast({ kind: "err", text: e.message }); }
    finally { setSaving(false); }
  };

  const exportCsv = () => {
    const stamp = todayStr();
    if (tab === "po") {
      return downloadCsv(`conciliacion-por-po-${stamp}.csv`, [
        { label: "PO", key: "po_number" },
        { label: "Solicitados", key: "requested" },
        { label: "Recibidos", key: "received" },
        { label: "Pendientes", key: "pending" },
        { label: "Vencidos", key: "overdue" },
        { label: "Yardas solicitadas", get: (r) => num(r.yards_requested, 1) },
        { label: "Yardas recibidas", get: (r) => num(r.yards_received, 1) },
        { label: "Próxima entrega", key: "next_arrival" },
        { label: "Última recepción", get: (r) => fmtDateTime(r.last_received_at) },
      ], data?.byPo || []);
    }
    if (tab === "pending") {
      return downloadCsv(`rollos-pendientes-${stamp}.csv`, [
        { label: "Rollo de tela", key: "roll_no" },
        { label: "Purchase order number", key: "po_number" },
        { label: "Fabric name", key: "fabric_name" },
        { label: "Color", key: "color" },
        { label: "Lote", key: "lot" },
        { label: "Yardas", key: "yards" },
        { label: "Fecha de entrega", key: "arrival_date" },
        { label: "Días de retraso", get: (r) => daysLate(r.arrival_date) || "" },
        { label: "Contenedor reservado", get: (r) => (r.box_code ? locationText(r) : "") },
        { label: "Estado", key: "status" },
      ], pending);
    }
    return downloadCsv(`rollos-sin-solicitud-${stamp}.csv`, [
      { label: "Rollo de tela", key: "roll_no" },
      { label: "Supplier Code", key: "supplier_code" },
      { label: "Recibido", get: (r) => fmtDateTime(r.received_at) },
      { label: "Recibido por", key: "received_by_name" },
      { label: "Contenedor", get: (r) => locationText(r) },
      { label: "Estado", key: "status" },
      { label: "Revisado", get: (r) => fmtDateTime(r.unrequested_reviewed_at) },
      { label: "Revisado por", key: "reviewed_by_name" },
      { label: "Nota", key: "unrequested_note" },
    ], unreq);
  };

  const pendingCols = [
    { key: "roll_no", label: "Rollo", mono: true },
    { key: "po_number", label: "PO" },
    { key: "fabric_name", label: "Tela", render: (r) => <span>{r.fabric_name || "—"} <span className="text-slate-400">· {r.color || "—"}</span></span> },
    { key: "yards", label: "Yardas", align: "right", render: (r) => num(r.yards, 1) },
    {
      key: "arrival_date", label: "Fecha de entrega",
      render: (r) => {
        const late = daysLate(r.arrival_date);
        return r.arrival_date
          ? <span className={cx(late && "text-red-600 font-medium")}>{r.arrival_date}{late ? ` · ${late} d de retraso` : ""}</span>
          : <span className="text-slate-400">Sin fecha</span>;
      },
    },
    { key: "box_code", label: "Contenedor", render: (r) => (r.box_code ? locationText(r) : <span className="text-amber-700">En Skytex, sin contenedor</span>) },
  ];
  const unreqCols = [
    { key: "roll_no", label: "Rollo", mono: true },
    { key: "received_at", label: "Recibido", render: (r) => <span>{fmtDateTime(r.received_at)}{r.received_by_name && <span className="text-slate-400"> · {r.received_by_name}</span>}</span> },
    { key: "box_code", label: "Contenedor", render: (r) => locationText(r) },
    { key: "status", label: "Estado", sortable: false, render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "unrequested_reviewed_at", label: "Revisión", sortable: false,
      render: (r) => r.unrequested_reviewed_at ? (
        <span className="inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <span className="text-emerald-700 text-xs truncate" style={{ maxWidth: 220 }} title={`${r.unrequested_note || ""}\n${r.reviewed_by_name || ""} · ${fmtDateTime(r.unrequested_reviewed_at)}`}>
            <CheckCircle2 className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />{r.unrequested_note}
          </span>
          <button onClick={() => saveReview(true, r)} className="text-xs text-slate-500 hover:text-slate-800 underline">deshacer</button>
        </span>
      ) : (
        <span onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="secondary" icon={ClipboardCheck} onClick={() => { setReview(r); setNote(""); }}>Marcar revisado</Button>
        </span>
      ),
    },
  ];

  const Tile = ({ k, label, value, sub, tone, onClick, children }) => (
    <button
      onClick={onClick}
      className={cx("text-left rounded-xl p-3.5 ring-1 transition hover:shadow-sm",
        tone === "red" ? "bg-red-50 ring-red-200 hover:ring-red-300" : tab === k ? "bg-white ring-indigo-300" : "bg-white ring-slate-200 hover:ring-slate-300")}
    >
      <div className={cx("text-xs", tone === "red" ? "text-red-700" : "text-slate-500")}>{label}</div>
      <div className={cx("text-2xl font-semibold fab-tnum", tone === "red" ? "text-red-700" : "text-slate-900")}>{loading && !data ? "·" : value}</div>
      {sub && <div className={cx("text-xs fab-tnum", tone === "red" ? "text-red-600" : "text-slate-500")}>{sub}</div>}
      {children}
    </button>
  );

  return (
    <Card>
      <CardHeader
        title="Conciliación Skytex ↔ recibidos"
        subtitle={`Rollos solicitados a Skytex (pendientes y los de los últimos ${RANGES.find(([d]) => d === days)?.[1] || `${days} días`}) contra los escaneados en Recepción`}
        actions={
          <>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={cx(inputCls, "py-1.5 text-sm")} aria-label="Periodo">
              {RANGES.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
            </select>
            <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv} disabled={!data}>Exportar</Button>
          </>
        }
      />
      {error && <div className="px-5 pt-4"><Banner kind="err">{error}</Banner></div>}

      <div className="p-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile k="po" label="Solicitados a Skytex" value={num(t.requested ?? 0)} sub={`${num(t.yardsRequested ?? 0, 0)} yd`} onClick={() => onTab("po")} />
        <Tile k="po" label="Recibidos" value={num(t.received ?? 0)} sub={`${pct}% · ${num(t.yardsReceived ?? 0, 0)} yd`} onClick={() => onTab("po")}>
          <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
        </Tile>
        <Tile k="pending" label="Pendientes de llegar" value={num(t.pending ?? 0)}
          sub={t.overdue ? <span className="text-red-600 font-medium">{t.overdue} con fecha vencida</span> : "Ninguno vencido"}
          onClick={() => { setPo(null); onTab("pending"); }} />
        <Tile k="unrequested" label="Recibidos sin solicitud" value={num(t.unrequested ?? 0)}
          sub={t.unrequested ? "Revisar con Skytex" : t.unrequestedReviewed ? `${t.unrequestedReviewed} ya revisados` : "Todo coincide"}
          tone={t.unrequested ? "red" : undefined} onClick={() => onTab("unrequested")} />
      </div>

      <div className="px-5 pb-3 flex flex-wrap items-center gap-3">
        <SegTabs
          value={tab}
          onChange={onTab}
          tabs={[
            { key: "po", label: "Por PO", icon: DownloadCloud, count: data?.byPo?.length },
            { key: "pending", label: "Pendientes", icon: Clock, count: t.pending },
            { key: "unrequested", label: "Sin solicitud", icon: AlertTriangle, count: t.unrequested },
          ]}
        />
        {tab === "pending" && po && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 text-indigo-700 px-2.5 py-1 text-xs font-medium">
            PO {po}
            <button onClick={() => setPo(null)} aria-label="Quitar filtro de PO"><X className="w-3.5 h-3.5" /></button>
          </span>
        )}
        {tab === "unrequested" && t.unrequestedReviewed > 0 && (
          <label className="inline-flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" className="rounded border-slate-300 text-indigo-600" checked={showReviewed} onChange={(e) => setShowReviewed(e.target.checked)} />
            Mostrar revisados ({t.unrequestedReviewed})
          </label>
        )}
      </div>

      <div className="border-t border-slate-100">
        {tab === "po" && (
          !data?.byPo?.length ? (
            <EmptyState icon={DownloadCloud} title="Sin solicitudes en este periodo" text="Cuando solicite rollos a Skytex aparecerán aquí por PO." />
          ) : (
            <ul className="divide-y divide-slate-100 overflow-y-auto" style={{ maxHeight: "50vh" }}>
              {data.byPo.map((r) => {
                const p = r.requested ? (r.received / r.requested) * 100 : 0;
                const done = r.pending === 0;
                return (
                  <li key={r.po_number}>
                    <button
                      onClick={() => { if (!done) { setPo(r.po_number); onTab("pending"); } }}
                      className={cx("w-full px-5 py-3 flex items-center gap-4 text-left", !done && "hover:bg-slate-50")}
                    >
                      <span className={cx("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                        done ? "bg-emerald-100 text-emerald-700" : r.overdue ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700")}>
                        {done ? <PackageCheck className="w-4 h-4" /> : r.overdue ? <AlertTriangle className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="font-semibold text-slate-900 truncate">PO {r.po_number}</span>
                          <span className="text-sm text-slate-600 fab-tnum flex-shrink-0">{r.received} de {r.requested} recibidos</span>
                        </span>
                        <span className="mt-1.5 block h-2 rounded-full bg-slate-100 overflow-hidden">
                          <span className="block h-full bg-emerald-500" style={{ width: `${p}%` }} />
                        </span>
                        <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500 fab-tnum">
                          {done ? <span className="text-emerald-700 font-medium">Completa</span> : <span>{r.pending} pendiente(s)</span>}
                          {r.overdue > 0 && <span className="text-red-600 font-medium">{r.overdue} con fecha vencida</span>}
                          {!done && r.next_arrival && <span>Entrega: {String(r.next_arrival).slice(0, 10)}</span>}
                          <span>{num(r.yards_received, 0)} / {num(r.yards_requested, 0)} yd</span>
                          {r.last_received_at && <span>Última recepción: {fmtDateTime(r.last_received_at)}</span>}
                        </span>
                      </span>
                      {!done && <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        )}

        {tab === "pending" && (
          <RollTable
            rows={pending}
            columns={pendingCols}
            loading={loading}
            maxHeight="50vh"
            rowClass={(r) => (daysLate(r.arrival_date) ? "bg-red-50/40" : "")}
            defaultSort={{ key: "arrival_date", dir: "asc" }}
            empty={<EmptyState icon={CheckCircle2} title="Todo lo solicitado ya llegó" text="No hay rollos pendientes de recibir." />}
          />
        )}

        {tab === "unrequested" && (
          <>
            <div className="px-5 py-3 text-sm text-slate-600 bg-slate-50/60 border-b border-slate-100">
              Rollos escaneados en Recepción que <b>no estaban en ninguna solicitud a Skytex</b>. Si después se solicitan a Skytex
              se vinculan solos y salen de esta lista. Si ya lo aclaró con Skytex, márquelo como revisado con una nota.
            </div>
            <RollTable
              rows={unreq}
              columns={unreqCols}
              loading={loading}
              maxHeight="50vh"
              rowClass={(r) => (r.unrequested_reviewed_at ? "" : "bg-red-50/40")}
              defaultSort={{ key: "received_at", dir: "desc" }}
              empty={<EmptyState icon={CheckCircle2} title="Todo lo recibido estaba solicitado" text="No hay rollos recibidos sin solicitud a Skytex." />}
            />
          </>
        )}
      </div>

      <Modal
        open={!!review}
        onClose={() => setReview(null)}
        title={`Revisar ${review?.roll_no || ""}`}
        footer={<>
          <Button variant="secondary" onClick={() => setReview(null)}>Cancelar</Button>
          <Button icon={ClipboardCheck} loading={saving} disabled={!note.trim()} onClick={() => saveReview(false)}>Marcar revisado</Button>
        </>}
      >
        <div className="space-y-4">
          <div className="text-sm text-slate-600">
            Recibido {fmtDateTime(review?.received_at)}{review?.received_by_name ? ` por ${review.received_by_name}` : ""} en {review ? locationText(review) : ""}, sin solicitud a Skytex.
          </div>
          <Field label="¿Qué se revisó?" hint="Queda guardado con su nombre y la fecha.">
            <textarea className={cx(inputCls, "w-full")} rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus
              placeholder="Ej. Skytex confirma que pertenece a la PO 1218108; lo incluirán en el próximo envío de datos." />
          </Field>
          <div className="text-xs text-slate-500 flex items-start gap-1.5">
            <Undo2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            Si más adelante el rollo se solicita a Skytex, se vincula solo con su solicitud y deja de aparecer aquí.
          </div>
        </div>
      </Modal>
    </Card>
  );
}