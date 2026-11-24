// components/warehouse/FinishedWarehouseBanda.jsx
// Almacén de Producto Terminado — Banda transportadora (CS-001).
// Monitor de los PLC, SOLO LECTURA (backend: banda-plc.js):
//   • una tarjeta por IP con interruptor de lectura y "Probar conexión";
//   • la banda animada: cada caja escaneada pasa por las etapas y llega al
//     poste correcto o al de rechazo, según lo que decidió el sistema;
//   • la memoria V200..V285 que se leyó del PLC, con los bytes que cambian;
//   • la bitácora de escaneos.
//   GET  /api/banda/estado?after=<id>     POST /api/banda/plcs/:ip/monitor { on }
//   GET  /api/banda/eventos?limit=50      POST /api/banda/plcs/:ip/probe
//
//   {tab === "banda" && <FinishedWarehouseBanda />}
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Cpu, Plug, CheckCircle2, XCircle, PlayCircle, Activity, ShieldCheck, Radio, Camera, QrCode, ScanLine } from "lucide-react";
import {
  api, post, cx, num, timeAgo, fmtTime, PageHeader, Card, CardHeader, Button, Pill, Banner,
  EmptyState, Loading, Stat, Th, Td, PageFrame,
} from "./finishedShared";

const V_INICIO = 200;
const V_SENAL = 215;
const V_SERIAL = 246;
const V_CAMBIAN = [210, 228, 232];   // cambian a la vez que la señal (banda_plc.py)
const POLL_MS = 1000;

// Banda vertical (de arriba hacia abajo). Las posiciones son porcentajes, para
// que escale con el contenedor. La caja baja por el carril central y al final
// se va a la izquierda (rechazo) o a la derecha (correcto).
const ETAPAS = [
  { n: 1, label: "Entrada", x: 7,  sub: "La caja entra" },
  { n: 2, label: "Cámara / escáner QR", x: 30, sub: "Lee el código" },
  { n: 3, label: "Identificación", x: 52, sub: "El sistema reconoce la caja" },
  { n: 4, label: "Desviador", x: 70, sub: "Decide el poste" },
  { n: 5, label: "Poste", x: 88, sub: "Correcto o rechazo" },
];
// Carril horizontal: la caja avanza en X; al final sube (correcto) o baja (rechazo).
const CARRIL_X = ETAPAS.map((e) => e.x);
const posteY = (poste) => (poste === "correcto" ? 24 : 76);   // % vertical del poste
const SENSORES = [30, 52, 70];                                 // fotocélulas (fases 2,3,4)
const TIEMPOS = [0, 900, 1900, 2900, 3900, 5000];
const VIDA = 5800;
const posDe = (fase, poste) => (fase >= 4 ? [CARRIL_X[4], posteY(poste)] : [CARRIL_X[Math.max(0, fase)], 50]);

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function FinishedWarehouseBanda() {
  const [plcs, setPlcs] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [hoy, setHoy] = useState({ correcto: 0, rechazo: 0 });
  const [cajas, setCajas] = useState([]);
  const [llegadas, setLlegadas] = useState({ correcto: 0, rechazo: 0 });
  const [destello, setDestello] = useState({ correcto: 0, rechazo: 0 });
  const [selIp, setSelIp] = useState(null);
  const [probando, setProbando] = useState({});
  const [cambiando, setCambiando] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const lastId = useRef(0);
  const timers = useRef([]);
  const sinMovimiento = useMemo(reduceMotion, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Una caja recorre la banda. `ev.poste` decide a qué poste llega.
  const lanzar = useCallback((ev) => {
    const key = `${ev.id}-${Math.random().toString(36).slice(2, 7)}`;
    setCajas((cs) => [...cs.slice(-11), { key, serial: ev.serial, poste: ev.poste, motivo: ev.motivo, numero_orden: ev.numero_orden, talla: ev.talla, sim: !!ev.sim, fase: 0 }]);
    const at = (ms, fn) => timers.current.push(setTimeout(fn, sinMovimiento ? Math.min(ms, 600) : ms));
    TIEMPOS.slice(1).forEach((t, i) => at(t, () => setCajas((cs) => cs.map((c) => (c.key === key ? { ...c, fase: i + 1 } : c)))));
    at(TIEMPOS[4], () => {
      setLlegadas((l) => ({ ...l, [ev.poste]: l[ev.poste] + 1 }));
      setDestello((d) => ({ ...d, [ev.poste]: Date.now() }));
    });
    at(VIDA, () => setCajas((cs) => cs.filter((c) => c.key !== key)));
  }, [sinMovimiento]);

  // Historial al abrir; después, sondeo del estado cada segundo.
  useEffect(() => {
    let vivo = true, t = null;
    const sondeo = async () => {
      try {
        const d = await api(`/api/banda/estado?after=${lastId.current}`);
        if (!vivo) return;
        setPlcs(d.plcs || []);
        setError(null);
        const nuevos = (d.eventos || []).filter((e) => e.id > lastId.current);
        if (nuevos.length) {
          lastId.current = Math.max(...nuevos.map((e) => e.id));
          setEventos((es) => [...nuevos.slice().reverse(), ...es].slice(0, 150));
          for (const e of nuevos) {
            if (!e.cambio_texto) continue;        // pulso repetido del mismo código: no es una caja nueva
            setHoy((h) => ({ ...h, [e.poste]: (h[e.poste] || 0) + 1 }));
            lanzar(e);
          }
        }
      } catch (e) {
        if (vivo) setError(e.message);
      } finally {
        if (vivo) t = setTimeout(sondeo, POLL_MS);
      }
    };
    (async () => {
      try {
        const h = await api("/api/banda/eventos?limit=50");
        if (!vivo) return;
        setEventos(h.eventos || []);
        setHoy({ correcto: h.hoy?.correcto || 0, rechazo: h.hoy?.rechazo || 0 });
        lastId.current = Math.max(0, ...(h.eventos || []).map((e) => e.id));
      } catch (e) {
        if (vivo) setError(e.message);
      }
      if (vivo) setLoading(false);
      sondeo();
    })();
    return () => { vivo = false; clearTimeout(t); };
  }, [lanzar]);

  useEffect(() => {
    if (!selIp && plcs.length) setSelIp((plcs.find((p) => p.conectado) || plcs[0]).ip);
  }, [plcs, selIp]);

  const toggle = async (p) => {
    setCambiando((c) => ({ ...c, [p.ip]: true }));
    try {
      const d = await post(`/api/banda/plcs/${encodeURIComponent(p.ip)}/monitor`, { on: !p.encendido });
      setPlcs((ps) => ps.map((x) => (x.ip === p.ip ? d.plc : x)));
      if (!p.encendido) setSelIp(p.ip);
    } catch (e) {
      setError(e.message);
    } finally {
      setCambiando((c) => ({ ...c, [p.ip]: false }));
    }
  };

  const probar = async (ip) => {
    setProbando((x) => ({ ...x, [ip]: true }));
    try {
      const d = await post(`/api/banda/plcs/${encodeURIComponent(ip)}/probe`);
      setPlcs((ps) => ps.map((x) => (x.ip === ip ? { ...x, ultimaPrueba: d.prueba } : x)));
    } catch (e) {
      setError(`${ip}: ${e.message}`);
    } finally {
      setProbando((x) => ({ ...x, [ip]: false }));
    }
  };
  const probarTodas = () => plcs.forEach((p) => probar(p.ip));

  const simular = (poste) => {
    const serial = `PRUEBA${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
    const ev = {
      id: `sim-${Date.now()}`, sim: true, serial, poste, cambio_texto: true, plc_ip: "simulado", created_at: new Date().toISOString(),
      motivo: poste === "correcto" ? "Caja de prueba: sigue al poste correcto" : "Caja de prueba: va al poste de rechazo",
    };
    setEventos((es) => [ev, ...es].slice(0, 150));
    lanzar(ev);
  };

  const conectados = plcs.filter((p) => p.conectado).length;
  const encendidos = plcs.filter((p) => p.encendido).length;
  const sel = plcs.find((p) => p.ip === selIp);
  const bandaMoviendo = !sinMovimiento && (conectados > 0 || cajas.length > 0);
  const faseActiva = cajas.length ? Math.min(4, cajas[cajas.length - 1].fase) : -1;

  return (
    <PageFrame>
      <PageHeader
        title="Banda transportadora"
        subtitle="Lectura en vivo de los PLC de la banda CS-001 y a qué poste va cada caja."
        actions={<Button variant="secondary" icon={Plug} loading={Object.values(probando).some(Boolean)} onClick={probarTodas} disabled={!plcs.length}>Probar las {plcs.length || ""} IP</Button>}
      />

      <Banner kind="info">
        Solo lectura: el interruptor abre o cierra la lectura de cada PLC; el sistema nunca escribe en ellos ni mueve el robot.
        El poste que se muestra es el destino que decidió el sistema, no una confirmación física de la banda.
      </Banner>
      {error && <Banner kind="err" onClose={() => setError(null)}>{error}</Banner>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={Cpu} label="PLC conectados" display={`${conectados} / ${plcs.length}`} hint={`${encendidos} con lectura encendida`} tone="indigo" />
        <Stat icon={CheckCircle2} label="Al poste correcto hoy" value={hoy.correcto} tone="emerald" />
        <Stat icon={XCircle} label="Al rechazo hoy" value={hoy.rechazo} tone="red" alert={hoy.rechazo > 0 && hoy.rechazo >= hoy.correcto} />
        <Stat icon={Activity} label="Último escaneo" display={eventos.find((e) => !e.sim) ? timeAgo(eventos.find((e) => !e.sim).created_at) : "—"} hint={eventos.find((e) => !e.sim)?.serial || ""} />
      </div>

      {/* PLC cards */}
      {loading && !plcs.length ? <Card><Loading text="Leyendo los PLC…" /></Card> : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {plcs.map((p) => (
            <PlcCard key={p.ip} p={p} seleccionado={p.ip === selIp} onSelect={() => setSelIp(p.ip)}
                     onToggle={() => toggle(p)} cambiando={!!cambiando[p.ip]} onProbar={() => probar(p.ip)} probando={!!probando[p.ip]} />
          ))}
        </div>
      )}

      {/* Belt */}
      <Card className="overflow-hidden">
        <CardHeader
          icon={Radio}
          title="Recorrido de las cajas"
          subtitle="Cada código nuevo que lee el PLC entra a la banda y termina en su poste."
          actions={<>
            <Button size="sm" variant="secondary" icon={PlayCircle} onClick={() => simular("correcto")}>Simular caja correcta</Button>
            <Button size="sm" variant="secondary" icon={PlayCircle} onClick={() => simular("rechazo")}>Simular caja rechazada</Button>
          </>}
        />
        <Banda cajas={cajas} moviendo={bandaMoviendo} llegadas={llegadas} destello={destello}
               sinMovimiento={sinMovimiento} faseActiva={faseActiva} />
      </Card>

      <div className="grid xl:grid-cols-5 gap-6">
        {/* Raw memory */}
        <Card className="xl:col-span-2 overflow-hidden">
          <CardHeader icon={Cpu} title={sel ? `Memoria V200–V285 · ${sel.ip}` : "Memoria del PLC"}
                      subtitle="Lo que el sistema leyó del PLC. En naranja, lo que cambió en la última lectura." />
          <Memoria plc={sel} />
        </Card>

        {/* Event log */}
        <Card className="xl:col-span-3 overflow-hidden">
          <CardHeader icon={Activity} title="Bitácora de escaneos" subtitle={`${num(eventos.length)} escaneo(s) recientes`} />
          {eventos.length === 0 ? (
            <EmptyState icon={Radio} title="Todavía no hay escaneos"
                        text="Encienda la lectura del PLC de la banda (10.1.11.100) y pase una caja por el escáner, o simule una caja para ver el recorrido." />
          ) : (
            <div className="overflow-x-auto max-h-[420px]">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr><Th>Hora</Th><Th>PLC</Th><Th>Código leído</Th><Th>Qué es</Th><Th>Poste</Th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {eventos.map((e) => (
                    <tr key={e.id} className={cx(!e.cambio_texto && "opacity-60")}>
                      <Td className="tabular-nums text-slate-500">{fmtTime(e.created_at)}</Td>
                      <Td mono className="text-slate-500">{e.plc_ip}</Td>
                      <Td mono strong>{e.serial || "—"}</Td>
                      <td className="px-4 py-2.5 text-slate-600 min-w-[220px]">
                        {e.motivo || "—"}
                        {!e.cambio_texto && <Pill className="ml-2">pulso repetido</Pill>}
                        {e.repetido && <Pill tone="amber" className="ml-2">misma caja otra vez</Pill>}
                        {e.sim && <Pill tone="violet" className="ml-2">simulado</Pill>}
                      </td>
                      <Td><PostePill poste={e.poste} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </PageFrame>
  );
}

// ---------------------------------------------------------------------------

function PostePill({ poste }) {
  return poste === "correcto"
    ? <Pill tone="emerald" icon={CheckCircle2}>Correcto</Pill>
    : <Pill tone="red" icon={XCircle}>Rechazo</Pill>;
}

function estadoDe(p) {
  if (!p.encendido) return { txt: "Lectura apagada", dot: "bg-slate-300" };
  if (p.conectado) return { txt: "Conectado", dot: "bg-emerald-500" };
  if (p.error) return { txt: "Sin conexión, reintentando", dot: "bg-red-500" };
  return { txt: "Conectando…", dot: "bg-amber-400 animate-pulse" };
}

function PlcCard({ p, seleccionado, onSelect, onToggle, cambiando, onProbar, probando }) {
  const st = estadoDe(p);
  const pr = p.ultimaPrueba;
  return (
    <Card className={cx("p-4 flex flex-col gap-3 transition", seleccionado && "ring-2 ring-indigo-400")}>
      <div className="flex items-start gap-3">
        <button onClick={onSelect} className="min-w-0 flex-1 text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" title="Ver su memoria">
          <div className="font-mono font-semibold text-slate-900">{p.ip}</div>
          <div className="text-xs text-slate-500 truncate">{p.nombre}</div>
        </button>
        <Interruptor on={p.encendido} disabled={cambiando} onClick={onToggle} label={`Lectura de ${p.ip}`} />
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className={cx("w-2.5 h-2.5 rounded-full shrink-0", st.dot)} />
        <span className="text-slate-700">{st.txt}</span>
        {p.conectado && <span className="ml-auto text-xs text-slate-400 tabular-nums">{num(p.lecturas)} lecturas</span>}
      </div>

      {p.encendido && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-slate-400">Último código leído</dt>
          <dd className="font-mono text-slate-800 truncate text-right" title={p.ultimoLeidoAt ? `a las ${fmtTime(p.ultimoLeidoAt)}` : ""}>{p.ultimoLeido || "—"}</dd>
          <dt className="text-slate-400">Código en memoria</dt><dd className="font-mono text-slate-500 truncate text-right">{p.serial || "vacío"}</dd>
          <dt className="text-slate-400">Señal V215</dt>
          <dd className="text-right tabular-nums">{p.senal == null ? "—" : <span className={p.senal === 0x0b ? "font-semibold text-amber-600" : "text-slate-600"}>0x{p.senal.toString(16).padStart(2, "0")}</span>}</dd>
          <dt className="text-slate-400">Última lectura</dt><dd className="text-right text-slate-600">{p.ultimoContacto ? fmtTime(p.ultimoContacto) : "—"}</dd>
          <dt className="text-slate-400">Señales repetidas</dt><dd className="text-right tabular-nums text-slate-500" title="El PLC repitió la señal sin un código nuevo; no se cuentan como cajas">{num(p.pulsosRepetidos || 0)}</dd>
          {p.tsap && <><dt className="text-slate-400">TSAP</dt><dd className="font-mono text-right text-slate-600">{p.tsap}</dd></>}
        </dl>
      )}
      {p.encendido && p.error && !p.conectado && <p className="text-xs text-red-600 break-words">{p.error}</p>}

      {pr && (
        <div className="rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-200 p-2.5 text-xs space-y-1.5">
          <div className="flex justify-between text-slate-500"><span>Prueba de conexión</span><span>{fmtTime(pr.fecha)}</span></div>
          <ul className="flex flex-wrap gap-1">
            {pr.puertos.map((x) => (
              <li key={x.port} title={x.error || `${x.ms} ms`}
                  className={cx("rounded px-1.5 py-0.5 ring-1 ring-inset tabular-nums", x.abierto ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-white text-slate-400 ring-slate-200")}>
                {x.port}{x.nombre ? ` ${x.nombre}` : ""} {x.abierto ? "abierto" : "cerrado"}
              </li>
            ))}
          </ul>
          {pr.s7.ok ? (
            <div className="text-emerald-700 flex items-start gap-1"><CheckCircle2 className="w-3.5 h-3.5 mt-px shrink-0" />
              <span>Respondió como PLC S7 (TSAP {pr.s7.tsap}){pr.s7.serial ? `; último código ${pr.s7.serial}` : ""}.</span></div>
          ) : (
            <div className="text-slate-500 flex items-start gap-1"><XCircle className="w-3.5 h-3.5 mt-px shrink-0 text-slate-400" /><span className="break-words">No respondió como PLC S7: {pr.s7.error}</span></div>
          )}
        </div>
      )}

      <Button size="sm" variant="secondary" icon={Plug} loading={probando} onClick={onProbar} className="mt-auto">Probar conexión</Button>
    </Card>
  );
}

function Interruptor({ on, disabled, onClick, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick}
            className={cx("relative inline-flex h-7 w-14 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50",
              on ? "bg-emerald-600" : "bg-slate-300")}>
      <span className={cx("absolute text-[10px] font-semibold text-white", on ? "left-2" : "right-2")}>{on ? "ON" : "OFF"}</span>
      <span className={cx("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-8" : "translate-x-1")} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Banda horizontal, plana. La caja entra por la izquierda y avanza; una cámara/
// escáner QR la lee en la fase 2; hay fotocélulas (sensores) en cada estación;
// al pasar el desviador sube al poste Correcto o baja al de Rechazo. Al leer el
// código aparece un globo "escaneado" con el valor.
// ---------------------------------------------------------------------------
function Banda({ cajas, moviendo, llegadas, destello, sinMovimiento, faseActiva }) {
  const escaneando = cajas.some((c) => c.fase === 1);
  const reciente = (t) => Date.now() - t < 1100;
  const total = llegadas.correcto + llegadas.rechazo;
  const pctOk = total ? Math.round((llegadas.correcto / total) * 100) : null;
  // caja que acaba de ser leída por la cámara → globo con el código
  const leida = cajas.find((c) => c.fase >= 1 && c.fase <= 2 && c.serial);

  return (
    <div className="px-3 sm:px-5 pt-4 pb-3">
      <style>{`
        @keyframes fwFlowX { to { background-position-x: 24px; } }
        @keyframes fwScan { 0%,100% { opacity: .15; } 50% { opacity: .9; } }
        @keyframes fwBlink { 0%,100% { opacity: 1; } 50% { opacity: .25; } }
        @keyframes fwPop { 0% { transform: translate(-50%,-50%) scale(.6); opacity: 0; } 60% { transform: translate(-50%,-50%) scale(1.12); } 100% { transform: translate(-50%,-50%) scale(1); opacity: 1; } }
      `}</style>

      <div className="relative w-full overflow-x-auto">
        <div className="relative min-w-[720px]" style={{ height: 300 }}>
          {/* branch lines from diverter to each pole */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 100 100" aria-hidden>
            <path d={`M${CARRIL_X[3]} 50 L${CARRIL_X[4]} ${posteY("correcto")}`} stroke="#cbd5e1" strokeWidth="0.5" fill="none" vectorEffect="non-scaling-stroke" />
            <path d={`M${CARRIL_X[3]} 50 L${CARRIL_X[4]} ${posteY("rechazo")}`} stroke="#cbd5e1" strokeWidth="0.5" fill="none" vectorEffect="non-scaling-stroke" />
          </svg>

          {/* the belt lane */}
          <div className="absolute left-[3%] right-[22%] top-1/2 -translate-y-1/2 h-14 rounded-lg bg-slate-200/70 ring-1 ring-inset ring-slate-300/60"
               style={{
                 backgroundImage: "repeating-linear-gradient(to right, transparent 0 10px, rgba(100,116,139,.22) 10px 12px)",
                 animation: moviendo && !sinMovimiento ? "fwFlowX .7s linear infinite" : "none",
               }} />

          {/* photo-eye sensors at stages 2,3,4 */}
          {SENSORES.map((x, i) => {
            const activa = cajas.some((c) => Math.round(posDe(Math.min(c.fase, 4), c.poste)[0]) === x && c.fase <= 4);
            return (
              <div key={x} className="absolute -translate-x-1/2" style={{ left: `${x}%`, top: "50%", transform: "translate(-50%,-50%)" }}>
                {/* emitter above, receiver below, beam between */}
                <div className="relative h-14 flex flex-col items-center justify-between">
                  <span className={cx("w-2 h-2 rounded-full ring-2 ring-white", activa ? "bg-amber-500" : "bg-slate-400")}
                        style={activa ? { animation: "fwBlink .5s steps(2) infinite" } : undefined} />
                  <span className="absolute top-2 bottom-2 w-px" style={{ background: activa ? "#f59e0b" : "#cbd5e1", animation: activa ? "fwScan .5s ease-in-out infinite" : "none" }} />
                  <span className={cx("w-2 h-2 rounded-full ring-2 ring-white", activa ? "bg-amber-500" : "bg-slate-400")} />
                </div>
                <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-slate-400 whitespace-nowrap">S{i + 1}</div>
              </div>
            );
          })}

          {/* QR camera over the scan point (stage 2) */}
          <div className="absolute -translate-x-1/2 flex flex-col items-center" style={{ left: `${CARRIL_X[1]}%`, top: 6 }}>
            <div className="flex items-center gap-1.5 rounded-lg bg-slate-900 text-white px-2.5 py-1.5 shadow-sm">
              <Camera className="w-4 h-4" />
              <div className="leading-tight">
                <div className="text-[10px] font-semibold">Cámara QR</div>
                <div className="text-[9px] text-slate-300 font-mono">PLC ·100</div>
              </div>
              <span className={cx("w-1.5 h-1.5 rounded-full ml-0.5", escaneando ? "bg-red-500" : "bg-emerald-400")}
                    style={escaneando ? { animation: "fwBlink .4s steps(2) infinite" } : undefined} />
            </div>
            {/* lens cone + scan beam down to the belt */}
            <div className="w-0 h-0 border-x-[10px] border-x-transparent border-t-[8px] border-t-slate-900" />
            <div className="w-16 relative" style={{ height: 96 }}>
              {escaneando && <div className="absolute inset-x-0 top-0 h-full"
                   style={{ background: "linear-gradient(to bottom, rgba(239,68,68,.35), rgba(239,68,68,0))", animation: "fwScan .5s ease-in-out infinite" }} />}
            </div>
          </div>

          {/* "scanned" popup with the code */}
          {leida && !sinMovimiento && (
            <div className="absolute z-30 -translate-x-1/2" style={{ left: `${CARRIL_X[1]}%`, top: 108 }}>
              <div className="relative -translate-x-1/2 left-1/2 rounded-lg bg-white ring-1 ring-slate-300 shadow-md px-2.5 py-1.5 flex items-center gap-2"
                   style={{ animation: "fwPop .3s ease-out" }}>
                <QrCode className="w-6 h-6 text-slate-700 shrink-0" />
                <div className="leading-tight">
                  <div className="text-[9px] uppercase tracking-wide text-emerald-600 font-semibold flex items-center gap-1"><ScanLine className="w-3 h-3" />Escaneado</div>
                  <div className="font-mono text-[12px] font-semibold text-slate-900">{leida.serial}</div>
                </div>
              </div>
            </div>
          )}

          {/* diverter (stage 4) */}
          <div className="absolute -translate-x-1/2 -translate-y-1/2 z-20" style={{ left: `${CARRIL_X[3]}%`, top: "50%" }}>
            <div className="w-7 h-7 rotate-45 rounded-[4px] bg-amber-400 ring-2 ring-amber-600" />
            <div className="absolute top-8 left-1/2 -translate-x-1/2 text-[9px] text-amber-700 whitespace-nowrap">Desviador</div>
          </div>

          {/* poles */}
          {[["correcto", "Correcto", CheckCircle2, "text-emerald-600", "bg-emerald-50 ring-emerald-200", "ring-emerald-400"],
            ["rechazo", "Rechazo", XCircle, "text-red-600", "bg-red-50 ring-red-200", "ring-red-400"]].map(([k, label, Icon, fg, bg, ring]) => (
            <div key={k} className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center gap-2" style={{ left: `${CARRIL_X[4]}%`, top: `${posteY(k)}%` }}>
              <div className={cx("relative w-14 h-14 rounded-2xl ring-1 flex items-center justify-center", bg, !sinMovimiento && reciente(destello[k]) && "scale-110 transition-transform")}>
                <Icon className={cx("w-6 h-6", fg)} />
                {!sinMovimiento && reciente(destello[k]) && (
                  <span key={destello[k]} className={cx("absolute inset-0 rounded-2xl ring-2", ring)} style={{ animation: "fwPop .6s ease-out" }} />
                )}
              </div>
              <div>
                <div className={cx("text-sm font-semibold leading-tight", fg)}>{label}</div>
                <div className="text-xs text-slate-500 tabular-nums">{num(llegadas[k])} caja(s)</div>
              </div>
            </div>
          ))}

          {pctOk != null && <div className="absolute top-1 right-2 text-[11px] text-slate-400 tabular-nums">{pctOk}% correcto</div>}

          {/* boxes */}
          {cajas.map((c) => {
            const [x, y] = posDe(Math.min(c.fase, 4), c.poste);
            const fuera = c.fase >= 5;
            const ok = c.poste === "correcto";
            const verdicto = c.fase >= 3;
            return (
              <div key={c.key} title={`${c.serial || "sin código"}${c.motivo ? " · " + c.motivo : ""}`}
                   className="absolute z-10 pointer-events-auto"
                   style={{
                     left: `${x}%`, top: `${y}%`,
                     transform: `translate(-50%, -50%) scale(${fuera ? 0.6 : 1})`, opacity: fuera ? 0 : 1,
                     transition: sinMovimiento ? "none" : "left .85s ease-in-out, top .85s cubic-bezier(.45,.05,.55,.95), transform .5s, opacity .5s",
                   }}>
                <div className={cx("relative w-[46px] h-[34px] rounded-[5px] border shadow-sm",
                       c.sim ? "bg-[#d9bf98] border-[#a8875a] border-dashed" : "bg-[#c99f6e] border-[#9c7444]")}>
                  <div className="absolute inset-x-[18px] inset-y-0 bg-[#a87f4d]/60" />
                  <div className="absolute left-1 bottom-1 w-4 h-2 rounded-[2px] bg-white/85" />
                  {verdicto && (
                    <span className={cx("absolute -top-2 -right-2 w-4.5 h-4.5 w-[18px] h-[18px] rounded-full flex items-center justify-center ring-2 ring-white",
                      ok ? "bg-emerald-600" : "bg-red-600")}>
                      {ok ? <CheckCircle2 className="w-3 h-3 text-white" /> : <XCircle className="w-3 h-3 text-white" />}
                    </span>
                  )}
                </div>
                <div className="absolute left-1/2 -translate-x-1/2 top-[36px] whitespace-nowrap text-[9px] font-mono text-slate-600 bg-white/90 rounded px-1">
                  {(c.serial || "—").slice(-10)}
                </div>
              </div>
            );
          })}

          {cajas.length === 0 && (
            <div className="absolute inset-x-0 bottom-1 flex justify-center">
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                <ShieldCheck className="w-3.5 h-3.5" /> Esperando cajas. Use los botones de simular para ver el recorrido.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* stage strip */}
      <ol className="mt-2 grid grid-cols-5 gap-2">
        {ETAPAS.map((e, i) => (
          <li key={e.n} className={cx("rounded-lg px-2.5 py-1.5 ring-1 ring-inset transition-colors",
            i === faseActiva ? "bg-slate-900 ring-slate-900 text-white" : "bg-slate-50 ring-slate-200 text-slate-500")}>
            <div className="text-xs font-medium flex items-center gap-1"><span className="tabular-nums opacity-70">{e.n}</span>{e.label}</div>
            <div className={cx("text-[10px] leading-tight", i === faseActiva ? "text-slate-300" : "text-slate-400")}>{e.sub}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// V200..V285 as a hex grid, 10 bytes per row so the addresses line up.
// ---------------------------------------------------------------------------
function Memoria({ plc }) {
  const fuente = plc?.hex ? { hex: plc.hex, txt: `Lectura en vivo · ${fmtTime(plc.ultimoContacto)}` }
    : plc?.ultimaPrueba?.s7?.hex ? { hex: plc.ultimaPrueba.s7.hex, txt: `De la prueba de conexión · ${fmtTime(plc.ultimaPrueba.fecha)}` }
    : null;
  const bytes = useMemo(() => (fuente?.hex ? fuente.hex.match(/../g).map((h) => parseInt(h, 16)) : []), [fuente?.hex]);
  const prev = useRef({ ip: null, bytes: [] });
  const [cambiados, setCambiados] = useState(new Set());
  useEffect(() => {
    if (!bytes.length) return;
    const p = prev.current;
    if (p.ip === plc?.ip && p.bytes.length === bytes.length) {
      const s = new Set();
      bytes.forEach((b, i) => { if (b !== p.bytes[i]) s.add(i); });
      if (s.size) setCambiados(s);
    } else {
      setCambiados(new Set());
    }
    prev.current = { ip: plc?.ip, bytes };
  }, [bytes, plc?.ip]);

  if (!plc) return <EmptyState icon={Cpu} title="Sin PLC" text="Configure las IP en BANDA_PLC_IPS." />;
  if (!bytes.length) {
    return <EmptyState icon={Cpu} title="Sin datos de este PLC"
                       text="Encienda su lectura o pulse Probar conexión. Si no responde como PLC S7, aquí no habrá memoria que mostrar." />;
  }

  const largoSerial = (() => { const i = V_SERIAL - V_INICIO; const fin = bytes.indexOf(0, i); return fin < 0 ? 40 : fin - i; })();
  const clase = (dir, i) => {
    if (dir === V_SENAL) return "bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-300";
    if (dir >= V_SERIAL && dir < V_SERIAL + largoSerial) return "bg-indigo-50 text-indigo-800";
    if (V_CAMBIAN.includes(dir)) return "bg-slate-100 text-slate-800";
    if (cambiados.has(i)) return "text-orange-600 font-semibold";
    return "text-slate-500";
  };
  const filas = [];
  for (let i = 0; i < bytes.length; i += 10) filas.push(i);

  return (
    <div className="p-4 space-y-3">
      <div className="text-xs text-slate-400">{fuente.txt}</div>
      <div className="overflow-x-auto">
        <table className="font-mono text-[12px] leading-6">
          <tbody>
            {filas.map((i) => (
              <tr key={i}>
                <td className="pr-3 text-slate-400 text-right">V{V_INICIO + i}</td>
                {bytes.slice(i, i + 10).map((b, j) => (
                  <td key={j} title={`V${V_INICIO + i + j} = ${b} (0x${b.toString(16).padStart(2, "0")})`}
                      className={cx("px-1 text-center rounded tabular-nums", cambiados.has(i + j) && "underline decoration-orange-400", clase(V_INICIO + i + j, i + j))}>
                    {b.toString(16).padStart(2, "0")}
                  </td>
                ))}
                <td className="pl-3 text-slate-400 whitespace-pre">{bytes.slice(i, i + 10).map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "·")).join("")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <li><span className="inline-block w-3 h-3 rounded-sm bg-amber-100 ring-1 ring-amber-300 align-middle mr-1" />V215 señal de escaneo</li>
        <li><span className="inline-block w-3 h-3 rounded-sm bg-indigo-50 ring-1 ring-indigo-200 align-middle mr-1" />V246 código leído</li>
        <li><span className="inline-block w-3 h-3 rounded-sm bg-slate-100 ring-1 ring-slate-200 align-middle mr-1" />V210, V228, V232 cambian con cada escaneo</li>
      </ul>
      {plc.ip !== "10.1.11.100" && (
        <p className="text-xs text-slate-400">Las direcciones marcadas solo están confirmadas en el PLC de la banda (10.1.11.100).</p>
      )}
    </div>
  );
}