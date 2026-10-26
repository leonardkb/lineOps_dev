// components/FabricWH/FabricInspection.jsx
// Almacén de Tela — Inspección.
//   Por enviar      Requests from the inspection team. Pick list sorted by
//                   position; scan each roll as you pull it, then send.
//   Nueva solicitud The team chooses rolls in stock and asks for them.
//   En inspección   Rolls with the team come back approved or rejected
//                   (rejected ones are offered for return to the supplier).
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Microscope, Send, CheckCircle2, Circle, ThumbsUp, ThumbsDown, Plus, RefreshCw,
  ClipboardList, Inbox, XCircle,
} from "lucide-react";
import {
  api, post, num, cx, beep, Card, CardHeader, Button, PageHeader, SegTabs, SearchInput,
  ScanBox, RollTable, ActionBar, LocationPicker, EmptyState, Modal, Field, ProgressBar, Pill,
  locationText, boxSortKey, useSelection, useToast, useConfirm, timeAgo, fmtDateTime, inputCls, notifyChange,
} from "./fabricShared";

export default function FabricInspection({ onNavigate = () => {} }) {
  const [view, setView] = useState("send");
  const [counts, setCounts] = useState({ send: null, back: null });

  const refreshCounts = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([api("/inspection-requests?status=open,partial"), api("/rolls?status=at_inspection&limit=2000")]);
      setCounts({ send: (a.requests || []).length, back: (b.rolls || []).length });
    } catch { /* counts are optional */ }
  }, []);
  useEffect(() => { refreshCounts(); }, [refreshCounts, view]);

  const changed = () => { refreshCounts(); notifyChange(); };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inspección de tela"
        subtitle="Rollos que pide el equipo de inspección: prepararlos, enviarlos y recibirlos de regreso con su resultado."
        actions={
          <SegTabs
            value={view}
            onChange={setView}
            tabs={[
              { key: "send", label: "Por enviar", icon: Send, count: counts.send },
              { key: "new", label: "Nueva solicitud", icon: Plus },
              { key: "back", label: "En inspección", icon: Microscope, count: counts.back },
            ]}
          />
        }
      />
      {view === "send" && <SendRequests onChanged={changed} onNew={() => setView("new")} />}
      {view === "new" && <NewRequest onCreated={() => { changed(); setView("send"); }} />}
      {view === "back" && <ReturnFromInspection onChanged={changed} onNavigate={onNavigate} />}
    </div>
  );
}

// --- Warehouse: open requests → pick by scanning → send ---------------------
function SendRequests({ onChanged, onNew }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [lastScan, setLastScan] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api("/inspection-requests?status=open,partial");
      const list = d.requests || [];
      setRequests(list);
      setActiveId((cur) => (list.some((r) => r.id === cur) ? cur : list[0]?.id ?? null));
    } catch (e) { toast({ kind: "err", text: e.message }); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const active = requests.find((r) => r.id === activeId);
  const pickList = useMemo(() => {
    const rolls = active?.rolls || [];
    return [...rolls].sort((a, b) =>
      Number(!!a.sent_at) - Number(!!b.sent_at) ||
      boxSortKey(a).localeCompare(boxSortKey(b), "es", { numeric: true }));
  }, [active]);
  const pending = pickList.filter((r) => !r.sent_at);

  const onScan = async (raw) => {
    if (!active) return;
    try {
      const d = await post("/lookup", { raw });
      const match = d.rolls.find((r) => pending.some((p) => p.id === r.id));
      if (!match) {
        beep("err");
        setLastScan({ kind: "err", text: `${d.rolls[0]?.roll_no || raw} no está en ${active.request_no}` });
        return;
      }
      if (picked.has(match.id)) { beep("dup"); setLastScan({ kind: "dup", text: `${match.roll_no} ya estaba escaneado` }); return; }
      beep("ok");
      setPicked((p) => new Set(p).add(match.id));
      setLastScan({ kind: "ok", text: `${match.roll_no} listo` });
    } catch (e) { beep("err"); setLastScan({ kind: "err", text: e.message }); }
  };

  const send = async (all) => {
    const ids = all ? pending.map((r) => r.id) : [...picked];
    if (!ids.length) return;
    if (all && !(await confirm({ title: `¿Enviar ${ids.length} rollo(s) sin escanear?`, text: "Se marcarán como enviados aunque no se verificaron con el escáner.", confirmLabel: "Enviar todos" }))) return;
    setBusy(true);
    try {
      const d = await post(`/inspection-requests/${active.id}/send`, { rollIds: ids });
      toast({ kind: "ok", title: `${d.sent} rollo(s) enviados a inspección`, text: d.status === "sent" ? `${active.request_no} completa.` : `${active.request_no}: faltan rollos por enviar.` });
      setPicked(new Set()); setLastScan(null);
      onChanged();
      await load();
    } catch (e) { toast({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!(await confirm({ title: `¿Cancelar ${active.request_no}?`, danger: true, confirmLabel: "Cancelar solicitud", cancelLabel: "Volver" }))) return;
    try {
      await post(`/inspection-requests/${active.id}/cancel`);
      toast({ kind: "info", text: `${active.request_no} cancelada.` });
      onChanged();
      await load();
    } catch (e) { toast({ kind: "err", text: e.message }); }
  };

  if (!loading && !requests.length) {
    return (
      <Card>
        <EmptyState icon={Inbox} title="No hay solicitudes por enviar" text="Cuando el equipo de inspección pida rollos, aparecerán aquí ordenados por contenedor." action={<Button variant="secondary" icon={Plus} onClick={onNew}>Crear una solicitud</Button>} />
      </Card>
    );
  }

  return (
    <div className="grid lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-4 space-y-3">
        <div className="flex items-center justify-between px-1">
          <span className="text-sm font-semibold text-slate-700">Solicitudes</span>
          <Button size="sm" variant="ghost" icon={RefreshCw} loading={loading} onClick={load}>Actualizar</Button>
        </div>
        {requests.map((r) => {
          const sent = r.rolls.filter((x) => x.sent_at).length;
          const on = r.id === activeId;
          return (
            <button
              key={r.id}
              onClick={() => { setActiveId(r.id); setPicked(new Set()); setLastScan(null); }}
              className={cx("w-full text-left rounded-2xl p-4 ring-1 transition",
                on ? "bg-white ring-2 ring-indigo-500 shadow-sm" : "bg-white ring-slate-200 hover:ring-indigo-300")}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold text-slate-900">{r.request_no}</span>
                <span className="text-xs text-slate-400">{timeAgo(r.created_at)}</span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{r.requested_by_name || "—"} · {r.rolls.length} rollo(s)</div>
              {r.notes && <div className="text-xs text-slate-600 mt-1.5 line-clamp-2 bg-slate-50 rounded-lg px-2 py-1">“{r.notes}”</div>}
              <ProgressBar value={sent} max={r.rolls.length} tone="violet" className="h-1.5 mt-3" />
              <div className="text-[11px] text-slate-500 mt-1 fab-tnum">{sent}/{r.rolls.length} enviados</div>
            </button>
          );
        })}
      </div>

      <Card className="lg:col-span-8 overflow-hidden">
        {!active ? <EmptyState icon={ClipboardList} title="Elija una solicitud" /> : (
          <>
            <CardHeader
              title={<span className="font-mono">{active.request_no}</span>}
              subtitle={`Solicitada por ${active.requested_by_name || "—"} · ${fmtDateTime(active.created_at)}`}
              actions={active.status === "open" && <Button size="sm" variant="ghost" icon={XCircle} onClick={cancel}>Cancelar solicitud</Button>}
            />
            <div className="p-5 space-y-4 border-b border-slate-100">
              <ScanBox onScan={onScan} placeholder="Escanee cada rollo al sacarlo de su contenedor…" />
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px]">
                  <ProgressBar value={picked.size} max={pending.length} tone="emerald" className="h-2" />
                  <div className="text-xs text-slate-500 mt-1 fab-tnum">{picked.size} de {pending.length} escaneados</div>
                </div>
                {lastScan && (
                  <span className={cx("text-sm font-medium", lastScan.kind === "ok" ? "text-emerald-700" : lastScan.kind === "dup" ? "text-amber-700" : "text-red-600")}>
                    {lastScan.text}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button icon={Send} disabled={!picked.size} loading={busy} onClick={() => send(false)}>Enviar {picked.size || ""} escaneado(s)</Button>
                <Button variant="secondary" disabled={!pending.length || busy} onClick={() => send(true)}>Enviar todos sin escanear</Button>
              </div>
            </div>
            <ul className="divide-y divide-slate-100 max-h-[55vh] overflow-y-auto">
              {pickList.map((r) => {
                const isPicked = picked.has(r.id);
                return (
                  <li key={r.id} className={cx("px-5 py-3 flex items-center gap-4", r.sent_at ? "opacity-50" : isPicked && "bg-emerald-50")}>
                    {r.sent_at || isPicked
                      ? <CheckCircle2 className={cx("w-5 h-5 shrink-0", r.sent_at ? "text-slate-400" : "text-emerald-600")} />
                      : <Circle className="w-5 h-5 shrink-0 text-slate-300" />}
                    <div className="w-28 shrink-0">
                      <div className="text-[11px] text-slate-400">Contenedor · lugar</div>
                      <div className="font-semibold text-slate-900">{locationText(r)}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm font-semibold text-slate-900">{r.roll_no}</div>
                      <div className="text-xs text-slate-500 truncate">{r.fabric_name || "—"} · {r.color || "—"} · Lote {r.lot || "—"} · PO {r.po_number || "—"}</div>
                    </div>
                    <div className="text-right text-sm fab-tnum text-slate-600">{num(r.yards, 1)} yd</div>
                    <div className="w-24 text-right">
                      {r.sent_at ? <Pill tone="slate">Enviado</Pill> : isPicked ? <Pill tone="emerald">Listo</Pill> : <Pill tone="amber">Por sacar</Pill>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}

// --- Inspection team: choose rolls in stock ---------------------------------
function NewRequest({ onCreated }) {
  const toast = useToast();
  const [rolls, setRolls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const { sel, toggle, setAll, clear } = useSelection();

  useEffect(() => {
    (async () => {
      try {
        const d = await api("/rolls?status=in_stock");
        setRolls((d.rolls || []).filter((r) => !r.open_inspection_request));
      } catch (e) { toast({ kind: "err", text: e.message }); }
      finally { setLoading(false); }
    })();
  }, [toast]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rolls;
    return rolls.filter((r) => [r.roll_no, r.po_number, r.supplier, r.fabric_name, r.fabric_item_number, r.color, r.lot, r.customer].some((v) => String(v ?? "").toLowerCase().includes(t)));
  }, [rolls, q]);
  const chosen = rolls.filter((r) => sel.has(r.id));

  const create = async () => {
    setBusy(true);
    try {
      const d = await post("/inspection-requests", { rollIds: [...sel], notes });
      toast({ kind: "ok", title: `Solicitud ${d.request.request_no} creada`, text: `${sel.size} rollo(s). El almacén la verá en «Por enviar».` });
      clear(); setNotes(""); setOpen(false);
      onCreated();
    } catch (e) { toast({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  };

  const columns = [
    { key: "roll_no", label: "Rollo", mono: true },
    { key: "fabric_name", label: "Tela", render: (r) => <span>{r.fabric_name || "—"} <span className="text-slate-400">· {r.color || "—"}</span></span> },
    { key: "fabric_item_number", label: "Item" },
    { key: "lot", label: "Lote" },
    { key: "po_number", label: "PO" },
    { key: "supplier", label: "Proveedor" },
    { key: "yards", label: "Yardas", align: "right", render: (r) => num(r.yards, 1) },
    { key: "box_code", label: "Contenedor", sortValue: boxSortKey, render: (r) => locationText(r) },
    { key: "inspection_result", label: "Inspección previa", render: (r) => r.inspection_result === "approved" ? <Pill tone="emerald">Aprobado</Pill> : r.inspection_result === "rejected" ? <Pill tone="red">Rechazado</Pill> : <span className="text-slate-300">—</span> },
  ];

  return (
    <>
      <Card className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <div className="text-sm text-slate-600">Elija los rollos que quiere inspeccionar.</div>
          <SearchInput value={q} onChange={setQ} placeholder="Rollo, tela, lote, PO…" className="ml-auto w-full sm:w-80" />
        </div>
        <RollTable
          rows={shown}
          columns={columns}
          selected={sel}
          onToggle={toggle}
          onToggleAll={(on, ids) => setAll(ids, on)}
          onRowClick={(r) => toggle(r.id)}
          loading={loading}
          empty={<EmptyState icon={Microscope} title="No hay rollos disponibles" text="Solo se pueden pedir rollos en inventario que no estén ya en otra solicitud." />}
        />
      </Card>
      <ActionBar count={sel.size} summary={`${num(chosen.reduce((s, r) => s + (Number(r.yards) || 0), 0), 1)} yd`} onClear={clear}>
        <Button icon={Send} onClick={() => setOpen(true)}>Solicitar inspección</Button>
      </ActionBar>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Solicitar ${sel.size} rollo(s) a inspección`}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button icon={Send} loading={busy} onClick={create}>Enviar solicitud</Button></>}
      >
        <Field label="Nota para el almacén (opcional)" hint="Ej. revisar tono contra el lote anterior">
          <textarea className={cx(inputCls, "w-full")} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} autoFocus />
        </Field>
        <div className="mt-4 text-xs text-slate-500">{chosen.slice(0, 12).map((r) => r.roll_no).join(", ")}{chosen.length > 12 ? ` y ${chosen.length - 12} más` : ""}</div>
      </Modal>
    </>
  );
}

// --- Rolls come back from inspection ---------------------------------------
function ReturnFromInspection({ onChanged, onNavigate }) {
  const toast = useToast();
  const [rolls, setRolls] = useState([]);
  const [containers, setContainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locationId, setLocationId] = useState(null);
  const [busy, setBusy] = useState(false);
  const { sel, toggle, setAll, clear } = useSelection();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([api("/rolls?status=at_inspection"), api("/containers")]);
      setRolls(r.rolls || []);
      setContainers(c.containers || []);
    } catch (e) { toast({ kind: "err", text: e.message }); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const back = async (result) => {
    setBusy(true);
    try {
      const d = await post("/rolls/return-from-inspection", { ids: [...sel], result, boxId: locationId || undefined });
      toast({
        kind: "ok",
        title: `${d.updated} rollo(s) ${result === "approved" ? "aprobados" : "rechazados"}`,
        text: "Regresaron al inventario.",
        action: result === "rejected" ? { label: "Devolver al proveedor →", onClick: () => onNavigate("devoluciones") } : undefined,
      });
      clear(); setLocationId(null);
      onChanged();
      await load();
    } catch (e) { toast({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  };

  const columns = [
    { key: "roll_no", label: "Rollo", mono: true },
    { key: "fabric_name", label: "Tela", render: (r) => <span>{r.fabric_name || "—"} <span className="text-slate-400">· {r.color || "—"}</span></span> },
    { key: "lot", label: "Lote" },
    { key: "po_number", label: "PO" },
    { key: "yards", label: "Yardas", align: "right", render: (r) => num(r.yards, 1) },
    { key: "box_code", label: "Contenedor original", sortValue: boxSortKey, render: (r) => locationText(r) },
    { key: "out_at", label: "Enviado", render: (r) => timeAgo(r.out_at) },
  ];

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader title="Rollos con el equipo de inspección" subtitle="Seleccione los que regresan y marque el resultado." actions={<Button size="sm" variant="ghost" icon={RefreshCw} loading={loading} onClick={load}>Actualizar</Button>} />
        <RollTable
          rows={rolls}
          columns={columns}
          selected={sel}
          onToggle={toggle}
          onToggleAll={(on, ids) => setAll(ids, on)}
          loading={loading}
          empty={<EmptyState icon={Microscope} title="No hay rollos en inspección" />}
        />
      </Card>
      <ActionBar count={sel.size} onClear={clear}>
        <LocationPicker containers={containers} value={locationId} onChange={setLocationId} allowEmpty emptyLabel="A su contenedor original" />
        <Button variant="success" icon={ThumbsUp} loading={busy} onClick={() => back("approved")}>Aprobados</Button>
        <Button variant="danger" icon={ThumbsDown} loading={busy} onClick={() => back("rejected")}>Rechazados</Button>
      </ActionBar>
    </>
  );
}