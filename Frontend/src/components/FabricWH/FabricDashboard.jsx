// components/FabricWH/FabricDashboard.jsx
// Almacén de Tela — Dashboard.
//   • The roll life cycle as one connected flow (click a stage to work on it)
//   • «Pendientes»: what needs doing now, each with its action (compact)
//   • «Reservados»: rolls waiting to arrive, grouped by the container (and spot)
//     reserved for them
//   • Container occupancy and today's movements
//   • Conciliación: requested from Skytex vs received; rolls received without
//     a Skytex request are flagged in red until requested or reviewed
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  DownloadCloud, MapPin, Boxes, Microscope, Undo2, ScanLine, RefreshCw,
  ArrowRight, CheckCircle2, Clock, ArrowDownToLine, ArrowUpFromLine, Container, AlertTriangle, CalendarClock,
  ChevronRight, PackageOpen,
} from "lucide-react";
import FabricReconciliation from "./FabricReconciliation";
import {
  api, num, cx, Card, CardHeader, Button, PageHeader, ProgressBar, EmptyState,
  todayStr, fmtTime, Banner, locationText, SearchInput, useRollDrawer,
} from "./fabricShared";

const STAGES = [
  { key: "requested", label: "En Skytex", hint: "Solicitados, sin contenedor asignado", icon: DownloadCloud, tab: "ubicaciones", tone: "amber" },
  { key: "assigned", label: "Esperando llegada", hint: "Con contenedor reservado", icon: MapPin, tab: "recepcion", tone: "sky" },
  { key: "in_stock", label: "En inventario", hint: "Guardados en contenedor", icon: Boxes, tab: "inventario", tone: "emerald" },
  { key: "at_inspection", label: "En inspección", hint: "Con el equipo de calidad", icon: Microscope, tab: "inspeccion", tone: "violet" },
];
const TONE = {
  amber: { ring: "hover:ring-amber-300", icon: "bg-amber-100 text-amber-700", bar: "bg-amber-400" },
  sky: { ring: "hover:ring-sky-300", icon: "bg-sky-100 text-sky-700", bar: "bg-sky-400" },
  emerald: { ring: "hover:ring-emerald-300", icon: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-500" },
  violet: { ring: "hover:ring-violet-300", icon: "bg-violet-100 text-violet-700", bar: "bg-violet-400" },
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

export default function FabricDashboard({ onNavigate = () => {} }) {
  const [d, setD] = useState(null);
  const [aging, setAging] = useState(30);
  const [containers, setContainers] = useState([]);
  const [activity, setActivity] = useState([]);
  const [reserved, setReserved] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const t = todayStr();
      const [r, c, inb, out, res] = await Promise.all([
        api("/dashboard"),
        api("/containers"),
        api(`/reports/inbound?from=${t}&to=${t}`),
        api(`/reports/outbound?from=${t}&to=${t}`),
        api("/rolls?status=assigned"),
      ]);
      setReserved(res.rolls || []);
      setD(r.dashboard);
      setAging(r.agingDays || 30);
      setContainers(c.containers || []);
      setActivity([...(inb.rows || []), ...(out.rows || [])]
        .sort((a, b) => new Date(b.moved_at) - new Date(a.moved_at))
        .slice(0, 8));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const [reconTab, setReconTab] = useState("po");
  const [reconVersion, setReconVersion] = useState(0);
  const reconRef = useRef(null);
  const goRecon = (t) => { setReconTab(t); setTimeout(() => reconRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); };
  useEffect(() => { if (!loading) setReconVersion((v) => v + 1); }, [loading]);

  const s = (k) => d?.byStatus?.[k] || { rolls: 0, yards: 0 };
  let user = {};
  try { user = JSON.parse(localStorage.getItem("user") || "{}"); } catch { /* */ }
  const firstName = String(user.full_name || user.username || "").split(" ")[0];

  const todos = [
    d?.unrequested > 0 && { icon: AlertTriangle, tone: "red", text: `${num(d.unrequested)} rollo(s) recibidos que no estaban en la solicitud a Skytex`, action: "Revisar", onClick: () => goRecon("unrequested") },
    d?.overdue > 0 && { icon: CalendarClock, tone: "amber", text: `${num(d.overdue)} rollo(s) solicitados con fecha de entrega vencida`, action: "Ver pendientes", onClick: () => goRecon("pending") },
    s("requested").rolls > 0 && { icon: MapPin, tone: "amber", text: `${num(s("requested").rolls)} rollo(s) en Skytex aún sin contenedor asignado`, action: "Asignar contenedor", tab: "ubicaciones" },
    d?.openInspectionRequests > 0 && { icon: Microscope, tone: "violet", text: `${d.openInspectionRequests} solicitud(es) de inspección por enviar`, action: "Preparar envío", tab: "inspeccion" },
    d?.aging?.rolls > 0 && { icon: Clock, tone: "red", text: `${num(d.aging.rolls)} rollo(s) llevan más de ${aging} días en inventario`, action: "Revisar devolución", tab: "devoluciones" },
    s("assigned").rolls > 0 && { icon: ScanLine, tone: "sky", text: `${num(s("assigned").rolls)} rollo(s) por llegar con contenedor asignado`, action: "Ir a recepción", tab: "recepcion" },
  ].filter(Boolean);

  const maxStage = Math.max(1, ...STAGES.map((st) => s(st.key).rolls));
  const dateLabel = new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting()}${firstName ? `, ${firstName}` : ""}`}
        subtitle={<span className="capitalize">{dateLabel}</span>}
        actions={<Button variant="secondary" icon={RefreshCw} loading={loading} onClick={load}>Actualizar</Button>}
      />

      {error && <Banner kind="err">{error}</Banner>}

      {/* Life-cycle flow */}
      <Card className="p-5">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-900">Recorrido de los rollos</h2>
          <span className="text-xs text-slate-500">Haga clic en una etapa para trabajarla</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 md:gap-0 relative">
          {STAGES.map((st, i) => {
            const v = s(st.key);
            const T = TONE[st.tone];
            return (
              <div key={st.key} className="relative md:px-2 first:md:pl-0 last:md:pr-0">
                {i < STAGES.length - 1 && (
                  <div className="hidden md:flex absolute top-9 -right-2 z-10 w-4 justify-center text-slate-300">
                    <ArrowRight className="w-4 h-4" />
                  </div>
                )}
                <button
                  onClick={() => onNavigate(st.tab)}
                  className={cx("w-full text-left rounded-2xl ring-1 ring-slate-200 p-4 transition hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500", T.ring)}
                >
                  <div className="flex items-center gap-2">
                    <span className={cx("w-8 h-8 rounded-lg flex items-center justify-center", T.icon)}><st.icon className="w-4 h-4" /></span>
                    <span className="text-sm font-medium text-slate-700">{st.label}</span>
                  </div>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-3xl font-semibold text-slate-900 fab-tnum">{loading && !d ? "·" : num(v.rolls)}</span>
                    <span className="text-xs text-slate-500">rollos</span>
                  </div>
                  <div className="text-xs text-slate-500 fab-tnum">{num(v.yards, 1)} yd · {st.hint}</div>
                  <div className="mt-3 h-1 rounded-full bg-slate-100 overflow-hidden">
                    <div className={cx("h-full rounded-full", T.bar)} style={{ width: `${Math.round((v.rolls / maxStage) * 100)}%` }} />
                  </div>
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-4 pt-4 border-t border-dashed border-slate-200 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-500">
          <span className="inline-flex items-center gap-1.5"><Undo2 className="w-4 h-4" /> Devueltos a proveedor: <b className="text-slate-800 fab-tnum">{num(s("returned").rolls)}</b> ({num(s("returned").yards, 1)} yd)</span>
          <span>Solicitudes canceladas: <b className="text-slate-800 fab-tnum">{num(s("cancelled").rolls)}</b></span>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 xl:grid-cols-12 gap-6 items-start">
        {/* To-do (compact: the whole row is the action) */}
        <Card className="xl:col-span-4 overflow-hidden">
          <CardHeader title="Pendientes" subtitle={todos.length ? `${todos.length} por atender` : "Lo que necesita atención ahora"} />
          {todos.length === 0 ? (
            <div className="px-5 py-6 flex items-center gap-2 text-sm text-slate-500">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" /> Todo al día.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {todos.map((t) => (
                <li key={t.text}>
                  <button
                    onClick={() => (t.onClick ? t.onClick() : onNavigate(t.tab))}
                    className={cx("w-full px-4 py-2.5 flex items-center gap-2.5 text-left transition hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-50",
                      t.tone === "red" && "bg-red-50/50 hover:bg-red-50")}
                  >
                    <span className={cx("w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                      { amber: "bg-amber-100 text-amber-700", violet: "bg-violet-100 text-violet-700", red: "bg-red-100 text-red-700", sky: "bg-sky-100 text-sky-700" }[t.tone])}>
                      <t.icon className="w-3.5 h-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] leading-snug text-slate-700">{t.text}</span>
                      <span className={cx("text-xs font-medium", t.tone === "red" ? "text-red-600" : "text-indigo-600")}>{t.action}</span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Reserved rolls and where they will go */}
        <ReservedCard rolls={reserved} loading={loading} className="xl:col-span-5 lg:row-span-2 xl:row-span-1" onNavigate={onNavigate} />

        {/* Today */}
        <Card className="xl:col-span-3">
          <CardHeader title="Hoy" />
          <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100">
            {[
              ["Recibidos", d?.today?.received, "text-emerald-600"],
              ["A inspección", d?.today?.toInspection, "text-violet-600"],
              ["Devueltos", d?.today?.returned, "text-slate-600"],
            ].map(([label, v, cls]) => (
              <div key={label} className="px-2 py-3 text-center">
                <div className={cx("text-2xl font-semibold fab-tnum", cls)}>{num(v ?? 0)}</div>
                <div className="text-xs text-slate-500">{label}</div>
              </div>
            ))}
          </div>
          {activity.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-400 text-center">Sin movimientos hoy.</div>
          ) : (
            <ul className="px-5 py-3 space-y-2.5">
              {activity.map((a) => (
                <li key={`${a.type}-${a.movement_id}`} className="flex items-center gap-3 text-sm">
                  {a.type === "received"
                    ? <ArrowDownToLine className="w-4 h-4 text-emerald-600 shrink-0" />
                    : <ArrowUpFromLine className={cx("w-4 h-4 shrink-0", a.type === "inspection_out" ? "text-violet-600" : "text-slate-500")} />}
                  <span className="font-mono text-slate-900">{a.roll_no}</span>
                  <span className="text-slate-500 truncate flex-1">
                    {a.type === "received" ? `→ ${locationText(a)}` : a.type === "inspection_out" ? "a inspección" : "devuelto"}
                  </span>
                  <span className="text-xs text-slate-400 fab-tnum">{fmtTime(a.moved_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Requested from Skytex vs received */}
      <div ref={reconRef} style={{ scrollMarginTop: 72 }}>
        <FabricReconciliation tab={reconTab} onTab={setReconTab} version={reconVersion} onChanged={load} />
      </div>

      {/* Containers */}
      <Card>
        <CardHeader
          title="Ocupación por división"
          subtitle="Contenedores colocados y rollos guardados / reservados"
          actions={<Button size="sm" variant="ghost" onClick={() => onNavigate("ubicaciones")}>Administrar</Button>}
        />
        {containers.length === 0 ? (
          <EmptyState icon={Container} title="Aún no hay divisiones" text="Créelas en Ubicaciones (A, B, C…) y coloque los contenedores F01…F80 en sus lugares." action={<Button onClick={() => onNavigate("ubicaciones")}>Crear división</Button>} />
        ) : (
          <div className="p-5 grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {containers.map((c) => {
              const locs = (c.locations || []).filter((l) => l.box_code);
              const spots = (c.locations || []).length;
              const stored = locs.reduce((a, l) => a + Number(l.stored || 0), 0);
              const reserved = locs.reduce((a, l) => a + Number(l.reserved || 0), 0);
              const capKnown = locs.every((l) => l.capacity != null) && locs.length > 0;
              const cap = capKnown ? locs.reduce((a, l) => a + Number(l.capacity), 0) : null;
              const yards = locs.reduce((a, l) => a + Number(l.yards || 0), 0);
              return (
                <div key={c.id} className="rounded-xl ring-1 ring-slate-200 p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold text-slate-900">División {c.code}</span>
                    <span className="text-xs text-slate-500 fab-tnum">{num(yards, 0)} yd</span>
                  </div>
                  {c.name && <div className="text-xs text-slate-500">{c.name}</div>}
                  <div className="mt-3 h-2 rounded-full bg-slate-100 overflow-hidden flex">
                    {cap ? (
                      <>
                        <div className="h-full bg-emerald-500" style={{ width: `${(stored / cap) * 100}%` }} />
                        <div className="h-full bg-sky-300" style={{ width: `${(reserved / cap) * 100}%` }} />
                      </>
                    ) : <div className="h-full bg-emerald-500" style={{ width: stored ? "100%" : "0%" }} />}
                  </div>
                  <div className="mt-2 text-xs text-slate-500 flex flex-wrap gap-x-3">
                    <span><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1" />{stored} guardados</span>
                    <span><span className="inline-block w-2 h-2 rounded-full bg-sky-300 mr-1" />{reserved} reservados</span>
                    <span>{cap ? `${Math.max(0, cap - stored - reserved)} libres` : ""}</span>
                    <span className="w-full">{locs.length}/{spots} lugares con contenedor</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reserved rolls (status «assigned»), grouped by the container reserved for
// them: «F01 · A01 — 5 rollos», then each roll. Click a roll for its detail.
// ---------------------------------------------------------------------------
const byNum = (a, b) => String(a).localeCompare(String(b), "es", { numeric: true });

function ReservedCard({ rolls, loading, className, onNavigate }) {
  const openRoll = useRollDrawer();
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t
      ? rolls.filter((r) => [r.roll_no, r.po_number, r.fabric_name, r.color, r.lot, r.supplier, r.box_code, r.location_code]
          .some((v) => String(v ?? "").toLowerCase().includes(t)))
      : rolls;
    const m = new Map();
    for (const r of list) {
      const k = r.box_code || "—";
      if (!m.has(k)) m.set(k, { box: r.box_code, spot: r.location_code, rolls: [], yards: 0 });
      const g = m.get(k);
      g.rolls.push(r);
      g.yards += Number(r.yards || 0);
    }
    return [...m.values()].sort((a, b) => byNum(a.spot || a.box || "~", b.spot || b.box || "~"));
  }, [rolls, q]);

  const shown = groups.reduce((a, g) => a + g.rolls.length, 0);
  const yards = rolls.reduce((a, r) => a + Number(r.yards || 0), 0);

  return (
    <Card className={cx("overflow-hidden flex flex-col", className)}>
      <CardHeader
        title="Reservados por llegar"
        subtitle={`${num(rolls.length)} rollo(s) · ${num(yards, 1)} yd · ${groups.length} contenedor(es)`}
        actions={<Button size="sm" variant="ghost" onClick={() => onNavigate("recepcion")}>Recepción</Button>}
      />
      {rolls.length > 0 && (
        <div className="px-4 py-2 border-b border-slate-100">
          <SearchInput value={q} onChange={setQ} placeholder="Rollo, PO, tela, contenedor…" />
        </div>
      )}
      {rolls.length === 0 ? (
        <EmptyState icon={PackageOpen} title={loading ? "Cargando…" : "No hay rollos reservados"}
          text={loading ? "" : "Cuando asigne un contenedor a un rollo en Ubicaciones, aparecerá aquí hasta que llegue."} />
      ) : shown === 0 ? (
        <div className="px-5 py-6 text-sm text-slate-400 text-center">Nada coincide con «{q}».</div>
      ) : (
        <div className="max-h-[420px] overflow-y-auto">
          {groups.map((g) => (
            <section key={g.box || "none"}>
              <div className="sticky top-0 z-10 px-4 py-1.5 bg-slate-50/95 backdrop-blur border-y border-slate-100 flex items-center gap-2 text-xs">
                <Container className="w-3.5 h-3.5 text-sky-600" />
                <span className="font-semibold text-slate-900">{g.box || "Sin contenedor"}</span>
                {g.box && (
                  <span className={cx("inline-flex items-center gap-0.5", g.spot ? "text-slate-500" : "text-amber-700 font-medium")}>
                    <MapPin className="w-3 h-3" />{g.spot || "sin lugar"}
                  </span>
                )}
                <span className="ml-auto text-slate-500 fab-tnum">{g.rolls.length} rollo(s) · {num(g.yards, 1)} yd</span>
              </div>
              <ul className="divide-y divide-slate-100">
                {g.rolls.map((r) => (
                  <li key={r.id}>
                    <button onClick={() => openRoll(r)} className="w-full px-4 py-2 flex items-center gap-3 text-left hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-50">
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-sm font-semibold text-slate-900 truncate">{r.roll_no}</span>
                        <span className="block text-xs text-slate-500 truncate">
                          {[r.fabric_name, r.color, r.po_number && `PO ${r.po_number}`].filter(Boolean).join(" · ") || "Sin datos de Skytex"}
                        </span>
                      </span>
                      <span className="text-right shrink-0">
                        <span className="block text-xs font-medium text-slate-700" title="Contenedor · lugar">{locationText(r)}</span>
                        {r.yards != null && <span className="block text-xs text-slate-400 fab-tnum">{num(r.yards, 1)} yd</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}