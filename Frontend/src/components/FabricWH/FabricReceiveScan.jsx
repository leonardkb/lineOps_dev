// components/FabricWH/FabricReceiveScan.jsx
// Almacén de Tela — Recepción con PDA.
//
// Flow on the floor (same as reserving in Ubicaciones):
//   1. Scan the spot label (A01)                     → active spot
//   2. Scan the container that is there (F33)        → active container. If the
//      system had F33 somewhere else, the PDA asks to register that F33 is now
//      on A01 (the container that was registered on A01 stays «sin lugar»).
//   3. Scan 1–40 roll barcodes (21521211082608 …)   → each roll is CHECKED and
//      added to a list (nothing saved yet); remove any roll from the list, then
//      «Guardar N rollos en F33» saves them all together (all or nothing).
//   Scan another spot label at any time to start again at step 2.
// Each container holds up to its capacity (100 rolls); when full the PDA beeps.
// One input handles every label; the backend tells what each code is (POST /scan).
//
// «Aceptar rollos sin solicitud» registers rolls that were not requested from
// Skytex yet; their Skytex data is filled in when they are requested later.
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  RefreshCw, RotateCcw, CheckCircle2, AlertCircle, AlertTriangle,
  ChevronDown, PackageCheck, Truck, Boxes,
} from "lucide-react";
import {
  api, post, num, cx, beep, vibrate, Card, CardHeader, Button, PageHeader,
  ProgressBar, EmptyState, Pill, todayStr, fmtTime, useToast, useConfirm, useRollDrawer, notifyChange,
  useScanFlow, ScanFlowCard, locationText, useRollBatch, batchProblem, BatchCard, MAX_BATCH,
} from "./fabricShared";

const UNREQ_KEY = "fabricAllowUnrequested";

export default function FabricReceiveScan({ onNavigate = () => {} }) {
  const toast = useToast();
  const confirm = useConfirm();
  const openRoll = useRollDrawer();

  const [allowUnrequested, setAllowUnrequested] = useState(() => localStorage.getItem(UNREQ_KEY) !== "0");
  const [inBox, setInBox] = useState([]);
  const [containers, setContainers] = useState([]);
  const [received, setReceived] = useState([]);
  const [pending, setPending] = useState([]);
  const [result, setResult] = useState(null);
  const [session, setSession] = useState([]); // rolls scanned on this screen (for undo)
  const [loading, setLoading] = useState(true);
  const [openPo, setOpenPo] = useState(null);
  const [saving, setSaving] = useState(false);
  const batch = useRollBatch("fabricReceiveBatch");
  const live = useRef({});

  useEffect(() => { localStorage.setItem(UNREQ_KEY, allowUnrequested ? "1" : "0"); }, [allowUnrequested]);

  // A checked roll (nothing saved yet) → add it to the list.
  const onRoll = useCallback((d, raw) => {
    const k = Date.now();
    const { items, box: B } = live.current;
    if (d.duplicate) {
      beep("dup"); vibrate([80, 60, 80]);
      setResult({ n: k, kind: "dup", roll: d.roll, text: d.message || "Este rollo ya fue recibido." });
      return;
    }
    const problem = batchProblem({ items, roll: d.roll, box: B, takesSpace: d.takesSpace !== false });
    if (problem) {
      beep("err"); vibrate([200, 100, 200]);
      setResult({ n: k, kind: "err", text: problem });
      return;
    }
    beep("ok"); vibrate(40);
    batch.add(B.id, {
      raw, roll: d.roll, takesSpace: d.takesSpace !== false, allowUnrequested: !!d.unrequested,
      note: d.unrequested ? "sin solicitud" : d.movedFromAssigned ? `reservado en ${d.reservedIn}` : null,
    });
    setResult({ n: k, kind: "added", roll: d.roll, count: items.length + 1, unrequested: d.unrequested, moved: d.movedFromAssigned, reservedIn: d.reservedIn });
  }, [batch.add]); // eslint-disable-line react-hooks/exhaustive-deps
  const onRollError = useCallback((e, raw) => {
    beep("err"); vibrate([200, 100, 200]);
    setResult({ n: Date.now(), kind: "err", text: e.message, code: e.data?.code, raw });
  }, []);

  const f = useScanFlow({
    endpoint: "/scan", storageKey: "fabricReceiveFlow",
    extra: { allowUnrequested, check: true }, onRoll, onRollError, locked: batch.items.length,
  });
  const box = f.flow.box;
  live.current = { items: batch.items, box };
  // A list left from another container (should not happen: the flow is locked) is dropped.
  useEffect(() => {
    if (batch.items.length && box?.id && String(batch.boxId) !== String(box.id)) batch.clear();
  }, [box?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // «Guardar N rollos»: everything in one transaction.
  const saveBatch = async () => {
    if (!box || !batch.items.length) return;
    setSaving(true);
    try {
      const d = await post("/scan-batch", {
        mode: "receive", boxId: box.id,
        rolls: [...batch.items].reverse().map((x) => ({ raw: x.raw, allowUnrequested: x.allowUnrequested || allowUnrequested })),
      });
      const saved = (d.results || []).filter((x) => x.ok && x.roll).map((x) => x.roll);
      beep("ok"); vibrate([60, 40, 60]);
      setResult({ n: Date.now(), kind: "saved", count: d.saved, dups: d.duplicates, box: d.box });
      f.setBox(d.box);
      setInBox((prev) => [...saved, ...prev.filter((r) => !saved.some((s) => s.id === r.id))]);
      setSession((prev) => [...saved, ...prev]);
      setReceived((prev) => [...saved.map((r) => ({ ...r, movement_id: `new-${r.id}-${Date.now()}`, moved_at: r.received_at || new Date().toISOString(), roll_id: r.id })), ...prev]);
      setPending((prev) => prev.filter((p) => !saved.some((s) => s.id === p.id)));
      batch.clear();
      notifyChange();
    } catch (e) {
      beep("err"); vibrate([200, 100, 200]);
      if (e.data?.results) batch.markErrors(e.data.results);
      setResult({ n: Date.now(), kind: "err", text: e.message });
    } finally { setSaving(false); }
  };

  const clearBatch = async () => {
    const ok = await confirm({ title: `¿Vaciar la lista de ${batch.items.length} rollo(s)?`, text: "No se guarda ninguno. Podrá escanearlos otra vez.", confirmLabel: "Vaciar", danger: true });
    if (ok) { batch.clear(); setResult(null); }
  };

  const loadBox = useCallback(async (id) => {
    if (!id) { setInBox([]); return; }
    try {
      const d = await api(`/boxes/${id}/rolls`);
      setInBox(d.rolls || []);
      f.setBox(d.box);
    } catch { setInBox([]); }
  }, [f.setBox]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = todayStr();
      const [c, inb, p] = await Promise.all([
        api("/containers"),
        api(`/reports/inbound?from=${t}&to=${t}`),
        api("/rolls?status=assigned,requested"),
      ]);
      setContainers(c.containers || []);
      setReceived(inb.rows || []);
      setPending(p.rolls || []);
    } catch (e) { toast({ kind: "err", text: e.message }); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadBox(box?.id); setResult(null); }, [box?.id, loadBox]);

  // «Registrar de todos modos» right after a not_requested error.
  const forceUnrequested = async (raw) => {
    try {
      const d = await post("/scan", { raw, boxId: box?.id, allowUnrequested: true, check: true });
      onRoll(d, raw);
    } catch (e) { onRollError(e, raw); }
  };

  const undo = async (r) => {
    const id = r.roll_id || r.id;
    const ok = await confirm({ title: `¿Deshacer la recepción de ${r.roll_no}?`, text: "El rollo sale del contenedor y vuelve a «Esperando llegada».", confirmLabel: "Deshacer", danger: true });
    if (!ok) return;
    try {
      await post(`/rolls/${id}/undo-receive`);
      toast({ kind: "info", text: `Recepción de ${r.roll_no} deshecha.` });
      setSession((p) => p.filter((x) => x.id !== id));
      setResult(null);
      notifyChange();
      await Promise.all([load(), loadBox(box?.id)]);
    } catch (e) { toast({ kind: "err", text: e.message }); }
  };

  const poRows = useMemo(() => {
    const m = new Map();
    const get = (k) => m.get(k) || { po: k, received: 0, pending: [], yards: 0 };
    for (const r of received) { const k = r.po_number || "Sin PO"; const c = get(k); c.received++; m.set(k, c); }
    for (const p of pending) { const k = p.po_number || "Sin PO"; const c = get(k); c.pending.push(p); c.yards += Number(p.yards) || 0; m.set(k, c); }
    return [...m.values()].sort((a, b) => b.pending.length - a.pending.length);
  }, [received, pending]);

  const R = result && f.step === 3 ? result : null;
  const active = box ? { code: box.code } : null; // used by the result card below

  return (
    <div className="space-y-5">
      <PageHeader
        title="Recepción de rollos"
        subtitle={`Escanee el lugar, después el contenedor que está ahí y luego de 1 a ${MAX_BATCH} rollos. Revise la lista y guárdelos juntos.`}
        actions={<Button variant="secondary" icon={RefreshCw} loading={loading} onClick={() => { load(); loadBox(box?.id); }}>Actualizar</Button>}
      />

      <div className="grid xl:grid-cols-12 gap-5 items-start">
        <div className="xl:col-span-8 space-y-5 min-w-0">
          <ScanFlowCard f={f} containers={containers} rollsVerb="guardar">
            <label className="inline-flex items-center gap-2 text-slate-600">
              <input type="checkbox" className="rounded border-slate-300 text-indigo-600" checked={allowUnrequested} onChange={(e) => setAllowUnrequested(e.target.checked)} />
              Aceptar rollos sin solicitud a Skytex
            </label>
          </ScanFlowCard>

          {/* Last scan */}
          {R && (
            <div
              key={R.n}
              role="status"
              aria-live="assertive"
              className={cx("rounded-2xl p-4 sm:p-5 fab-pop",
                R.kind === "added" && "bg-indigo-600 text-white",
                R.kind === "saved" && "bg-emerald-600 text-white",
                R.kind === "dup" && "bg-amber-100 text-amber-900 ring-1 ring-amber-300",
                R.kind === "err" && "bg-red-600 text-white")}
            >
              {R.kind === "saved" && (
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-8 h-8 shrink-0" />
                  <div>
                    <div className="text-2xl font-bold leading-tight">{R.count} rollo(s) guardados en {R.box?.code}</div>
                    <div className="text-sm opacity-90">
                      {R.box?.location_code && <>Lugar {R.box.location_code} · </>}{R.box?.stored} rollos en el contenedor
                      {R.dups ? <> · {R.dups} ya estaban guardados</> : null}
                    </div>
                  </div>
                </div>
              )}
              {(R.kind === "added" || R.kind === "dup") && R.roll && (
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {R.kind === "added" ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                    {R.kind === "added" ? `Agregado a la lista · ${R.count} de ${MAX_BATCH}` : R.text}
                    {R.unrequested && <span className="ml-1 text-[11px] rounded-md bg-white/20 px-1.5 py-0.5">sin solicitud</span>}
                    {R.moved && <span className="ml-1 text-[11px] rounded-md bg-white/20 px-1.5 py-0.5">estaba reservado en {R.reservedIn}</span>}
                  </div>
                  <div className="font-mono text-2xl sm:text-3xl font-bold mt-1 break-all">{R.roll.roll_no}</div>
                  <div className="text-sm opacity-90 mt-0.5">
                    {[R.roll.fabric_name, R.roll.color, R.roll.po_number && `PO ${R.roll.po_number}`].filter(Boolean).join(" · ") || "Datos de Skytex pendientes"}
                    {R.roll.yards != null && <> · {num(R.roll.yards, 1)} yd</>}
                  </div>
                </div>
              )}
              {R.kind === "err" && (
                <div>
                  <div className="flex items-center gap-2 text-base font-semibold"><AlertCircle className="w-5 h-5" /> {R.text}</div>
                  {R.code === "not_requested" && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {active && (
                        <Button size="sm" variant="secondary" onClick={() => forceUnrequested(R.raw)}>
                          Agregar a la lista sin solicitud
                        </Button>
                      )}
                      <Button size="sm" variant="onDark" onClick={() => onNavigate("solicitar")}>Ir a Solicitar a Skytex</Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Scanned, waiting to be saved */}
          {box && f.step === 3 && (
            <BatchCard
              items={batch.items}
              boxCode={box.code}
              verb="Guardar"
              busy={saving}
              onSave={saveBatch}
              onRemove={batch.remove}
              onClear={clearBatch}
              openRoll={(r) => r?.id && openRoll(r)}
            />
          )}

          {/* Rolls in the active container */}
          {box && f.step === 3 && (
            <Card className="overflow-hidden">
              <CardHeader title={`Rollos en ${box.code}`} subtitle={`${inBox.filter((r) => r.status === "in_stock").length} guardados · ${inBox.filter((r) => r.status === "assigned").length} reservados por llegar${session.length ? ` · ${session.length} en esta sesión` : ""}`} />
              {inBox.length === 0 ? (
                <EmptyState icon={Boxes} title={`${box.code} está vacío`} text="Escanee los rollos que guarda aquí." />
              ) : (
                <ul className="divide-y divide-slate-100 max-h-[45vh] overflow-y-auto">
                  {inBox.map((r) => {
                    const mine = session.some((s) => s.id === r.id);
                    return (
                      <li key={r.id} className={cx("px-4 sm:px-5 py-2.5 flex items-center gap-3", mine && "bg-emerald-50/60")}>
                        <button onClick={() => openRoll(r)} className="min-w-0 flex-1 text-left">
                          <div className="font-mono text-sm font-semibold text-slate-900 truncate">{r.roll_no}</div>
                          <div className="text-xs text-slate-500 truncate">
                            {[r.fabric_name, r.color].filter(Boolean).join(" · ") || "Sin datos de Skytex"}
                            {r.received_at && <> · {fmtTime(r.received_at)}</>}
                          </div>
                        </button>
                        {r.status === "assigned" && <Pill tone="amber">Reservado</Pill>}
                        {r.source === "scan" && <Pill tone="slate">Sin solicitud</Pill>}
                        <span className="text-sm text-slate-600 fab-tnum w-16 text-right">{num(r.yards, 1)}</span>
                        {mine && (
                          <button onClick={() => undo(r)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50" aria-label={`Deshacer ${r.roll_no}`}>
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}

          {/* Today */}
          <Card className="overflow-hidden">
            <CardHeader title="Recibidos hoy" subtitle={`${received.length} rollo(s) · ${num(received.reduce((s, r) => s + (Number(r.yards) || 0), 0), 1)} yd`} />
            {received.length === 0 ? (
              <EmptyState icon={PackageCheck} title="Aún no se recibe ningún rollo hoy" />
            ) : (
              <ul className="divide-y divide-slate-100 max-h-[40vh] overflow-y-auto">
                {received.slice(0, 200).map((r) => (
                  <li key={r.movement_id} className="px-4 sm:px-5 py-2.5 flex items-center gap-3 text-sm cursor-pointer hover:bg-slate-50" onClick={() => openRoll({ ...r, id: r.roll_id })}>
                    <span className="text-slate-400 fab-tnum w-12">{fmtTime(r.moved_at)}</span>
                    <span className="font-mono font-medium text-slate-900 truncate flex-1">{r.roll_no}</span>
                    <span className="font-semibold text-slate-700">{locationText(r)}</span>
                    <span className="text-slate-500 fab-tnum w-16 text-right">{num(r.yards, 1)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Expected arrivals */}
        <Card className="xl:col-span-4 min-w-0 xl:sticky xl:top-20 overflow-hidden">
          <CardHeader title="Llegadas por PO" subtitle={`${pending.length} rollo(s) solicitados por recibir`} />
          {poRows.length === 0 ? (
            <EmptyState icon={Truck} title="No hay rollos solicitados en camino" />
          ) : (
            <ul className="divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
              {poRows.map((p) => {
                const total = p.received + p.pending.length;
                const open = openPo === p.po;
                return (
                  <li key={p.po}>
                    <button onClick={() => setOpenPo(open ? null : p.po)} className="w-full text-left px-5 py-3 hover:bg-slate-50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-semibold text-slate-900">{p.po}</span>
                        <span className="text-xs text-slate-500 fab-tnum">{p.received}/{total}</span>
                        <ChevronDown className={cx("w-4 h-4 text-slate-400 transition-transform", open && "rotate-180")} />
                      </div>
                      <ProgressBar value={p.received} max={total} tone={p.pending.length ? "indigo" : "emerald"} className="h-1.5 mt-2" />
                      <div className="text-xs text-slate-500 mt-1">{p.pending.length ? `Faltan ${p.pending.length} · ${num(p.yards, 1)} yd` : "Completo hoy"}</div>
                    </button>
                    {open && p.pending.length > 0 && (
                      <ul className="px-5 pb-3 space-y-1">
                        {p.pending.map((r) => (
                          <li key={r.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-2.5 py-1.5">
                            <span className="font-mono text-slate-800">{r.roll_no}</span>
                            <span className="text-slate-500">{r.box_code ? `${r.box_code} · ${r.location_code}` : r.location_code || "En Skytex"}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}