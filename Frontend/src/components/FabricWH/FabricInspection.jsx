// components/FabricWH/FabricInspection.jsx
// Almacén de Tela — Inspección.
//   Enviar        Lugar (A01) → contenedor (F01) → rollos → confirmar «Enviar».
//                 PDA: one narrow column with the send button fixed at the bottom.
//                 Desktop (lg+): scanner on the left, scanned rolls table on the right.
//   En inspección Rolls that are with the inspection team right now.
// Scanning another location at any time switches container; rolls already
// scanned stay in the list until they are sent.
import { useState, useEffect, useCallback, useMemo } from "react";
import { MapPin, Package, Layers, Send, X, RotateCcw, Microscope, RefreshCw } from "lucide-react";
import {
  api, post, num, cx, beep, Card, Button, PageHeader, SegTabs, SearchInput, ScanBox, EmptyState,
  locationText, timeAgo, useToast, useConfirm, notifyChange,
} from "./fabricShared";

export default function FabricInspection() {
  const [view, setView] = useState("send");
  const [atInspection, setAtInspection] = useState(null);

  const refreshCount = useCallback(async () => {
    try {
      const d = await api("/rolls?status=at_inspection&limit=2000");
      setAtInspection((d.rolls || []).length);
    } catch { /* the count is optional */ }
  }, []);
  useEffect(() => { refreshCount(); }, [refreshCount, view]);

  return (
    <div className="space-y-4 lg:space-y-6">
      <PageHeader
        title="Inspección de tela"
        subtitle="Escanee lugar → contenedor → rollos y envíelos al equipo de inspección."
        actions={
          <SegTabs
            value={view}
            onChange={setView}
            tabs={[
              { key: "send", label: "Enviar", icon: Send },
              { key: "at", label: "En inspección", icon: Microscope, count: atInspection },
            ]}
          />
        }
      />
      {view === "send" && <SendByScan onSent={refreshCount} />}
      {view === "at" && <AtInspection />}
    </div>
  );
}

// --- Send: scan location → container → rolls ------------------------------
const STEPS = [
  { key: "location", label: "Lugar", icon: MapPin },
  { key: "box", label: "Contenedor", icon: Package },
  { key: "roll", label: "Rollos", icon: Layers },
];
const PROMPT = { location: "Escanee el lugar…", box: "Escanee el contenedor…", roll: "Escanee los rollos…" };

function SendByScan({ onSent }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [location, setLocation] = useState(null);
  const [box, setBox] = useState(null);
  const [rolls, setRolls] = useState([]);   // newest first
  const [msg, setMsg] = useState(null);     // { kind: ok|dup|err, text }
  const [busy, setBusy] = useState(false);

  const step = !location ? "location" : !box ? "box" : "roll";
  const idx = STEPS.findIndex((s) => s.key === step);
  const yards = rolls.reduce((s, r) => s + (Number(r.yards) || 0), 0);

  const say = (kind, text) => { beep(kind); setMsg({ kind, text }); };

  const onScan = async (raw) => {
    if (busy) return;
    try {
      const d = await post("/inspection/scan", { raw, step, locationId: location?.id, boxId: box?.id });
      if (d.kind === "location") {
        setLocation(d.location); setBox(null);
        say("ok", `Lugar ${d.location.code}. Ahora escanee el contenedor.`);
      } else if (d.kind === "box") {
        setBox(d.box);
        say("ok", `Contenedor ${d.box.code}. Ahora escanee los rollos.`);
      } else if (d.kind === "roll") {
        const r = d.roll;
        if (rolls.some((x) => String(x.id) === String(r.id))) { say("dup", `${r.roll_no} ya estaba escaneado`); return; }
        setRolls((list) => [r, ...list]);
        say("ok", `${r.roll_no} agregado`);
      }
    } catch (e) { say("err", e.message); }
  };

  const restart = () => { setLocation(null); setBox(null); setMsg(null); };
  const remove = (id) => setRolls((list) => list.filter((r) => r.id !== id));
  const clearAll = async () => {
    if (await confirm({ title: `¿Quitar los ${rolls.length} rollo(s) escaneados?`, confirmLabel: "Quitar", cancelLabel: "Volver", danger: true })) setRolls([]);
  };

  const send = async () => {
    if (!rolls.length) return;
    if (!(await confirm({ title: `¿Enviar ${rolls.length} rollo(s) a inspección?`, text: `${num(yards, 1)} yd en total.`, confirmLabel: "Enviar" }))) return;
    setBusy(true);
    try {
      const d = await post("/rolls/send-to-inspection", { ids: rolls.map((r) => r.id) });
      toast({ kind: "ok", title: `${d.sent} rollo(s) enviados a inspección` });
      setRolls([]); restart();
      notifyChange(); onSent();
    } catch (e) { say("err", e.message); }
    finally { setBusy(false); }
  };

  const sendLabel = `Enviar ${rolls.length || ""} rollo(s) a inspección`;

  return (
    <div className="max-w-xl mx-auto lg:max-w-none grid lg:grid-cols-12 gap-4 lg:gap-6 items-start pb-24 lg:pb-0">
      {/* Scanner column */}
      <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-4">
        <div className="grid grid-cols-3 gap-2">
          {STEPS.map((s, i) => {
            const done = i < idx;
            const on = i === idx;
            const value = s.key === "location" ? location?.code : s.key === "box" ? box?.code : rolls.length || null;
            return (
              <div key={s.key} className={cx("rounded-xl px-3 py-2.5 ring-1 text-center",
                on ? "bg-indigo-50 ring-2 ring-indigo-500" : done ? "bg-emerald-50 ring-emerald-200" : "bg-white ring-slate-200")}>
                <s.icon className={cx("w-5 h-5 mx-auto", on ? "text-indigo-600" : done ? "text-emerald-600" : "text-slate-300")} />
                <div className="text-[11px] text-slate-500 mt-1">{i + 1}. {s.label}</div>
                <div className="font-mono font-bold text-lg text-slate-900 leading-tight min-h-[1.5rem]">{value ?? "—"}</div>
              </div>
            );
          })}
        </div>

        <Card className="p-4 space-y-3">
          <ScanBox onScan={onScan} placeholder={PROMPT[step]} />
          {msg && (
            <div className={cx("rounded-lg px-3 py-2.5 text-base font-semibold",
              msg.kind === "ok" ? "bg-emerald-50 text-emerald-800" : msg.kind === "dup" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700")}>
              {msg.text}
            </div>
          )}
          {location && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={restart}>Cambiar lugar</Button>}
        </Card>

        {/* Desktop: send button inline under the scanner */}
        <Button icon={Send} className="hidden lg:flex w-full justify-center py-3 text-base" disabled={!rolls.length} loading={busy} onClick={send}>
          {sendLabel}
        </Button>
      </div>

      {/* Scanned rolls */}
      <Card className="lg:col-span-7 overflow-hidden">
        <div className="px-4 lg:px-5 py-3 border-b border-slate-100 flex items-center gap-3">
          <span className="font-semibold text-slate-800">Rollos escaneados</span>
          <span className="ml-auto text-sm text-slate-500 fab-tnum">{rolls.length} · {num(yards, 1)} yd</span>
          {rolls.length > 0 && <Button size="sm" variant="ghost" icon={X} className="hidden lg:inline-flex" onClick={clearAll}>Quitar todos</Button>}
        </div>
        {!rolls.length ? (
          <EmptyState icon={Layers} title="Sin rollos" text="Escanee el lugar, el contenedor y después los rollos." />
        ) : (
          <>
            {/* PDA: compact list */}
            <ul className="lg:hidden divide-y divide-slate-100">
              {rolls.map((r) => (
                <li key={r.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono font-semibold text-slate-900">{r.roll_no}</div>
                    <div className="text-xs text-slate-500 truncate">{locationText(r)} · {r.fabric_name || "—"} · {r.color || "—"}</div>
                  </div>
                  <div className="text-sm fab-tnum text-slate-600">{num(r.yards, 1)} yd</div>
                  <RemoveBtn roll={r} onClick={() => remove(r.id)} />
                </li>
              ))}
            </ul>
            {/* Desktop: table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    <Th>Rollo</Th><Th>Tela</Th><Th>Lote</Th><Th>PO</Th><Th>Contenedor · lugar</Th><Th right>Yardas</Th><Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rolls.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <Td mono>{r.roll_no}</Td>
                      <Td>{r.fabric_name || "—"} <span className="text-slate-400">· {r.color || "—"}</span></Td>
                      <Td>{r.lot || "—"}</Td>
                      <Td>{r.po_number || "—"}</Td>
                      <Td>{locationText(r)}</Td>
                      <Td right>{num(r.yards, 1)}</Td>
                      <td className="px-3 py-2 text-right"><RemoveBtn roll={r} onClick={() => remove(r.id)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* PDA: send button fixed at the bottom */}
      <div className="lg:hidden fixed inset-x-0 bottom-0 z-20 bg-white/95 backdrop-blur border-t border-slate-200 p-3"
           style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}>
        <Button icon={Send} className="w-full justify-center py-3 text-base" disabled={!rolls.length} loading={busy} onClick={send}>
          {sendLabel}
        </Button>
      </div>
    </div>
  );
}

// --- Rolls currently with the inspection team -------------------------------
function AtInspection() {
  const toast = useToast();
  const [rolls, setRolls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api("/rolls?status=at_inspection&limit=2000");
      const list = d.rolls || [];
      list.sort((a, b) => String(b.out_at || "").localeCompare(String(a.out_at || "")));
      setRolls(list);
    } catch (e) { toast({ kind: "err", text: e.message }); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rolls;
    return rolls.filter((r) => [r.roll_no, r.po_number, r.supplier, r.fabric_name, r.color, r.lot, r.box_code, r.location_code]
      .some((v) => String(v ?? "").toLowerCase().includes(t)));
  }, [rolls, q]);
  const yards = shown.reduce((s, r) => s + (Number(r.yards) || 0), 0);

  return (
    <Card className="overflow-hidden">
      <div className="px-4 lg:px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
        <span className="font-semibold text-slate-800">Rollos en inspección</span>
        <span className="text-sm text-slate-500 fab-tnum">{shown.length} · {num(yards, 1)} yd</span>
        <div className="ml-auto flex items-center gap-2 w-full sm:w-auto">
          <SearchInput value={q} onChange={setQ} placeholder="Rollo, tela, lote, PO…" className="flex-1 sm:w-72" />
          <Button size="sm" variant="ghost" icon={RefreshCw} loading={loading} onClick={load}>Actualizar</Button>
        </div>
      </div>
      {!loading && !shown.length ? (
        <EmptyState icon={Microscope} title={q ? "Sin resultados" : "No hay rollos en inspección"} />
      ) : (
        <>
          {/* PDA: compact list */}
          <ul className="lg:hidden divide-y divide-slate-100">
            {shown.map((r) => (
              <li key={r.id} className="px-4 py-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-mono font-semibold text-slate-900">{r.roll_no}</div>
                  <div className="text-xs text-slate-500 truncate">{locationText(r)} · {r.fabric_name || "—"} · {r.color || "—"}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm fab-tnum text-slate-600">{num(r.yards, 1)} yd</div>
                  <div className="text-[11px] text-slate-400">{timeAgo(r.out_at)}</div>
                </div>
              </li>
            ))}
          </ul>
          {/* Desktop: table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <Th>Rollo</Th><Th>Tela</Th><Th>Lote</Th><Th>PO</Th><Th>Proveedor</Th><Th>Contenedor original</Th><Th right>Yardas</Th><Th>Enviado</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <Td mono>{r.roll_no}</Td>
                    <Td>{r.fabric_name || "—"} <span className="text-slate-400">· {r.color || "—"}</span></Td>
                    <Td>{r.lot || "—"}</Td>
                    <Td>{r.po_number || "—"}</Td>
                    <Td>{r.supplier || "—"}</Td>
                    <Td>{locationText(r)}</Td>
                    <Td right>{num(r.yards, 1)}</Td>
                    <Td><span title={r.out_at || ""}>{timeAgo(r.out_at)}</span></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

// --- small bits -------------------------------------------------------------
const Th = ({ children, right }) => (
  <th className={cx("px-3 py-2 font-medium whitespace-nowrap", right ? "text-right" : "text-left")}>{children}</th>
);
const Td = ({ children, right, mono }) => (
  <td className={cx("px-3 py-2.5 whitespace-nowrap text-slate-700", right && "text-right fab-tnum", mono && "font-mono font-semibold text-slate-900")}>{children}</td>
);
const RemoveBtn = ({ roll, onClick }) => (
  <button onClick={onClick} className="p-2 -mr-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50" aria-label={`Quitar ${roll.roll_no}`} title="Quitar">
    <X className="w-5 h-5" />
  </button>
);