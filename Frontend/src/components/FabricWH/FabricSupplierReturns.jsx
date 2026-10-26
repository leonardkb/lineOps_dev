// components/FabricWH/FabricSupplierReturns.jsx
// Almacén de Tela — Devoluciones a proveedor.
// Candidates: rolls over the aging limit (default 30 days) and rolls rejected in
// inspection; any roll in stock can also be returned. Selected rolls → modal
// with reason, reference and a per-supplier summary. «Devueltos» is the history.
import { useState, useEffect, useCallback, useMemo } from "react";
import { Undo2, RefreshCw, Download, Clock, ThumbsDown, Boxes, History } from "lucide-react";
import {
  api, post, num, cx, Card, Button, PageHeader, SegTabs, SearchInput, RollTable, ActionBar,
  StatusBadge, Pill, DaysCell, EmptyState, Modal, Field, Banner, inputCls, locationText, boxSortKey,
  useSelection, useToast, fmtDateTime, downloadCsv, notifyChange,
} from "./fabricShared";

const REASONS = [
  { key: "aged", label: "Más de 30 días en inventario" },
  { key: "rejected", label: "Rechazado en inspección" },
  { key: "wrong", label: "Surtido equivocado" },
  { key: "damage", label: "Daño en transporte" },
  { key: "other", label: "Otro" },
];

export default function FabricSupplierReturns({ onNavigate = () => {} }) {
  const toast = useToast();
  const [view, setView] = useState("aged");
  const [rolls, setRolls] = useState([]);
  const [returned, setReturned] = useState([]);
  const [aging, setAging] = useState(30);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("aged");
  const [detail, setDetail] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const { sel, toggle, setAll, clear } = useSelection();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([api("/rolls?status=in_stock,at_inspection"), api("/rolls?status=returned&limit=1000")]);
      setRolls(a.rolls || []);
      setAging(a.agingDays || 30);
      setReturned(b.rolls || []);
    } catch (e) { toast({ kind: "err", text: e.message }); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const isAged = useCallback((r) => r.status === "in_stock" && (r.days_in_stock ?? 0) >= aging, [aging]);
  const aged = rolls.filter(isAged);
  const rejected = rolls.filter((r) => r.inspection_result === "rejected");
  const base = view === "aged" ? aged : view === "rejected" ? rejected : view === "history" ? returned : rolls;

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return base;
    return base.filter((r) => [r.roll_no, r.po_number, r.supplier, r.supplier_code, r.fabric_name, r.color, r.lot, r.customer, r.out_reference, r.out_reason, r.box_code, r.location_code]
      .some((v) => String(v ?? "").toLowerCase().includes(t)));
  }, [base, q]);

  const pickView = (v) => {
    setView(v); clear();
    if (v === "aged" || v === "rejected") setReason(v);
  };

  const chosen = rolls.filter((r) => sel.has(r.id));
  const bySupplier = useMemo(() => {
    const m = new Map();
    for (const r of chosen) {
      const k = r.supplier || r.supplier_code || "Sin proveedor";
      const c = m.get(k) || { rolls: 0, yards: 0 };
      c.rolls++; c.yards += Number(r.yards) || 0;
      m.set(k, c);
    }
    return [...m.entries()];
  }, [chosen]);
  const reasonLabel = REASONS.find((r) => r.key === reason)?.label.replace("30", String(aging));
  const fullReason = reason === "other" ? detail.trim() : [reasonLabel, detail.trim()].filter(Boolean).join(" — ");

  const doReturn = async () => {
    if (!fullReason) return toast({ kind: "warn", text: "Escriba el motivo de la devolución." });
    setBusy(true);
    try {
      const d = await post("/rolls/return-to-supplier", { ids: [...sel], reason: fullReason, reference });
      toast({ kind: "ok", title: `${d.returned} rollo(s) devueltos`, text: d.skipped ? `${d.skipped} ya no estaban disponibles.` : "Salieron del inventario y aparecen en el reporte de salidas." });
      clear(); setDetail(""); setReference(""); setOpen(false);
      notifyChange();
      await load();
    } catch (e) { toast({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  };

  const exportHistory = () =>
    downloadCsv(`devoluciones-tela-${new Date().toISOString().slice(0, 10)}.csv`, [
      { label: "Fecha", get: (r) => fmtDateTime(r.out_at) },
      { label: "Rollo de tela", key: "roll_no" },
      { label: "Purchase order number", key: "po_number" },
      { label: "Supplier", key: "supplier" },
      { label: "Supplier Code", key: "supplier_code" },
      { label: "Fabric name", key: "fabric_name" },
      { label: "Color", key: "color" },
      { label: "Lote", key: "lot" },
      { label: "Yardas", key: "yards" },
      { label: "Metros", key: "meters" },
      { label: "Motivo", key: "out_reason" },
      { label: "Referencia", key: "out_reference" },
    ], shown);

  const historyCols = [
    { key: "out_at", label: "Fecha", render: (r) => fmtDateTime(r.out_at), sortValue: (r) => r.out_at },
    { key: "roll_no", label: "Rollo", mono: true },
    { key: "supplier", label: "Proveedor" },
    { key: "po_number", label: "PO" },
    { key: "fabric_name", label: "Tela", render: (r) => <span>{r.fabric_name || "—"} <span className="text-slate-400">· {r.color || "—"}</span></span> },
    { key: "yards", label: "Yardas", align: "right", render: (r) => num(r.yards, 1) },
    { key: "out_reason", label: "Motivo", className: "max-w-[260px] truncate" },
    { key: "out_reference", label: "Referencia", mono: true },
  ];
  const candidateCols = [
    { key: "box_code", label: "Contenedor", sortValue: boxSortKey, render: (r) => <span className="font-medium text-slate-900">{locationText(r)}</span> },
    { key: "roll_no", label: "Rollo", mono: true },
    { key: "supplier", label: "Proveedor" },
    { key: "po_number", label: "PO" },
    { key: "fabric_name", label: "Tela", render: (r) => <span>{r.fabric_name || "—"} <span className="text-slate-400">· {r.color || "—"}</span></span> },
    { key: "lot", label: "Lote" },
    { key: "yards", label: "Yardas", align: "right", render: (r) => num(r.yards, 1) },
    { key: "days_in_stock", label: "Días", align: "right", render: (r) => <DaysCell days={r.days_in_stock} limit={aging} /> },
    {
      key: "status", label: "Estado", sortable: false,
      render: (r) => <span className="inline-flex gap-1"><StatusBadge status={r.status} />{r.inspection_result === "rejected" && <Pill tone="red">Rechazado</Pill>}</span>,
    },
  ];

  const emptyFor = {
    aged: <EmptyState icon={Clock} title={`Ningún rollo pasa de ${aging} días`} text="Buen trabajo: el inventario está rotando." />,
    rejected: <EmptyState icon={ThumbsDown} title="No hay rollos rechazados" text="Los rollos que inspección rechace aparecerán aquí." />,
    all: <EmptyState icon={Boxes} title="El inventario está vacío" />,
    history: <EmptyState icon={History} title="Aún no se ha devuelto ningún rollo" />,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Devoluciones a proveedor"
        subtitle={`Rollos con más de ${aging} días en inventario o rechazados en inspección. Seleccione los que regresan al proveedor.`}
        actions={
          <>
            {view === "history" && <Button variant="secondary" icon={Download} disabled={!shown.length} onClick={exportHistory}>Exportar</Button>}
            <Button variant="secondary" icon={RefreshCw} loading={loading} onClick={load}>Actualizar</Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <SegTabs
            value={view}
            onChange={pickView}
            tabs={[
              { key: "aged", label: `Más de ${aging} días`, icon: Clock, count: aged.length },
              { key: "rejected", label: "Rechazados", icon: ThumbsDown, count: rejected.length },
              { key: "all", label: "Todo el inventario", icon: Boxes, count: rolls.length },
              { key: "history", label: "Devueltos", icon: History, count: returned.length },
            ]}
          />
          <SearchInput value={q} onChange={setQ} placeholder="Rollo, PO, proveedor, referencia…" className="flex-1 min-w-[220px]" />
        </div>
        <RollTable
          rows={shown}
          columns={view === "history" ? historyCols : candidateCols}
          selected={view === "history" ? null : sel}
          onToggle={toggle}
          onToggleAll={(on, ids) => setAll(ids, on)}
          loading={loading}
          rowClass={(r) => (view !== "history" && isAged(r) ? "bg-red-50/40" : "")}
          defaultSort={view === "history" ? { key: "out_at", dir: "desc" } : { key: "days_in_stock", dir: "desc" }}
          empty={emptyFor[view]}
          key={view}
        />
      </Card>

      <ActionBar count={sel.size} summary={`${num(chosen.reduce((s, r) => s + (Number(r.yards) || 0), 0), 1)} yd · ${bySupplier.length} proveedor(es)`} onClear={clear}>
        <Button variant="danger" icon={Undo2} onClick={() => setOpen(true)}>Devolver al proveedor</Button>
      </ActionBar>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Devolver ${sel.size} rollo(s) al proveedor`}
        size="lg"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button variant="danger" icon={Undo2} loading={busy} onClick={doReturn} disabled={!fullReason}>Confirmar devolución</Button></>}
      >
        <div className="space-y-5">
          <div>
            <div className="text-xs font-medium text-slate-600 mb-2">Motivo</div>
            <div className="flex flex-wrap gap-2">
              {REASONS.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setReason(r.key)}
                  className={cx("rounded-lg px-3 py-1.5 text-sm ring-1 ring-inset transition",
                    reason === r.key ? "bg-red-600 text-white ring-red-600" : "bg-white text-slate-700 ring-slate-300 hover:ring-red-300")}
                >
                  {r.label.replace("30", String(aging))}
                </button>
              ))}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label={reason === "other" ? "Describa el motivo" : "Detalle (opcional)"}>
              <input className={inputCls} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder={reason === "other" ? "Motivo de la devolución" : "Ej. manchas en los primeros metros"} />
            </Field>
            <Field label="Referencia / folio (opcional)" hint="RMA o número de nota de devolución">
              <input className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="RMA-2026-0012" />
            </Field>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-600 mb-2">Resumen por proveedor</div>
            <div className="rounded-xl ring-1 ring-slate-200 divide-y divide-slate-100">
              {bySupplier.map(([s, v]) => (
                <div key={s} className="px-4 py-2 flex justify-between text-sm">
                  <span className="font-medium text-slate-800">{s}</span>
                  <span className="text-slate-500 fab-tnum">{v.rolls} rollo(s) · {num(v.yards, 1)} yd</span>
                </div>
              ))}
            </div>
          </div>
          <Banner kind="warn">Los rollos saldrán del inventario y quedarán registrados en el reporte de salidas.</Banner>
        </div>
      </Modal>
    </div>
  );
}