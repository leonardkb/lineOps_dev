// components/FabricWH/FabricInventory.jsx
// Almacén de Tela — Inventario.
// Search in every field, filter by container, show only aged rolls, group by
// container / fabric / PO. Click a row for the roll's detail and history.
// Selected rolls can be moved, sent to inspection (creates the request) or
// exported.
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Boxes, RefreshCw, Download, MoveRight, Clock, Ruler, Microscope, ChevronDown, Layers,
} from "lucide-react";
import {
  api, post, num, cx, Card, Button, PageHeader, SegTabs, SearchInput, StatCard, RollTable,
  ActionBar, LocationPicker, StatusBadge, Pill, DaysCell, EmptyState, locationText,
  downloadCsv, useSelection, useToast, useConfirm, fmtDateTime, FABRIC_FIELDS, notifyChange, inputCls, boxSortKey,
} from "./fabricShared";

const GROUPS = {
  none: null,
  box: { label: "Contenedor", key: (r) => (r.box_code ? `${r.box_code} · ${r.location_code}` : "Sin contenedor") },
  division: { label: "División", key: (r) => (r.container_code ? `División ${r.container_code}` : "Sin división") },
  fabric: { label: "Tela", key: (r) => [r.fabric_name, r.color].filter(Boolean).join(" · ") || "Sin nombre" },
  po: { label: "PO", key: (r) => r.po_number || "Sin PO" },
};

export default function FabricInventory({ onNavigate = () => {} }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [rolls, setRolls] = useState([]);
  const [containers, setContainers] = useState([]);
  const [aging, setAging] = useState(30);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("in_stock");
  const [containerId, setContainerId] = useState("");
  const [onlyAged, setOnlyAged] = useState(false);
  const [groupBy, setGroupBy] = useState("none");
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const { sel, toggle, setAll, clear } = useSelection();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([api("/rolls?status=in_stock,at_inspection"), api("/containers")]);
      setRolls(r.rolls || []);
      setAging(r.agingDays || 30);
      setContainers(c.containers || []);
    } catch (e) { toast({ kind: "err", text: e.message }); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const inStock = rolls.filter((r) => r.status === "in_stock");
  const atInsp = rolls.filter((r) => r.status === "at_inspection");
  const aged = inStock.filter((r) => (r.days_in_stock ?? 0) >= aging);
  const sum = (arr, k) => arr.reduce((s, r) => s + (Number(r[k]) || 0), 0);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rolls.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (containerId && String(r.container_id) !== String(containerId)) return false;
      if (onlyAged && !(r.status === "in_stock" && (r.days_in_stock ?? 0) >= aging)) return false;
      if (t && ![...FABRIC_FIELDS.map((f) => r[f.key]), r.box_code, r.location_code]
        .some((v) => String(v ?? "").toLowerCase().includes(t))) return false;
      return true;
    });
  }, [rolls, q, status, containerId, onlyAged, aging]);

  const groups = useMemo(() => {
    const g = GROUPS[groupBy];
    if (!g) return null;
    const m = new Map();
    for (const r of shown) { const k = g.key(r); m.set(k, [...(m.get(k) || []), r]); }
    return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), "es", { numeric: true }));
  }, [shown, groupBy]);

  const chosen = rolls.filter((r) => sel.has(r.id));
  const chosenInStock = chosen.filter((r) => r.status === "in_stock");

  const move = async () => {
    setBusy(true);
    try {
      const d = await post("/rolls/assign-location", { ids: chosenInStock.map((r) => r.id), boxId: target });
      toast({ kind: "ok", text: `${d.updated} rollo(s) movidos al contenedor ${d.location.box_code} (${d.location.code}).` });
      clear(); setTarget(null);
      await load();
    } catch (e) { toast({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  };

  const toInspection = async () => {
    const ids = chosenInStock.filter((r) => !r.open_inspection_request).map((r) => r.id);
    if (!ids.length) return toast({ kind: "warn", text: "Los rollos seleccionados ya están en una solicitud de inspección." });
    const ok = await confirm({ title: `¿Solicitar inspección de ${ids.length} rollo(s)?`, text: "Se crea una solicitud que el almacén verá en «Inspección › Por enviar».", confirmLabel: "Crear solicitud" });
    if (!ok) return;
    try {
      const d = await post("/inspection-requests", { rollIds: ids });
      toast({ kind: "ok", title: `Solicitud ${d.request.request_no} creada`, text: `${ids.length} rollo(s)`, action: { label: "Ver solicitud →", onClick: () => onNavigate("inspeccion") } });
      clear(); notifyChange();
      await load();
    } catch (e) { toast({ kind: "err", text: e.message }); }
  };

  const exportCsv = (rows) => {
    downloadCsv(`inventario-tela-${new Date().toISOString().slice(0, 10)}.csv`, [
      { label: "Contenedor", key: "box_code" },
      { label: "Lugar", key: "location_code" },
      { label: "División", key: "container_code" },
      ...FABRIC_FIELDS.map((f) => ({ label: f.label, key: f.key })),
      { label: "Estado", key: "status" },
      { label: "Recibido", get: (r) => fmtDateTime(r.received_at) },
      { label: "Días en inventario", key: "days_in_stock" },
      { label: "Inspección", key: "inspection_result" },
    ], rows);
  };

  const columns = [
    { key: "box_code", label: "Contenedor · lugar", sortValue: boxSortKey, render: (r) => <span className="font-medium text-slate-900">{locationText(r)}</span> },
    { key: "roll_no", label: "Rollo", mono: true },
    { key: "fabric_name", label: "Tela", render: (r) => <span>{r.fabric_name || "—"}{r.fabric_type && <span className="text-slate-400"> · {r.fabric_type}</span>}</span> },
    { key: "color", label: "Color" },
    { key: "lot", label: "Lote" },
    { key: "po_number", label: "PO" },
    { key: "customer", label: "Cliente" },
    { key: "yards", label: "Yardas", align: "right", render: (r) => num(r.yards, 1) },
    { key: "meters", label: "Metros", align: "right", render: (r) => num(r.meters, 1) },
    { key: "days_in_stock", label: "Días", align: "right", render: (r) => <DaysCell days={r.days_in_stock} limit={aging} /> },
    {
      key: "status", label: "Estado", sortable: false,
      render: (r) => (
        <span className="inline-flex items-center gap-1">
          <StatusBadge status={r.status} />
          {r.inspection_result === "rejected" && <Pill tone="red">Rechazado</Pill>}
          {r.open_inspection_request && <Pill tone="violet">{r.open_inspection_request}</Pill>}
        </span>
      ),
    },
  ];

  const table = (rows) => (
    <RollTable
      rows={rows}
      columns={columns}
      loading={loading}
      selected={sel}
      onToggle={toggle}
      onToggleAll={(on, ids) => setAll(ids, on)}
      canSelect={(r) => r.status === "in_stock"}
      rowClass={(r) => (r.status === "in_stock" && (r.days_in_stock ?? 0) >= aging ? "bg-red-50/40" : "")}
      maxHeight={groups ? "none" : "65vh"}
      defaultSort={{ key: "box_code", dir: "asc" }}
      empty={
        <EmptyState
          icon={Boxes}
          title={q || containerId || onlyAged ? "Ningún rollo coincide" : "El inventario está vacío"}
          text={q || containerId || onlyAged ? "Cambie la búsqueda o los filtros." : "Los rollos aparecen aquí al escanearlos en Recepción."}
          action={!(q || containerId || onlyAged) && <Button onClick={() => onNavigate("recepcion")}>Ir a Recepción</Button>}
        />
      }
    />
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventario de tela"
        subtitle="Rollos guardados, su contenedor y cuántos días llevan en el almacén. Haga clic en un rollo para ver su detalle."
        actions={
          <>
            <Button variant="secondary" icon={Download} onClick={() => exportCsv(shown)} disabled={!shown.length}>Exportar</Button>
            <Button variant="secondary" icon={RefreshCw} loading={loading} onClick={load}>Actualizar</Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Boxes} label="Rollos en inventario" value={inStock.length} tone="emerald" onClick={() => { setStatus("in_stock"); setOnlyAged(false); }} />
        <StatCard icon={Ruler} label="Yardas / metros" value={num(sum(inStock, "yards"), 0)} sub={`${num(sum(inStock, "meters"), 0)} m`} tone="indigo" />
        <StatCard icon={Microscope} label="En inspección" value={atInsp.length} tone="violet" onClick={() => setStatus("at_inspection")} />
        <StatCard icon={Clock} label={`Más de ${aging} días`} value={aged.length} sub={aged.length ? "Clic para verlos" : "Ninguno"} tone={aged.length ? "red" : "slate"} onClick={() => { setStatus("in_stock"); setOnlyAged(true); }} />
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <SegTabs
            value={status}
            onChange={setStatus}
            tabs={[
              { key: "in_stock", label: "En inventario", count: inStock.length },
              { key: "at_inspection", label: "En inspección", count: atInsp.length },
              { key: "all", label: "Todos", count: rolls.length },
            ]}
          />
          <SearchInput value={q} onChange={setQ} placeholder="Buscar en cualquier campo…" className="flex-1 min-w-[220px]" />
        </div>
        <div className="px-5 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-3 text-sm bg-slate-50/50">
          <select value={containerId} onChange={(e) => setContainerId(e.target.value)} className={cx(inputCls, "py-1.5")}>
            <option value="">Todas las divisiones</option>
            {containers.map((c) => <option key={c.id} value={c.id}>División {c.code}</option>)}
          </select>
          <button
            onClick={() => setOnlyAged((v) => !v)}
            className={cx("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition",
              onlyAged ? "bg-red-600 text-white ring-red-600" : "bg-white text-slate-600 ring-slate-300 hover:ring-red-300")}
          >
            <Clock className="w-3.5 h-3.5" /> Más de {aging} días
          </button>
          <div className="ml-auto flex items-center gap-2 text-slate-500">
            <Layers className="w-4 h-4" /> Agrupar:
            <SegTabs size="sm" value={groupBy} onChange={(v) => { setGroupBy(v); setCollapsed(new Set()); }}
              tabs={[{ key: "none", label: "No" }, { key: "box", label: "Contenedor" }, { key: "division", label: "División" }, { key: "fabric", label: "Tela" }, { key: "po", label: "PO" }]} />
          </div>
          <span className="text-xs text-slate-400 w-full sm:w-auto">{shown.length} rollo(s) · {num(sum(shown, "yards"), 1)} yd</span>
        </div>

        {!groups ? table(shown) : loading ? table([]) : (
          <div className="divide-y divide-slate-100">
            {groups.length === 0 && table([])}
            {groups.map(([k, rows]) => {
              const isOpen = !collapsed.has(k);
              return (
                <div key={k}>
                  <button
                    onClick={() => setCollapsed((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; })}
                    className="w-full px-5 py-3 flex items-center gap-3 hover:bg-slate-50 text-left"
                  >
                    <ChevronDown className={cx("w-4 h-4 text-slate-400 transition-transform", !isOpen && "-rotate-90")} />
                    <span className="font-semibold text-slate-900">{k}</span>
                    <span className="text-xs text-slate-500 fab-tnum">{rows.length} rollo(s) · {num(sum(rows, "yards"), 1)} yd</span>
                  </button>
                  {isOpen && <div className="border-t border-slate-100">{table(rows)}</div>}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <ActionBar count={sel.size} summary={`${num(sum(chosen, "yards"), 1)} yd`} onClear={clear}>
        <LocationPicker containers={containers} value={target} onChange={setTarget} emptyLabel="Mover a…" />
        <Button icon={MoveRight} disabled={!target} loading={busy} onClick={move}>Mover</Button>
        <Button variant="onDark" icon={Microscope} onClick={toInspection}>Pedir inspección</Button>
        <Button variant="onDark" icon={Download} onClick={() => exportCsv(chosen)}>Exportar</Button>
      </ActionBar>
    </div>
  );
}