// components/FabricWH/FabricReceiveScan.jsx
// Almacén de Tela — Recepción en tres secciones (PDA).
//
//   1. Escanear rollos        Scan every roll that arrived: rolls on the Skytex
//                             list are checked off it; any other roll is accepted
//                             with «Aceptar rollos sin solicitud». Each scan is
//                             saved right away (status «arrived»).
//                             «Cargar Excel / CSV» adds the rolls of a file to the
//                             same list first (FabricRollsUpload), then they are
//                             scanned as usual. Their labels (supplier format,
//                             QR + Code 128) are printed with FabricLabelPrint.
//   2. Asignar a contenedor   Select scanned rolls (tap or scan them), scan the
//                             container (F33) and then the spot where it is (A01),
//                             «Guardar N en F33» → in stock. When no container has
//                             room, «Mover al lugar temporal» with a written reason.
//   3. Lugar temporal         Rolls waiting in the temporary place, with their
//                             reason. Same container + spot scan to store them.
//
// Backend: GET /reception, POST /reception/arrive, /reception/import, /reception/identify,
// /rolls/put-away, /rolls/to-temporary, /rolls/:id/undo-arrival.
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  RefreshCw, RotateCcw, CheckCircle2, AlertCircle, AlertTriangle, ChevronDown,
  PackageCheck, Truck, Boxes, MapPin, Box, Clock, Check, Search, X, ArrowRight, FileSpreadsheet, Printer,
} from "lucide-react";
import {
  api, post, num, cx, beep, vibrate, Card, CardHeader, Button, PageHeader,
  ProgressBar, EmptyState, Pill, todayStr, fmtTime, useToast, useConfirm, useRollDrawer, notifyChange,
} from "./fabricShared";
import FabricRollsUpload from "./FabricRollsUpload";
import FabricLabelPrint from "./FabricLabelPrint";

const UNREQ_KEY = "fabricAllowUnrequested";
const TAB_KEY = "fabricReceptionTab";
const EMPTY = { expected: [], arrived: [], temporary: [], today: [], space: { placed: 0, withRoom: 0, free: 0, boxes: [] }, places: [], maxPutAway: 500 };

const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const sumYards = (rows) => rows.reduce((s, r) => s + (Number(r.yards) || 0), 0);
const rollLine = (r) => [r.fabric_name, r.color, r.po_number && `PO ${r.po_number}`].filter(Boolean).join(" · ") || "Datos de Skytex pendientes";
const daysSince = (ts) => (ts ? Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)) : null);
const sinceText = (ts) => {
  const d = daysSince(ts);
  if (d == null) return "";
  return d === 0 ? `hoy ${fmtTime(ts)}` : d === 1 ? "ayer" : `hace ${d} días`;
};
// Free room in a container: the same count the backend uses (stored + reserved).
const freeIn = (b) => (b?.capacity == null ? null : Math.max(0, Number(b.capacity) - Number(b.stored || 0) - Number(b.reserved || 0)));

export default function FabricReceiveScan({ onNavigate = () => {} }) {
  const toast = useToast();
  const [tab, setTab] = useState(() => store.get(TAB_KEY, "scan"));
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  // Spot + container chosen in sections 2 and 3 (kept when switching between them).
  const [target, setTarget] = useState({ spot: null, box: null });

  useEffect(() => { store.set(TAB_KEY, tab); }, [tab]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const d = await api(`/reception?date=${todayStr()}`);
      setData({ ...EMPTY, ...d, space: { ...EMPTY.space, ...(d.space || {}) } });
    } catch (e) { toast({ kind: "err", text: e.message }); }
    finally { if (!quiet) setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const tabs = [
    { key: "scan", n: 1, label: "Escanear rollos", count: data.today.length, hint: "escaneados hoy" },
    { key: "assign", n: 2, label: "Asignar a contenedor", count: data.arrived.length, hint: "esperan contenedor" },
    { key: "temporary", n: 3, label: "Lugar temporal", count: data.temporary.length, hint: "en lugar temporal" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Recepción de rollos"
        subtitle="Escanee los rollos que llegaron, guárdelos en un contenedor y, si no hay espacio, déjelos en el lugar temporal con el motivo."
        actions={<Button variant="secondary" icon={RefreshCw} loading={loading} onClick={() => load()}>Actualizar</Button>}
      />

      <div role="tablist" aria-label="Secciones de recepción" className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
        {tabs.map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={cx(
                "rounded-xl px-2 sm:px-4 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                on ? "bg-white shadow-sm" : "hover:bg-white/60"
              )}
            >
              <div className="flex items-center gap-2">
                <span className={cx("w-6 h-6 shrink-0 rounded-full text-xs font-semibold flex items-center justify-center",
                  on ? "bg-indigo-600 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200")}>{t.n}</span>
                <span className={cx("text-sm font-semibold truncate", on ? "text-slate-900" : "text-slate-600")}>{t.label}</span>
                {t.count > 0 && (
                  <span className={cx("ml-auto text-xs font-semibold rounded-full px-2 py-0.5 fab-tnum",
                    t.key === "temporary" ? "bg-amber-100 text-amber-800" : t.key === "assign" ? "bg-indigo-100 text-indigo-700" : "bg-slate-200 text-slate-700")}>
                    {t.count}
                  </span>
                )}
              </div>
              <div className="hidden sm:block text-xs text-slate-500 mt-0.5 pl-8">{t.count} {t.hint}</div>
            </button>
          );
        })}
      </div>

      {tab === "scan" && (
        <ArrivalSection data={data} setData={setData} reload={() => load(true)} onNavigate={onNavigate} goAssign={() => setTab("assign")} />
      )}
      {tab === "assign" && (
        <PutAwaySection key="assign" mode="arrived" rolls={data.arrived} data={data} setData={setData}
          reload={() => load(true)} target={target} setTarget={setTarget} goScan={() => setTab("scan")} goTemporary={() => setTab("temporary")} />
      )}
      {tab === "temporary" && (
        <PutAwaySection key="temporary" mode="temporary" rolls={data.temporary} data={data} setData={setData}
          reload={() => load(true)} target={target} setTarget={setTarget} goScan={() => setTab("scan")} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One input for the PDA. Scanners type fast and press Enter; codes that come in
// while the previous one is still being checked wait in a queue (none is lost).
// ---------------------------------------------------------------------------
function ScanInput({ onScan, placeholder, label, autoFocus = true, inputRef: extRef }) {
  const own = useRef(null);
  const ref = extRef || own;
  const [v, setV] = useState("");
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const queue = useRef([]);
  const running = useRef(false);
  const latest = useRef(onScan);
  latest.current = onScan;

  const pump = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    while (queue.current.length) {
      const raw = queue.current.shift();
      try { await latest.current(raw); } catch { /* the handler shows its own errors */ }
    }
    running.current = false;
    setBusy(false);
  };
  const submit = () => {
    const raw = v.trim();
    if (!raw) return;
    setV("");
    queue.current.push(raw);
    pump();
    ref.current?.focus();
  };

  return (
    <div>
      {label && <div className="text-xs font-medium text-slate-500 mb-1.5">{label}</div>}
      <div className="flex gap-2">
        <label className={cx("flex-1 min-w-0 flex items-center gap-3 rounded-xl border-2 bg-white px-4 h-14 cursor-text",
          focused ? "border-indigo-500" : "border-slate-200")}>
          <span className={cx("w-2.5 h-2.5 rounded-full shrink-0", focused ? "bg-emerald-500" : "bg-amber-400")} aria-hidden="true" />
          <input
            ref={ref}
            autoFocus={autoFocus}
            value={v}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            aria-label={label || placeholder}
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            className="flex-1 min-w-0 bg-transparent text-lg outline-none placeholder:text-slate-400"
          />
          {!focused && <span className="hidden sm:inline text-xs text-amber-700 shrink-0">Toque aquí para escanear</span>}
        </label>
        <button
          onClick={submit}
          disabled={!v.trim()}
          className="h-14 px-5 rounded-xl bg-indigo-600 text-white font-semibold disabled:bg-indigo-300 hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          {busy ? "…" : "Registrar"}
        </button>
      </div>
    </div>
  );
}

// Result of the last scan or save, big enough to read at arm's length.
function ResultBanner({ r, children }) {
  if (!r) return null;
  const tone = {
    ok: "bg-indigo-600 text-white",
    saved: "bg-emerald-600 text-white",
    info: "bg-slate-800 text-white",
    dup: "bg-amber-100 text-amber-900 ring-1 ring-amber-300",
    err: "bg-red-600 text-white",
  }[r.kind];
  const Icon = r.kind === "err" ? AlertCircle : r.kind === "dup" ? AlertTriangle : CheckCircle2;
  return (
    <div key={r.n} role="status" aria-live="assertive" className={cx("rounded-2xl p-4 sm:p-5 fab-pop", tone)}>
      <div className="flex items-start gap-3">
        <Icon className="w-6 h-6 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          {r.label && <div className="text-sm font-medium opacity-90">{r.label}</div>}
          {r.big && <div className="font-mono text-2xl sm:text-3xl font-bold break-all leading-tight">{r.big}</div>}
          {r.title && <div className="text-lg font-semibold leading-snug">{r.title}</div>}
          {r.text && <div className="text-sm opacity-90 mt-0.5">{r.text}</div>}
          {children}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ r }) {
  if (r.status === "arrived") return <Pill tone="indigo">Por asignar</Pill>;
  if (r.status === "temporary") return <Pill tone="amber">Temporal</Pill>;
  if (r.status === "in_stock") return <Pill tone="emerald">{r.box_code ? `En ${r.box_code}` : "Guardado"}</Pill>;
  if (r.status === "at_inspection") return <Pill tone="violet">En inspección</Pill>;
  if (r.status === "returned") return <Pill tone="slate">Devuelto</Pill>;
  if (r.status === "requested" || r.status === "assigned") return <Pill tone="slate">Por llegar</Pill>;
  return <Pill tone="slate">{r.status}</Pill>;
}

// ===========================================================================
// 1. Escanear rollos
// ===========================================================================
function ArrivalSection({ data, setData, reload, onNavigate, goAssign }) {
  const confirm = useConfirm();
  const toast = useToast();
  const openRoll = useRollDrawer();
  const [allowUnrequested, setAllowUnrequested] = useState(() => store.get(UNREQ_KEY, "1") !== "0");
  const [result, setResult] = useState(null);
  const [openPo, setOpenPo] = useState(null);
  const [q, setQ] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [lastUpload, setLastUpload] = useState([]);  // rolls of the last file, for their labels
  const [labels, setLabels] = useState(null);        // { rolls, preselect, title } while printing
  const openLabels = (rolls, preselect = null, title) => setLabels({ rolls, preselect, title });
  const uploadLabels = () => openLabels(lastUpload, lastUpload.map((r) => r.id), `Etiquetas · ${lastUpload.length} rollo(s) del archivo`);
  useEffect(() => { store.set(UNREQ_KEY, allowUnrequested ? "1" : "0"); }, [allowUnrequested]);

  const uploaded = (d) => {
    const s = d.saved || {};
    const parts = [
      s.new && `${s.new} nuevo(s)`,
      (s.update || s.rerequest) && `${(s.update || 0) + (s.rerequest || 0)} ya estaban en la lista`,
      s.link && `${s.link} escaneado(s) sin solicitud completados`,
      s.received && `${s.received} ya recibido(s)`,
      d.errorCount && `${d.errorCount} renglón(es) con error no se cargaron`,
    ].filter(Boolean);
    beep("ok");
    setLastUpload(d.rolls || []);
    setResult({
      n: Date.now(), kind: "saved", upload: (d.rolls || []).length,
      label: `Archivo ${d.fileName}`,
      title: `${(d.onList || 0)} rollo(s) en la lista por llegar`,
      text: `${parts.join(" · ")}. Ahora escanee cada rollo conforme llegue.`,
    });
    reload();
  };

  const arrivedLocally = (roll) => setData((d) => ({
    ...d,
    expected: d.expected.filter((x) => x.id !== roll.id),
    arrived: [roll, ...d.arrived.filter((x) => x.id !== roll.id)],
    today: [roll, ...d.today.filter((x) => x.id !== roll.id)],
  }));

  const arrive = async (raw, force = false) => {
    const n = Date.now();
    try {
      const d = await post("/reception/arrive", { raw, allowUnrequested: force || allowUnrequested });
      if (d.duplicate) {
        beep("dup"); vibrate([80, 60, 80]);
        setResult({ n, kind: "dup", big: d.roll?.roll_no, text: d.message });
        return;
      }
      beep("ok"); vibrate(40);
      arrivedLocally(d.roll);
      setResult({
        n, kind: "ok", big: d.roll.roll_no,
        label: d.unrequested ? "Registrado sin solicitud a Skytex" : "Llegó · marcado en la lista de Skytex",
        text: `${rollLine(d.roll)}${d.roll.yards != null ? ` · ${num(d.roll.yards, 1)} yd` : ""}${d.reservedIn ? ` · estaba reservado en ${d.reservedIn}` : ""}`,
      });
      notifyChange();
    } catch (e) {
      beep("err"); vibrate([200, 100, 200]);
      setResult({ n, kind: "err", title: e.message, code: e.data?.code, raw });
    }
  };

  const undo = async (r) => {
    const ok = await confirm({
      title: `¿Deshacer el escaneo de ${r.roll_no}?`,
      text: r.source === "scan" ? "El rollo se quita de la recepción." : "El rollo vuelve a la lista de Skytex como «por llegar».",
      confirmLabel: "Deshacer", danger: true,
    });
    if (!ok) return;
    try {
      await post(`/rolls/${r.id}/undo-arrival`);
      toast({ kind: "info", text: `Escaneo de ${r.roll_no} deshecho.` });
      setResult(null);
      notifyChange();
      reload();
    } catch (e) { toast({ kind: "err", text: e.message }); }
  };

  // The Skytex list by PO: scanned today vs. still on the way.
  const poRows = useMemo(() => {
    const m = new Map();
    const get = (k) => { if (!m.has(k)) m.set(k, { po: k, scanned: [], pending: [], yards: 0 }); return m.get(k); };
    for (const r of data.today) if (r.source !== "scan") get(r.po_number || "Sin PO").scanned.push(r);
    for (const r of data.expected) { const c = get(r.po_number || "Sin PO"); c.pending.push(r); c.yards += Number(r.yards) || 0; }
    const t = q.trim().toLowerCase();
    return [...m.values()]
      .filter((p) => !t || p.po.toLowerCase().includes(t) || [...p.scanned, ...p.pending].some((r) => String(r.roll_no).toLowerCase().includes(t)))
      .sort((a, b) => (b.scanned.length > 0) - (a.scanned.length > 0) || b.pending.length - a.pending.length);
  }, [data.today, data.expected, q]);
  const unrequestedToday = data.today.filter((r) => r.source === "scan");

  return (
    <div className="grid xl:grid-cols-12 gap-5 items-start">
      <div className="xl:col-span-7 space-y-5 min-w-0">
        <Card className="p-4 sm:p-5 space-y-3">
          <ScanInput onScan={(raw) => arrive(raw)} label="Escanee cada rollo que llegó" placeholder="Código del rollo (21521211082608)…" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="inline-flex items-center gap-2 text-sm text-slate-600 mr-auto">
              <input type="checkbox" className="rounded border-slate-300 text-indigo-600" checked={allowUnrequested} onChange={(e) => setAllowUnrequested(e.target.checked)} />
              Aceptar rollos que no están en la lista de Skytex
            </label>
            <Button size="sm" variant="secondary" icon={FileSpreadsheet} onClick={() => setUploadOpen(true)}>Cargar Excel / CSV</Button>
          </div>
        </Card>

        <FabricRollsUpload open={uploadOpen} onClose={() => setUploadOpen(false)} onDone={uploaded} />
        <FabricLabelPrint open={!!labels} onClose={() => setLabels(null)} rolls={labels?.rolls || []} preselect={labels?.preselect || null} title={labels?.title} />

        <ResultBanner r={result}>
          {result?.upload > 0 && lastUpload.length > 0 && (
            <div className="mt-3">
              <Button size="sm" variant="secondary" icon={Printer} onClick={uploadLabels}>Imprimir etiquetas ({lastUpload.length})</Button>
            </div>
          )}
          {result?.kind === "err" && result.code === "not_requested" && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => arrive(result.raw, true)}>Registrar sin solicitud</Button>
              <Button size="sm" variant="onDark" onClick={() => onNavigate("solicitar")}>Ir a Solicitar a Skytex</Button>
            </div>
          )}
        </ResultBanner>

        {data.arrived.length > 0 && (
          <div className="rounded-2xl bg-indigo-50 ring-1 ring-indigo-200 p-4 flex flex-wrap items-center gap-3">
            <Boxes className="w-5 h-5 text-indigo-600 shrink-0" />
            <div className="flex-1 min-w-[12rem] text-sm text-indigo-900">
              <span className="font-semibold">{data.arrived.length} rollo(s) esperan contenedor</span>
              <span className="text-indigo-700"> · {num(sumYards(data.arrived), 1)} yd</span>
            </div>
            <Button icon={ArrowRight} onClick={goAssign}>Asignar a contenedor</Button>
          </div>
        )}

        <Card className="overflow-hidden">
          <CardHeader title="Escaneados hoy" subtitle={`${data.today.length} rollo(s) · ${num(sumYards(data.today), 1)} yd`} />
          {data.today.length === 0 ? (
            <EmptyState icon={PackageCheck} title="Aún no se escanea ningún rollo hoy" text="Escanee el primer rollo del camión para empezar." />
          ) : (
            <ul className="divide-y divide-slate-100 max-h-[50vh] overflow-y-auto">
              {data.today.map((r) => (
                <li key={r.id} className="px-4 sm:px-5 py-2.5 flex items-center gap-3">
                  <span className="text-xs text-slate-400 fab-tnum w-11 shrink-0">{fmtTime(r.arrived_at)}</span>
                  <button onClick={() => openRoll(r)} className="min-w-0 flex-1 text-left">
                    <div className="font-mono text-sm font-semibold text-slate-900 truncate">{r.roll_no}</div>
                    <div className="text-xs text-slate-500 truncate">{rollLine(r)}</div>
                  </button>
                  {r.source === "scan" && <Pill tone="slate">Sin solicitud</Pill>}
                  <StatusPill r={r} />
                  <span className="hidden sm:inline text-sm text-slate-600 fab-tnum w-14 text-right">{num(r.yards, 1)}</span>
                  {r.status === "arrived" ? (
                    <button onClick={() => undo(r)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50" aria-label={`Deshacer ${r.roll_no}`}>
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  ) : <span className="w-7" />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* The list Skytex sent */}
      <Card className="xl:col-span-5 min-w-0 xl:sticky xl:top-20 overflow-hidden">
        <CardHeader title="Lista de Skytex" subtitle={`${data.expected.length} rollo(s) por llegar · ${data.today.length - unrequestedToday.length} marcados hoy`}
          actions={(data.expected.length > 0 || data.arrived.length > 0) && (
            <Button size="sm" variant="secondary" icon={Printer}
              onClick={() => openLabels([...data.expected, ...data.arrived, ...data.temporary], null, "Imprimir etiquetas")}>
              Etiquetas
            </Button>
          )} />
        <div className="px-4 sm:px-5 pb-3">
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 h-9">
            <Search className="w-4 h-4 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar PO o rollo" aria-label="Buscar PO o rollo"
              className="flex-1 min-w-0 bg-transparent text-sm outline-none" />
            {q && <button onClick={() => setQ("")} aria-label="Borrar búsqueda" className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>}
          </div>
        </div>
        {poRows.length === 0 && unrequestedToday.length === 0 ? (
          <EmptyState icon={Truck} title={q ? "Ninguna PO coincide" : "No hay rollos de Skytex en camino"}
            text={q ? undefined : "Si la lista llegó en un archivo, cárguela para marcar cada rollo al escanearlo."}
            action={!q && <Button size="sm" variant="secondary" icon={FileSpreadsheet} onClick={() => setUploadOpen(true)}>Cargar Excel / CSV</Button>} />
        ) : (
          <ul className="divide-y divide-slate-100 max-h-[65vh] overflow-y-auto border-t border-slate-100">
            {poRows.map((p) => {
              const total = p.scanned.length + p.pending.length;
              const open = openPo === p.po;
              return (
                <li key={p.po}>
                  <button onClick={() => setOpenPo(open ? null : p.po)} aria-expanded={open} className="w-full text-left px-5 py-3 hover:bg-slate-50">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-slate-900 flex-1 truncate">{p.po}</span>
                      <span className="text-xs text-slate-500 fab-tnum">{p.scanned.length}/{total}</span>
                      <ChevronDown className={cx("w-4 h-4 text-slate-400 transition-transform", open && "rotate-180")} />
                    </div>
                    <ProgressBar value={p.scanned.length} max={total} tone={p.pending.length ? "indigo" : "emerald"} className="h-1.5 mt-2" />
                    <div className="text-xs text-slate-500 mt-1">{p.pending.length ? `Faltan ${p.pending.length} · ${num(p.yards, 1)} yd` : "Completa"}</div>
                  </button>
                  {open && p.pending.length > 0 && (
                    <div className="px-5 pb-2">
                      <button onClick={() => openLabels([...p.pending, ...p.scanned], p.pending.map((r) => r.id), `Etiquetas · PO ${p.po}`)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline">
                        <Printer className="w-3.5 h-3.5" /> Imprimir etiquetas de los {p.pending.length} por llegar
                      </button>
                    </div>
                  )}
                  {open && (
                    <ul className="px-5 pb-3 space-y-1">
                      {[...p.scanned, ...p.pending].map((r) => {
                        const got = r.status !== "requested" && r.status !== "assigned";
                        return (
                          <li key={r.id} className={cx("flex items-center gap-2 text-xs rounded-lg px-2.5 py-1.5", got ? "bg-emerald-50" : "bg-slate-50")}>
                            <span className={cx("w-4 h-4 rounded-full flex items-center justify-center shrink-0", got ? "bg-emerald-500 text-white" : "ring-1 ring-slate-300 bg-white")}>
                              {got && <Check className="w-3 h-3" />}
                            </span>
                            <span className={cx("font-mono flex-1 truncate", got ? "text-emerald-900" : "text-slate-800")}>{r.roll_no}</span>
                            <span className="text-slate-500 truncate">{got ? `Llegó ${fmtTime(r.arrived_at)}` : r.box_code ? `Reservado en ${r.box_code}` : "En camino"}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
            {unrequestedToday.length > 0 && !q && (
              <li className="px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900 flex-1">Sin solicitud a Skytex</span>
                  <span className="text-xs text-slate-500 fab-tnum">{unrequestedToday.length} hoy</span>
                </div>
                <div className="text-xs text-slate-500 mt-1">Se completan cuando se soliciten a Skytex.</div>
              </li>
            )}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ===========================================================================
// 2. Asignar a contenedor  /  3. Lugar temporal
// ===========================================================================
function PutAwaySection({ mode, rolls, data, setData, reload, target, setTarget, goScan, goTemporary }) {
  const confirm = useConfirm();
  const openRoll = useRollDrawer();
  const isTemp = mode === "temporary";
  const [selected, setSelected] = useState(() => new Set());
  const [q, setQ] = useState("");
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tempOpen, setTempOpen] = useState(false);
  const scanRef = useRef(null);
  const live = useRef({});
  live.current = { rolls, selected, target };

  const { spot, box } = target;
  const free = freeIn(box);
  const space = data.space;

  // Drop selected ids that are no longer in the list (saved elsewhere, reloaded…).
  useEffect(() => {
    setSelected((s) => {
      const ids = new Set(rolls.map((r) => r.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [rolls]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rolls;
    return rolls.filter((r) => [r.roll_no, r.po_number, r.fabric_name, r.color, r.temp_place, r.planned_box_code]
      .some((v) => String(v || "").toLowerCase().includes(t)));
  }, [rolls, q]);
  const chosen = rolls.filter((r) => selected.has(r.id));
  const allOn = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected((s) => {
    const n = new Set(s);
    if (allOn) filtered.forEach((r) => n.delete(r.id)); else filtered.forEach((r) => n.add(r.id));
    return n;
  });
  const say = (r) => setResult({ n: Date.now(), ...r });
  const fail = (text) => { beep("err"); vibrate([200, 100, 200]); say({ kind: "err", title: text }); };

  // Step 1: the container. Its spot is not trusted until step 2 confirms it.
  const pickBox = (b) => {
    beep("ok"); vibrate(40);
    setTarget({ box: b, spot: null });
    say({
      kind: "info", label: "Contenedor", big: b.code,
      text: b.location_code
        ? `Registrado en ${b.location_code}. Escanee el lugar donde está para confirmarlo.`
        : "No tiene lugar registrado. Escanee el lugar donde está.",
    });
    scanRef.current?.focus();
  };

  // Step 2: the spot where that container is.
  const pickSpot = async (loc) => {
    let b = live.current.target.box;
    if (!b) return fail("Escanee primero el contenedor (F33) y después el lugar donde está.");
    const cur = live.current.target.spot;
    if (cur) {
      if (String(cur.id) === String(loc.id)) { beep("dup"); return say({ kind: "dup", big: loc.code, text: `${b.code} ya está confirmado en ${loc.code}.` }); }
      return fail(`Para cambiar de lugar, escanee primero el contenedor y después su lugar.`);
    }
    if (String(b.location_id) !== String(loc.id)) {
      const others = loc.box_code && loc.box_code !== b.code ? ` ${loc.box_code}, que estaba registrado en ${loc.code}, queda sin lugar.` : "";
      const ok = await confirm({
        title: `¿${b.code} está en ${loc.code}?`,
        text: (b.location_code
          ? `El sistema tenía ${b.code} en ${b.location_code}. Se registra que se movió a ${loc.code} con sus rollos.`
          : `Se registra que ${b.code} está en ${loc.code}.`) + others,
        confirmLabel: `Sí, está en ${loc.code}`,
      });
      if (!ok) { scanRef.current?.focus(); return; }
      try {
        const d = await post("/boxes/place", { pairs: [{ locationId: loc.id, boxCode: b.code }], allowMove: true, displace: true });
        b = (d.boxes || []).find((x) => x && x.code === b.code) || b;
        notifyChange();
      } catch (e) { return fail(e.message); }
    }
    beep("ok"); vibrate(40);
    setTarget({ box: b, spot: { ...loc, box_id: b.id, box_code: b.code } });
    const f = freeIn(b);
    say({
      kind: f === 0 ? "dup" : "info", label: `${b.code} confirmado en`, big: loc.code,
      text: f == null ? "Sin límite de rollos." : f === 0 ? `${b.code} está lleno. Escanee otro contenedor.` : `Espacio para ${f} rollo(s) más en ${b.code}.`,
    });
    scanRef.current?.focus();
  };

  const onScan = async (raw) => {
    const { target: t, rolls: list } = live.current;
    let d;
    try { d = await post("/reception/identify", { raw, expect: !t.box ? "box" : !t.spot ? "spot" : undefined }); }
    catch (e) { return fail(e.message); }
    if (d.kind === "location") return pickSpot(d.location);
    if (d.kind === "box") return pickBox(d.box);
    if (d.kind === "invalid_box") return fail(d.error);
    // A roll: select it in the list.
    const hit = (d.rolls || []).find((r) => list.some((x) => x.id === r.id));
    if (hit) {
      const already = live.current.selected.has(hit.id);
      setSelected((s) => new Set(s).add(hit.id));
      beep(already ? "dup" : "ok"); vibrate(40);
      const count = live.current.selected.size + (already ? 0 : 1);
      return say({ kind: already ? "dup" : "ok", big: hit.roll_no, label: already ? "Ya estaba seleccionado" : `Seleccionado · ${count} en total`, text: rollLine(hit) });
    }
    const other = (d.rolls || [])[0];
    if (!other) return fail(`No existe el rollo ${d.rollNo}. Escanéelo primero en «Escanear rollos».`);
    const where = {
      requested: "todavía no se escanea su llegada. Escanéelo en «Escanear rollos».",
      assigned: "todavía no se escanea su llegada. Escanéelo en «Escanear rollos».",
      arrived: "espera contenedor: está en «Asignar a contenedor».",
      temporary: "está en el «Lugar temporal».",
      in_stock: `ya está guardado en ${other.box_code || "—"}${other.location_code ? ` (${other.location_code})` : ""}.`,
    }[other.status] || `está en estado «${other.status}».`;
    beep("dup"); vibrate([80, 60, 80]);
    say({ kind: "dup", big: other.roll_no, text: `Este rollo ${where}` });
  };

  const removeLocally = (ids, patch = {}) => setData((d) => {
    const gone = new Set(ids);
    const moved = d[mode === "temporary" ? "temporary" : "arrived"].filter((r) => gone.has(r.id)).map((r) => ({ ...r, ...patch }));
    const next = { ...d };
    next[mode === "temporary" ? "temporary" : "arrived"] = d[mode === "temporary" ? "temporary" : "arrived"].filter((r) => !gone.has(r.id));
    if (patch.status === "temporary") next.temporary = [...d.temporary, ...moved];
    next.today = d.today.map((r) => (gone.has(r.id) ? { ...r, ...patch } : r));
    return next;
  });

  const save = async () => {
    if (!box || !spot || !chosen.length) return;
    setSaving(true);
    try {
      const ids = chosen.map((r) => r.id);
      const d = await post("/rolls/put-away", { ids, boxId: box.id });
      beep("ok"); vibrate([60, 40, 60]);
      setTarget((t) => ({ ...t, box: d.box || t.box }));
      removeLocally(ids, { status: "in_stock", box_code: box.code, location_code: spot?.code });
      setSelected(new Set());
      say({
        kind: "saved", title: `${d.saved} rollo(s) guardados en ${box.code}`,
        text: `Lugar ${spot?.code || d.box?.location_code || "—"}${d.box ? ` · ${d.box.stored} rollos en el contenedor` : ""}${d.skipped ? ` · ${d.skipped} ya no esperaban contenedor` : ""}`,
      });
      notifyChange();
      reload();
    } catch (e) {
      fail(e.message);
      if (e.data?.code === "location_full") reload();
    } finally { setSaving(false); scanRef.current?.focus(); }
  };

  const toTemporary = async ({ reason, place }) => {
    const ids = chosen.map((r) => r.id);
    const d = await post("/rolls/to-temporary", { ids, reason, place });
    beep("ok"); vibrate([60, 40, 60]);
    removeLocally(ids, { status: "temporary", temp_reason: reason, temp_place: place, temp_at: new Date().toISOString() });
    setSelected(new Set());
    setTempOpen(false);
    say({ kind: "saved", title: `${d.moved} rollo(s) en el lugar temporal${place ? ` «${place}»` : ""}`, text: `Motivo: ${reason}` });
    notifyChange();
    reload();
  };

  const ready = !!(box && spot); // container scanned and its spot confirmed
  const over = ready && free != null && chosen.length > free;
  const noRoom = space.placed > 0 && space.free === 0;

  return (
    <div className="grid xl:grid-cols-12 gap-5 items-start">
      <div className="xl:col-span-8 space-y-5 min-w-0">
        {/* Spot + container */}
        <Card className="p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <TargetSlot icon={Box} label="Contenedor" value={box?.code}
              hint={box ? (free == null ? "Sin límite" : `${free} libre(s) de ${box.capacity}`) : "Escanee la etiqueta del contenedor"}
              active={!box} warn={box && free === 0} />
            <TargetSlot icon={MapPin} label="Lugar" value={spot?.code}
              hint={spot ? "Confirmado" : box ? (box.location_code ? `Registrado: ${box.location_code}` : "Sin lugar registrado") : "Después del contenedor"}
              active={!!box && !spot} />
          </div>
          <ScanInput inputRef={scanRef} onScan={onScan}
            label={!box ? "Paso 1 · Escanee el contenedor (F33)" : !spot ? `Paso 2 · Escanee el lugar donde está ${box.code} (A01)` : "Escanee rollos para seleccionarlos, u otro contenedor para cambiar"}
            placeholder={!box ? "Etiqueta del contenedor…" : !spot ? "Etiqueta del lugar…" : "Código del rollo…"} />
          {(spot || box) && (
            <button onClick={() => { setTarget({ spot: null, box: null }); setResult(null); scanRef.current?.focus(); }} className="text-sm text-slate-500 hover:text-slate-800 underline underline-offset-2">
              Empezar con otro contenedor
            </button>
          )}
        </Card>

        <ResultBanner r={result} />

        {isTemp ? (
          rolls.length > 0 && space.free > 0 && (
            <div className="rounded-2xl bg-emerald-50 ring-1 ring-emerald-200 p-4 text-sm text-emerald-900">
              <span className="font-semibold">Ya hay espacio para {space.free} rollo(s)</span> en {space.withRoom} contenedor(es). Guárdelos y salen del lugar temporal.
            </div>
          )
        ) : noRoom && rolls.length > 0 ? (
          <div className="rounded-2xl bg-amber-50 ring-1 ring-amber-300 p-4 flex flex-wrap items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <div className="flex-1 min-w-[14rem] text-sm text-amber-900">
              <div className="font-semibold">No queda espacio en ningún contenedor</div>
              Seleccione los rollos y muévalos al lugar temporal con el motivo.
            </div>
            <Button variant="secondary" onClick={() => { setSelected(new Set(rolls.map((r) => r.id))); setTempOpen(true); }}>
              Mover los {rolls.length} al lugar temporal
            </Button>
          </div>
        ) : null}

        {/* Rolls waiting */}
        <Card className="overflow-hidden">
          <CardHeader
            title={isTemp ? "Rollos en el lugar temporal" : "Rollos que esperan contenedor"}
            subtitle={`${rolls.length} rollo(s) · ${num(sumYards(rolls), 1)} yd`}
          />
          {rolls.length === 0 ? (
            isTemp
              ? <EmptyState icon={Boxes} title="No hay rollos en el lugar temporal" />
              : <EmptyState icon={PackageCheck} title="Todos los rollos escaneados ya tienen contenedor"
                  text={<button onClick={goScan} className="text-indigo-600 hover:underline">Escanear más rollos</button>} />
          ) : (
            <>
              <div className="px-4 sm:px-5 pb-3 flex items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm text-slate-600 shrink-0">
                  <input type="checkbox" className="rounded border-slate-300 text-indigo-600" checked={allOn} onChange={toggleAll} />
                  Todos{q ? " los filtrados" : ""}
                </label>
                <div className="flex-1 flex items-center gap-2 rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 h-9">
                  <Search className="w-4 h-4 text-slate-400" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar por rollo, PO, tela, color" aria-label="Filtrar rollos"
                    className="flex-1 min-w-0 bg-transparent text-sm outline-none" />
                </div>
              </div>
              <ul className="divide-y divide-slate-100 max-h-[50vh] overflow-y-auto border-t border-slate-100">
                {filtered.map((r) => {
                  const on = selected.has(r.id);
                  return (
                    <li key={r.id} className={cx("px-4 sm:px-5 py-2.5 flex items-center gap-3", on && "bg-indigo-50/70")}>
                      <input type="checkbox" className="rounded border-slate-300 text-indigo-600 w-5 h-5 shrink-0" checked={on} onChange={() => toggle(r.id)} aria-label={`Seleccionar ${r.roll_no}`} />
                      <button onClick={() => openRoll(r)} className="min-w-0 flex-1 text-left">
                        <div className="font-mono text-sm font-semibold text-slate-900 truncate">{r.roll_no}</div>
                        <div className="text-xs text-slate-500 truncate">{rollLine(r)}</div>
                        {isTemp && (
                          <div className="text-xs text-amber-800 mt-0.5 truncate">
                            {r.temp_place ? `${r.temp_place} · ` : ""}{r.temp_reason} · {sinceText(r.temp_at)}
                          </div>
                        )}
                      </button>
                      {!isTemp && r.planned_box_code && <Pill tone="slate">Reservado {r.planned_box_code}</Pill>}
                      {r.source === "scan" && <Pill tone="slate">Sin solicitud</Pill>}
                      {isTemp && daysSince(r.temp_at) >= 3 && <Pill tone="amber"><Clock className="w-3 h-3 inline -mt-0.5" /> {daysSince(r.temp_at)} d</Pill>}
                      <span className="text-sm text-slate-600 fab-tnum w-14 text-right shrink-0">{num(r.yards, 1)}</span>
                    </li>
                  );
                })}
                {filtered.length === 0 && <li className="px-5 py-6 text-sm text-slate-500 text-center">Ningún rollo coincide con «{q}».</li>}
              </ul>

              {/* Actions */}
              <div className="border-t border-slate-200 bg-slate-50/80 px-4 sm:px-5 py-3 space-y-2">
                {over && (
                  <div className="text-sm text-red-700 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {free === 0 ? `${box.code} está lleno. Escanee otro contenedor.` : `${box.code} solo tiene espacio para ${free}. Quite ${chosen.length - free} rollo(s) o escanee otro contenedor.`}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm text-slate-600 mr-auto">
                    <span className="font-semibold text-slate-900">{chosen.length}</span> seleccionado(s){chosen.length > 0 && <> · {num(sumYards(chosen), 1)} yd</>}
                  </div>
                  {!isTemp && (
                    <Button variant="secondary" disabled={!chosen.length || saving} onClick={() => setTempOpen(true)}>Mover al lugar temporal</Button>
                  )}
                  <Button icon={CheckCircle2} loading={saving} disabled={!ready || !chosen.length || over || chosen.length > data.maxPutAway} onClick={save}>
                    {!box ? "Escanee contenedor y lugar" : !spot ? `Escanee el lugar de ${box.code}` : chosen.length ? `Guardar ${chosen.length} en ${box.code}` : `Seleccione rollos para ${box.code}`}
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>

        {tempOpen && !isTemp && chosen.length > 0 && (
          <TemporaryForm count={chosen.length} space={space} places={data.places} noRoom={noRoom}
            onCancel={() => { setTempOpen(false); scanRef.current?.focus(); }} onSubmit={toTemporary} />
        )}
      </div>

      {/* Free room */}
      <Card className="xl:col-span-4 min-w-0 xl:sticky xl:top-20 overflow-hidden">
        <CardHeader title="Espacio en contenedores" subtitle={space.placed ? `${space.free} rollo(s) libres en ${space.withRoom} de ${space.placed} contenedores` : "Ningún contenedor está en un lugar"} />
        {space.boxes.length === 0 ? (
          <div className="px-5 pb-5 text-sm text-amber-800">
            No hay contenedores con espacio.{!isTemp && rolls.length > 0 && goTemporary ? " Los rollos que no quepan van al lugar temporal." : ""}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {space.boxes.map((b) => (
              <li key={b.id} className={cx("px-5 py-2.5 flex items-center gap-3 text-sm", box && String(box.id) === String(b.id) && "bg-indigo-50")}>
                <span className="font-mono font-semibold text-slate-900 w-14">{b.code}</span>
                <span className="text-slate-500 flex-1">en {b.location_code}</span>
                <span className="fab-tnum text-slate-700">{b.free} libre(s)</span>
              </li>
            ))}
          </ul>
        )}
        {!isTemp && data.temporary.length > 0 && goTemporary && (
          <button onClick={goTemporary} className="w-full text-left px-5 py-3 border-t border-slate-100 text-sm text-amber-800 hover:bg-amber-50">
            {data.temporary.length} rollo(s) en el lugar temporal →
          </button>
        )}
      </Card>
    </div>
  );
}

function TargetSlot({ icon: Icon, label, value, hint, active, warn }) {
  return (
    <div className={cx("rounded-xl p-3 ring-1 flex items-center gap-3 min-w-0",
      value ? (warn ? "ring-amber-300 bg-amber-50" : "ring-emerald-200 bg-emerald-50") : active ? "ring-indigo-300 bg-indigo-50" : "ring-slate-200 bg-white")}>
      <div className={cx("w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
        value ? (warn ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700") : active ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-slate-400")}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{label}</div>
        <div className={cx("font-mono text-lg font-bold leading-tight", value ? "text-slate-900" : "text-slate-300")}>{value || "—"}</div>
        <div className="text-xs text-slate-500 truncate">{hint}</div>
      </div>
    </div>
  );
}

const REASONS = [
  "No hay contenedores con espacio",
  "Los contenedores con espacio no están accesibles",
  "Rollo dañado o mojado, se revisa antes de guardar",
];

function TemporaryForm({ count, space, places, noRoom, onCancel, onSubmit }) {
  const [reason, setReason] = useState(noRoom ? REASONS[0] : "");
  const [place, setPlace] = useState(places[0] || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const ok = reason.trim().length >= 3;

  const submit = async () => {
    if (!ok) { setErr("Escriba por qué van al lugar temporal."); return; }
    setBusy(true); setErr(null);
    try { await onSubmit({ reason: reason.trim(), place: place.trim() || null }); }
    catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Card className="p-4 sm:p-5 space-y-4 ring-2 ring-amber-300">
      <div>
        <div className="text-base font-semibold text-slate-900">Mover {count} rollo(s) al lugar temporal</div>
        <div className="text-sm text-slate-500">Quedan fuera de inventario hasta que se guarden en un contenedor desde «Lugar temporal».</div>
      </div>

      {space.free > 0 && (
        <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-sm text-amber-900">
          Todavía hay espacio para {space.free} rollo(s) en {space.withRoom} contenedor(es)
          {space.boxes.length ? ` (${space.boxes.slice(0, 3).map((b) => `${b.code} en ${b.location_code}`).join(", ")}${space.boxes.length > 3 ? "…" : ""})` : ""}.
          Explique en el motivo por qué no se usan.
        </div>
      )}

      <div>
        <label htmlFor="temp-reason" className="text-sm font-medium text-slate-700">Motivo <span className="text-red-600">*</span></label>
        <div className="flex flex-wrap gap-1.5 mt-1.5 mb-2">
          {REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)}
              className={cx("text-xs rounded-full px-3 py-1.5 ring-1", reason === r ? "bg-amber-100 ring-amber-400 text-amber-900" : "bg-white ring-slate-200 text-slate-600 hover:bg-slate-50")}>
              {r}
            </button>
          ))}
        </div>
        <textarea id="temp-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
          placeholder="Escriba el motivo"
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>

      <div>
        <label htmlFor="temp-place" className="text-sm font-medium text-slate-700">Dónde quedan <span className="text-slate-400 font-normal">(opcional)</span></label>
        <input id="temp-place" list="temp-places" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={120}
          placeholder="Ej. Pasillo junto al andén 2"
          className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 h-10 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <datalist id="temp-places">{places.map((p) => <option key={p} value={p} />)}</datalist>
      </div>

      {err && <div className="text-sm text-red-700 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {err}</div>}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancelar</Button>
        <Button loading={busy} disabled={!ok} onClick={submit}>Mover {count} al lugar temporal</Button>
      </div>
    </Card>
  );
}