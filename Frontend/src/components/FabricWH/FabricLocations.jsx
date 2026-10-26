// components/FabricWH/FabricLocations.jsx
// Almacén de Tela — Ubicaciones.
//
// Yard layout
//   División  A, B, C, D, E            (fabric_containers in the database)
//   Lugar     A01…A30 in each division  (fabric_locations)
//   Contenedor F01…F80, parked on a lugar (fabric_locations.box_code)
// Rolls are stored in a container; «F01 · A01» = container F01 on spot A01.
//
// «Con escáner» — only binds a container to its spot: scan the spot (A01), then
//   the container that is there (F33) and it is registered on A01. If F33 was
//   somewhere else, or A01 had another container, it asks first. Rolls are NOT
//   scanned here (that is done in Recepción).
// «Con lista» — reserve the container of a roll before it arrives: select
//   requested rolls in the table and CLICK a container on the map, or let
//   «Llenar automáticamente» spread them over a division.
// Right: the yard map. With no rolls selected, click a spot to place, move,
// swap or remove its container. «Colocar contenedores» places a whole series
// (F01…F30 on A01…A30) in one step.
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  MapPin, RefreshCw, Plus, Trash2, Container, Wand2, XCircle, MousePointerClick, MoreHorizontal,
  LayoutGrid, MoveRight, Search, ScanLine, List, CheckCircle2, AlertCircle, ArrowLeftRight,
} from "lucide-react";
import FabricYardMap from "./FabricYardMap";
import {
  api, post, del, num, cx, beep, vibrate, Card, CardHeader, Button, PageHeader, SegTabs, SearchInput,
  RollTable, ActionBar, LocationPicker, EmptyState, Modal, Field, inputCls, locationText,
  useSelection, useToast, useConfirm, notifyChange, Banner,
} from "./fabricShared";

const MODE_KEY = "fabricReserveMode";

const byNum = (a, b) => String(a).localeCompare(String(b), "es", { numeric: true });

// "f1", "F-01" → "F01" (same rule as the server)
const normBox = (v) => {
  const t = String(v ?? "").trim().toUpperCase().replace(/[\s-]+/g, "");
  if (!t) return "";
  const m = /^([A-Z]+)(\d+)$/.exec(t);
  return m ? `${m[1]}${m[2].padStart(2, "0")}` : t;
};

const spotUsed = (l) => Number(l.stored || 0) + Number(l.reserved || 0);
const spotFree = (l) => (l.capacity != null ? Math.max(0, l.capacity - spotUsed(l)) : null);

export default function FabricLocations({ onNavigate = () => {} }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState(() => localStorage.getItem(MODE_KEY) || "map");
  const [agingDays, setAgingDays] = useState(30);
  const [spotsPer, setSpotsPer] = useState(14);       // spots per division (A01…A14)
  const [boxCapacity, setBoxCapacity] = useState(50); // max rolls per container
  const [spotsFor, setSpotsFor] = useState(null);     // «Lugares por división» dialog: division | true (all)
  const [version, setVersion] = useState(0);   // bumps on every reload (map detail refreshes)
  const [view, setView] = useState("requested");
  const [rolls, setRolls] = useState({ requested: [], assigned: [] });
  const [divisions, setDivisions] = useState([]);
  const [unplaced, setUnplaced] = useState([]);
  const [boxes, setBoxes] = useState([]);          // the 80 containers (F01…F80)
  const [catalog, setCatalog] = useState({ count: 80, first: "F01", last: "F80", prefix: "F" });
  const [boxesOpen, setBoxesOpen] = useState(false);
  const [bindSpotId, setBindSpotId] = useState(null); // «Con escáner»: spot scanned, waiting for its container
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [find, setFind] = useState("");
  const [target, setTarget] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [seriesFor, setSeriesFor] = useState(null); // division or true
  const [spotOpen, setSpotOpen] = useState(null);   // { spot, division }
  const { sel, toggle, setAll, clear } = useSelection();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, b, c, x] = await Promise.all([api("/rolls?status=requested"), api("/rolls?status=assigned"), api("/containers"), api("/boxes")]);
      setRolls({ requested: a.rolls || [], assigned: b.rolls || [] });
      setDivisions(c.containers || []);
      setUnplaced(c.unplacedBoxes || []);
      if (c.agingDays) setAgingDays(c.agingDays);
      if (c.spotsPerDivision) setSpotsPer(c.spotsPerDivision);
      if (c.boxCapacity) setBoxCapacity(c.boxCapacity);
      setVersion((v) => v + 1);
      setBoxes(x.boxes || []);
      if (x.catalog) setCatalog(x.catalog);
    } catch (e) { toast({ kind: "err", text: e.message }); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { clear(); }, [view, mode, clear]);
  useEffect(() => { localStorage.setItem(MODE_KEY, mode); }, [mode]);

  // Every spot with its division, and where each container is.
  const allSpots = useMemo(
    () => divisions.flatMap((d) => (d.locations || []).map((l) => ({ ...l, division: d }))),
    [divisions]
  );
  const boxIndex = useMemo(() => new Map(allSpots.filter((l) => l.box_code).map((l) => [l.box_code.toUpperCase(), l])), [allSpots]);
  const placedCount = boxIndex.size;

  const findKey = normBox(find);
  const findHit = findKey ? boxIndex.get(findKey) || allSpots.find((l) => normBox(l.code) === findKey) : null;

  const list = rolls[view];
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter((r) => [r.roll_no, r.po_number, r.supplier, r.fabric_name, r.color, r.lot, r.customer, r.box_code, r.location_code]
      .some((v) => String(v ?? "").toLowerCase().includes(t)));
  }, [list, q]);

  const chosen = list.filter((r) => sel.has(r.id));
  const yards = chosen.reduce((s, r) => s + (Number(r.yards) || 0), 0);

  const assignTo = async (boxId, ids = [...sel]) => {
    if (!ids.length || !boxId) return;
    setBusy(true);
    try {
      const d = await post("/rolls/assign-location", { ids, boxId });
      toast({ kind: "ok", text: `${d.updated} rollo(s) → contenedor ${d.location.box_code} (${d.location.code})` });
      clear(); setTarget(null);
      notifyChange();
      await load();
    } catch (e) { toast({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  };

  // Spread the selected rolls over the containers of one division, in order.
  const autoFill = async (division) => {
    const ids = [...sel];
    const plan = [];
    let i = 0;
    const spots = (division.locations || []).filter((l) => l.box_code).sort((a, b) => byNum(a.code, b.code));
    for (const l of spots) {
      if (i >= ids.length) break;
      const free = l.capacity == null ? ids.length - i : spotFree(l);
      if (free <= 0) continue;
      plan.push({ loc: l, ids: ids.slice(i, i + free) });
      i += free;
    }
    if (i < ids.length) {
      return toast({ kind: "warn", text: `Los contenedores de la división ${division.code} solo tienen espacio para ${i} de ${ids.length} rollos.` });
    }
    const ok = await confirm({
      title: `Llenar contenedores de la división ${division.code}`,
      text: plan.map((p) => `${p.loc.box_code}: ${p.ids.length} rollo(s)`).join(" · "),
      confirmLabel: "Asignar",
    });
    if (!ok) return;
    setBusy(true);
    try {
      for (const p of plan) await post("/rolls/assign-location", { ids: p.ids, boxId: p.loc.box_id });
      toast({ kind: "ok", text: `${ids.length} rollo(s) repartidos en ${plan.length} contenedor(es) de la división ${division.code}.` });
      clear(); notifyChange();
      await load();
    } catch (e) { toast({ kind: "err", text: e.message }); await load(); }
    finally { setBusy(false); }
  };

  const cancelRequests = async () => {
    const ok = await confirm({ title: `¿Cancelar ${sel.size} solicitud(es)?`, text: "Los rollos dejarán de esperarse. Podrá solicitarlos otra vez desde Skytex.", danger: true, confirmLabel: "Cancelar solicitudes", cancelLabel: "Volver" });
    if (!ok) return;
    setBusy(true);
    try {
      const d = await post("/rolls/cancel", { ids: [...sel] });
      toast({ kind: "ok", text: `${d.cancelled} solicitud(es) canceladas.` });
      clear(); notifyChange();
      await load();
    } catch (e) { toast({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  };

  const columns = [
    { key: "roll_no", label: "Rollo", mono: true },
    { key: "po_number", label: "PO" },
    { key: "fabric_name", label: "Tela", render: (r) => <span>{r.fabric_name || "—"} <span className="text-slate-400">· {r.color || "—"}</span></span> },
    { key: "lot", label: "Lote" },
    { key: "yards", label: "Yardas", align: "right", render: (r) => num(r.yards, 1) },
    { key: "arrival_date", label: "Llega" },
    ...(view === "assigned" ? [{
      key: "box_code", label: "Contenedor",
      sortValue: (r) => `${r.box_code || "~"}`,
      render: (r) => <span className="font-medium text-slate-900">{locationText(r)}</span>,
    }] : []),
  ];

  return (
    <div className={mode === "list" ? "space-y-6" : "space-y-3"}>
      <PageHeader
        title="Ubicaciones"
        subtitle={mode !== "list"
          ? null
          : "Reserve el contenedor de cada rollo antes de que llegue. Seleccione rollos y haga clic en un contenedor del mapa."}
        actions={
          <>
            <SegTabs value={mode} onChange={setMode} tabs={[{ key: "map", label: "Mapa", icon: LayoutGrid }, { key: "scan", label: "Con escáner", icon: ScanLine }, { key: "list", label: "Con lista", icon: List }]} />
            <Button variant="secondary" icon={RefreshCw} loading={loading} onClick={load}>Actualizar</Button>
            {divisions.length > 0 && <Button variant="secondary" icon={LayoutGrid} onClick={() => setSeriesFor(true)} className={mode !== "list" ? "hidden md:inline-flex" : ""}>Colocar contenedores</Button>}
            <Button variant="dark" icon={Plus} onClick={() => setNewOpen(true)} className={mode !== "list" ? "hidden md:inline-flex" : ""}>Nueva división</Button>
          </>
        }
      />

      {(() => {
        const off = divisions.filter((d) => (d.locations || []).length !== spotsPer);
        if (!off.length) return null;
        return (
          <Banner kind="warn">
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                Cada división debe tener {spotsPer} lugares ({divisions[0]?.code || "A"}01–{divisions[0]?.code || "A"}{String(spotsPer).padStart(2, "0")}).{" "}
                {off.map((d) => `${d.code}: ${(d.locations || []).length}`).join(" · ")}
              </span>
              <button onClick={() => setSpotsFor(true)} className="font-semibold underline">Ajustar lugares</button>
            </span>
          </Banner>
        );
      })()}

      {mode !== "list" ? (
        <>
        {/* «Con escáner»: same yard map as «Mapa», with the scanner docked on top (no rolls here) */}
        {mode === "scan" && (
          <BindScanner
            allSpots={allSpots}
            boxIndex={boxIndex}
            unplaced={unplaced}
            spotId={bindSpotId}
            setSpotId={setBindSpotId}
            onSaved={load}
          />
        )}
        <FabricYardMap
          divisions={divisions}
          unplaced={unplaced}
          agingDays={agingDays}
          version={version}
          onEditSpot={(spot, division) => setSpotOpen({ spot, division })}
          onEditSpots={(division) => setSpotsFor(division)}
          onScanHere={(spot) => {
            setBindSpotId(spot?.id ?? null);
            setMode("scan");
          }}
          highlight={mode === "scan" ? bindSpotId : null}
          onSpotClick={mode === "scan" ? (spot) => setBindSpotId(spot.id) : null}
        />
        </>
      ) : (
      <div className="grid xl:grid-cols-12 gap-6 items-start">
        {/* Rolls */}
        {mode === "list" && (
        <Card className="xl:col-span-7 overflow-hidden min-w-0">
          <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center gap-3">
            <SegTabs
              value={view}
              onChange={setView}
              tabs={[
                { key: "requested", label: "En Skytex", count: rolls.requested.length },
                { key: "assigned", label: "Esperando llegada", count: rolls.assigned.length },
              ]}
            />
            <SearchInput value={q} onChange={setQ} placeholder="Rollo, PO, tela, contenedor…" className="flex-1 min-w-[180px]" />
          </div>
          <RollTable
            rows={shown}
            columns={columns}
            selected={sel}
            onToggle={toggle}
            onToggleAll={(on, ids) => setAll(ids, on)}
            onRowClick={(r) => toggle(r.id)}
            loading={loading}
            maxHeight="62vh"
            empty={
              view === "requested"
                ? <EmptyState icon={MapPin} title="Todos los rollos tienen contenedor" text="Los rollos que solicite a Skytex aparecerán aquí." action={<Button variant="secondary" onClick={() => onNavigate("solicitar")}>Solicitar a Skytex</Button>} />
                : <EmptyState icon={MapPin} title="No hay rollos en camino" text="Cuando asigne contenedores, los rollos esperarán aquí hasta que los escanee en Recepción." />
            }
          />
          {view === "assigned" && shown.length > 0 && (
            <div className="px-5 py-3 border-t border-slate-100 text-sm text-slate-500">
              Al llegar, escanéelos en <button onClick={() => onNavigate("recepcion")} className="font-medium text-indigo-600 hover:underline">Recepción</button>.
            </div>
          )}
        </Card>
        )}

        {/* Yard map */}
        <div className="xl:col-span-5 min-w-0 xl:sticky xl:top-20 space-y-4 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto xl:pr-1">
          {divisions.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <SearchInput value={find} onChange={setFind} placeholder="Buscar contenedor o lugar (F23, C07)…" className="flex-1" />
                <span className="text-xs text-slate-500 whitespace-nowrap fab-tnum">{placedCount} de {catalog.count} contenedores colocados</span>
              </div>
              {findKey && (
                <div className="text-sm px-1 text-slate-600 inline-flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5 text-slate-400" />
                  {findHit
                    ? findHit.box_code
                      ? <>Contenedor <b>{findHit.box_code}</b> está en el lugar <b>{findHit.code}</b> (división {findHit.division.code}) · {spotUsed(findHit)} rollo(s)</>
                      : <>El lugar <b>{findHit.code}</b> está vacío</>
                    : <>{findKey} no está colocado en ningún lugar</>}
                </div>
              )}
            </div>
          )}

          {/* The 80 containers and where each one is */}
          {boxes.length > 0 && (() => {
            const used = (b) => Number(b.stored || 0) + Number(b.reserved || 0);
            const lost = boxes.filter((b) => !b.location_id && used(b) > 0);
            const free = boxes.filter((b) => !b.location_id && used(b) === 0);
            return (
              <Card className={cx("p-4", lost.length > 0 && "ring-2 ring-amber-300")}>
                <button onClick={() => setBoxesOpen((v) => !v)} className="w-full flex items-start gap-3 text-left">
                  <span className={cx("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", lost.length ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600")}><Container className="w-4 h-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-900">Contenedores {catalog.first}–{catalog.last}</div>
                    <div className="text-xs text-slate-500 fab-tnum">
                      {placedCount} colocados · {free.length} libres sin lugar
                      {lost.length > 0 && <span className="text-amber-700 font-medium"> · {lost.length} con rollos sin lugar</span>}
                    </div>
                  </div>
                  <span className="text-xs text-indigo-600 font-medium shrink-0 mt-1">{boxesOpen ? "Ocultar" : "Ver los " + boxes.length}</span>
                </button>
                {lost.length > 0 && (
                  <div className="mt-3 text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
                    {lost.map((b) => b.code).join(", ")} se movieron con rollos y falta registrar su nuevo lugar: escanee el lugar y después el contenedor.
                  </div>
                )}
                {boxesOpen && (
                  <>
                    <div className="mt-3 grid grid-cols-5 sm:grid-cols-8 xl:grid-cols-6 2xl:grid-cols-8 gap-1.5">
                      {boxes.map((b) => {
                        const n = used(b);
                        return (
                          <button
                            key={b.id}
                            onClick={() => setFind(b.code)}
                            title={b.location_id ? `${b.code} en ${b.location_code} · ${n} rollo(s)` : n ? `${b.code} sin lugar · ${n} rollo(s)` : `${b.code} libre, sin lugar`}
                            className={cx("rounded-lg px-1.5 py-1 text-left ring-1 transition hover:ring-2 hover:ring-indigo-400",
                              b.location_id ? "bg-white ring-slate-200" : n ? "bg-amber-50 ring-amber-300" : "bg-slate-50 ring-slate-200 border border-dashed border-slate-300")}
                          >
                            <div className="font-mono text-xs font-semibold text-slate-900 leading-tight">{b.code}</div>
                            <div className="text-[10px] text-slate-500 leading-tight truncate">{b.location_id ? b.location_code : n ? "sin lugar" : "libre"}</div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
                      <span><span className="inline-block w-2.5 h-2.5 rounded bg-white ring-1 ring-slate-300 mr-1" />En su lugar</span>
                      <span><span className="inline-block w-2.5 h-2.5 rounded bg-amber-50 ring-1 ring-amber-300 mr-1" />Con rollos, sin lugar</span>
                      <span><span className="inline-block w-2.5 h-2.5 rounded border border-dashed border-slate-300 mr-1" />Libre</span>
                    </div>
                  </>
                )}
              </Card>
            );
          })()}

          {mode === "list" && sel.size > 0 ? (
            <Banner kind="info">
              <span className="inline-flex items-center gap-2"><MousePointerClick className="w-4 h-4" /> Haga clic en un contenedor para guardar ahí los <b>{sel.size}</b> rollos seleccionados.</span>
            </Banner>
          ) : divisions.length > 0 && (
            <div className="text-xs text-slate-500 px-1">Seleccione rollos a la izquierda para elegir contenedor. Sin rollos seleccionados, haga clic en un lugar para colocar, mover o quitar su contenedor.</div>
          )}

          {divisions.length === 0 && !loading && (
            <Card>
              <EmptyState icon={LayoutGrid} title="Cree su primera división" text="Defina la división (A, B, C…) y cuántos lugares tiene. Después coloque los contenedores F01…F80 en esos lugares." action={<Button icon={Plus} onClick={() => setNewOpen(true)}>Nueva división</Button>} />
            </Card>
          )}

          {divisions.map((d) => (
            <DivisionMap
              key={d.id}
              division={d}
              onSpots={() => setSpotsFor(d)}
              selecting={sel.size}
              busy={busy}
              highlight={findHit?.id}
              onPick={(l) => assignTo(l.box_id)}
              onSpot={(l) => setSpotOpen({ spot: l, division: d })}
              onAutoFill={() => autoFill(d)}
              onSeries={() => setSeriesFor(d)}
              reload={load}
            />
          ))}
        </div>
      </div>
      )}

      <ActionBar count={mode === "list" ? sel.size : 0} summary={`${num(yards, 1)} yd`} onClear={clear}>
        <LocationPicker containers={divisions} value={target} onChange={setTarget} />
        <Button icon={MapPin} disabled={!target} loading={busy} onClick={() => assignTo(target)}>
          {view === "requested" ? "Asignar" : "Cambiar contenedor"}
        </Button>
        <Button variant="onDarkDanger" icon={XCircle} onClick={cancelRequests}>Cancelar solicitud</Button>
      </ActionBar>

      <DivisionModal open={newOpen} onClose={() => setNewOpen(false)} onSaved={load} defaultCount={spotsPer} boxCapacity={boxCapacity} />
      <SpotsModal
        open={!!spotsFor}
        divisions={divisions}
        initial={spotsFor === true ? null : spotsFor}
        defaultCount={spotsPer}
        onClose={() => setSpotsFor(null)}
        onSaved={load}
      />
      <SpotModal
        open={!!spotOpen}
        spot={spotOpen?.spot}
        division={spotOpen?.division}
        allSpots={allSpots}
        boxIndex={boxIndex}
        unplaced={unplaced}
        boxes={boxes}
        catalog={catalog}
        onClose={() => setSpotOpen(null)}
        onSaved={load}
      />
      <SeriesModal
        open={!!seriesFor}
        divisions={divisions}
        initialDivision={seriesFor === true ? null : seriesFor}
        boxIndex={boxIndex}
        boxes={boxes}
        catalog={catalog}
        onClose={() => setSeriesFor(null)}
        onSaved={load}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// «Con escáner»: bind a container to the spot where it is parked.
//   1. Scan the spot label (A01)   2. Scan the container label (F33)
// → F33 is registered on A01. If F33 was on another spot it moves here with its
// rolls; if A01 had another container, that one stays «sin lugar». Both ask
// first. Codes are read with /scan-test, so a roll scanned by mistake is never
// saved — it only shows a warning.
// ---------------------------------------------------------------------------
function BindScanner({ allSpots, boxIndex, unplaced = [], spotId, setSpotId, onSaved }) {
  const confirm = useConfirm();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { n, kind: "ok" | "info" | "err", text, sub }
  const [log, setLog] = useState([]);   // containers registered in this session
  const inputRef = useRef(null);

  const spot = spotId != null ? allSpots.find((l) => String(l.id) === String(spotId)) || null : null;
  const step = spot ? 2 : 1;
  const focus = () => setTimeout(() => inputRef.current?.focus(), 0);
  useEffect(() => { focus(); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const say = (kind, text, sub = null) => {
    if (kind === "ok") { beep("ok"); vibrate([60, 40, 60]); }
    else if (kind === "err") { beep("err"); vibrate([200, 100, 200]); }
    else { beep("ok"); vibrate(40); }
    setMsg({ n: Date.now(), kind, text, sub });
  };

  const bind = async (sp, boxCode) => {
    const box = normBox(boxCode);
    if (sp.box_code && sp.box_code.toUpperCase() === box) {
      setSpotId(null);
      return say("ok", `${box} ya está registrado en ${sp.code}`, "Sin cambios. Escanee el siguiente lugar.");
    }
    const used = spotUsed(sp);
    const elsewhere = boxIndex.get(box);
    const floating = unplaced.find((b) => b.code.toUpperCase() === box);
    const floatingRolls = floating ? Number(floating.stored || 0) + Number(floating.reserved || 0) : 0;
    const lines = [];
    if (elsewhere) lines.push(`${box} está registrado en ${elsewhere.code}; se mueve aquí${spotUsed(elsewhere) ? ` con sus ${spotUsed(elsewhere)} rollo(s)` : ""}.`);
    if (floating && floatingRolls) lines.push(`${box} no tenía lugar; sus ${floatingRolls} rollo(s) quedan aquí.`);
    if (sp.box_code) lines.push(`${sp.box_code} queda sin lugar${used ? ` con sus ${used} rollo(s)` : ""} hasta que se registre donde está.`);
    if (lines.length) {
      const ok = await confirm({ title: `¿${box} está en ${sp.code}?`, text: lines.join(" "), confirmLabel: `Sí, registrar en ${sp.code}` });
      if (!ok) return say("info", "Sin cambios", `Escanee otra vez el contenedor que está en ${sp.code}.`);
    }
    await post("/boxes/place", { pairs: [{ locationId: sp.id, boxCode: box }], displace: !!sp.box_code });
    const text = elsewhere ? `${box} movido de ${elsewhere.code} a ${sp.code}` : `${box} registrado en ${sp.code}`;
    say("ok", text, sp.box_code ? `${sp.box_code} quedó sin lugar.` : "Escanee el siguiente lugar.");
    setLog((prev) => [{ n: Date.now(), box, spot: sp.code, from: elsewhere?.code || null, displaced: sp.box_code || null }, ...prev].slice(0, 30));
    setSpotId(null);
    notifyChange();
    await onSaved();
  };

  const submit = async () => {
    const raw = code.trim();
    if (!raw || busy) return;
    setCode("");
    setBusy(true);
    try {
      const d = await post("/scan-test", step === 2 ? { raw, expect: "box" } : { raw });
      if (d.kind === "location" && d.location) {
        const sp = allSpots.find((l) => normBox(l.code) === normBox(d.location.code));
        if (!sp) return say("err", `El lugar ${d.location.code} no aparece en el mapa`, "Pulse «Actualizar» e intente de nuevo.");
        setSpotId(sp.id);
        return say("info", `Lugar ${sp.code}`, sp.box_code ? `Registrado: ${sp.box_code}. Escanee el contenedor que está ahí.` : "Sin contenedor registrado. Escanee el contenedor que está ahí.");
      }
      if (d.kind === "box" && d.box) {
        if (!spot) {
          return say("err", `Escanee primero el lugar donde está ${d.box.code}`,
            d.box.location_code ? `Hoy está registrado en ${d.box.location_code}.` : "Hoy no tiene lugar registrado.");
        }
        return await bind(spot, d.box.code);
      }
      if (d.invalid) return say("err", d.invalid);
      if (d.kind === "roll") return say("err", "Eso es un rollo", "Aquí solo se escanean lugares y contenedores.");
      return say("err", `No se reconoce «${raw}»`, step === 1 ? "Escanee la etiqueta del lugar, por ejemplo A01." : "Escanee la etiqueta del contenedor, por ejemplo F01.");
    } catch (e) {
      say("err", e.message);
    } finally {
      setBusy(false);
      focus();
    }
  };

  // One compact bar above the yard map: Lugar → Contenedor · input · status.
  const chip = (on, done) => cx(
    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm ring-1 whitespace-nowrap",
    on ? "bg-indigo-50 text-indigo-700 ring-indigo-300" : done ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-50 text-slate-400 ring-slate-200"
  );
  const tone = msg && (msg.kind === "ok" ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
    : msg.kind === "err" ? "bg-red-50 text-red-700 ring-red-200" : "bg-indigo-50 text-indigo-800 ring-indigo-200");
  const Icon = msg && (msg.kind === "ok" ? CheckCircle2 : msg.kind === "err" ? AlertCircle : MapPin);

  return (
    <Card className="p-3 sm:p-4 space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={chip(step === 1, step === 2)}>
            <MapPin className="w-3.5 h-3.5" />
            {spot ? <b className="font-mono">{spot.code}</b> : "Lugar"}
            {spot?.box_code && <span className="text-xs opacity-75">· {spot.box_code}</span>}
          </span>
          <MoveRight className="w-4 h-4 text-slate-300" />
          <span className={chip(step === 2, false)}>
            <Container className="w-3.5 h-3.5" /> Contenedor
          </span>
        </div>

        <div className="flex gap-2 flex-1 min-w-0">
          <input
            ref={inputRef}
            className={cx(inputCls, "flex-1 min-w-0 font-mono uppercase")}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
            placeholder={step === 1 ? "Escanee el lugar (A01)" : `Escanee el contenedor que está en ${spot.code}`}
            aria-label={step === 1 ? "Código del lugar" : "Código del contenedor"}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={busy}
            autoFocus
          />
          <Button icon={ScanLine} loading={busy} onClick={submit} disabled={!code.trim()}>Registrar</Button>
          {spot && (
            <Button variant="secondary" icon={XCircle} onClick={() => { setSpotId(null); setMsg(null); focus(); }} title="Escanear otro lugar">
              <span className="hidden sm:inline">Otro lugar</span>
            </Button>
          )}
        </div>
      </div>

      {msg ? (
        <div key={msg.n} role="status" aria-live="assertive" className={cx("rounded-xl px-3 py-2.5 ring-1 flex items-center gap-2.5 fab-pop", tone)}>
          <Icon className="w-5 h-5 shrink-0" />
          <div className="min-w-0 text-sm">
            <span className="font-semibold text-base">{msg.text}</span>
            {msg.sub && <span className="opacity-80"> — {msg.sub}</span>}
          </div>
        </div>
      ) : (
        <div className="text-xs text-slate-500 px-1">
          Escanee el lugar y después el contenedor que está ahí. También puede tocar el lugar en el mapa.
        </div>
      )}

      {log.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-500 mr-1">Registrados ({log.length}):</span>
          {log.map((x) => (
            <span key={x.n} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 font-mono text-slate-700"
              title={x.displaced ? `${x.displaced} quedó sin lugar` : undefined}>
              {x.box}<MoveRight className="w-3 h-3 text-slate-400" />{x.spot}
              {x.displaced && <AlertCircle className="w-3 h-3 text-amber-600" />}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// One division: its spots, each showing the container parked on it.
// ---------------------------------------------------------------------------
function DivisionMap({ division: d, selecting, busy, highlight, onPick, onSpot, onAutoFill, onSeries, onSpots, reload }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [menu, setMenu] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const spots = useMemo(() => [...(d.locations || [])].sort((a, b) => byNum(a.code, b.code)), [d.locations]);
  const withBox = spots.filter((l) => l.box_code);
  const stored = spots.reduce((a, l) => a + Number(l.stored || 0), 0);
  const reserved = spots.reduce((a, l) => a + Number(l.reserved || 0), 0);

  const removeSpot = async (l) => {
    if (!(await confirm({ title: `¿Eliminar el lugar ${l.code}?`, danger: true, confirmLabel: "Eliminar" }))) return;
    try { await del(`/locations/${l.id}`); await reload(); } catch (e) { toast({ kind: "err", text: e.message }); }
  };
  const removeDivision = async () => {
    setMenu(false);
    if (!(await confirm({ title: `¿Dar de baja la división ${d.code}?`, text: "Solo se puede si sus contenedores no tienen rollos.", danger: true, confirmLabel: "Dar de baja" }))) return;
    try { await del(`/containers/${d.id}`); toast({ kind: "ok", text: `División ${d.code} dada de baja.` }); await reload(); } catch (e) { toast({ kind: "err", text: e.message }); }
  };

  return (
    <Card className={cx(selecting > 0 && withBox.length > 0 && "ring-2 ring-indigo-200")}>
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><LayoutGrid className="w-4 h-4 text-slate-400" />División {d.code}{d.name && <span className="font-normal text-slate-500">· {d.name}</span>}</span>}
        subtitle={`${withBox.length}/${spots.length} lugares con contenedor · ${stored} rollos guardados · ${reserved} reservados`}
        actions={
          <>
            {selecting > 0 && withBox.length > 0 && <Button size="sm" variant="secondary" icon={Wand2} onClick={onAutoFill} disabled={busy}>Llenar automáticamente</Button>}
            <div className="relative">
              <button onClick={() => setMenu((m) => !m)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Opciones de la división ${d.code}`}>
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {menu && (
                <div className="absolute right-0 mt-1 w-56 z-20 bg-white rounded-xl shadow-xl ring-1 ring-slate-900/10 py-1 text-sm" onMouseLeave={() => setMenu(false)}>
                  <button onClick={() => { setMenu(false); onSeries(); }} className="w-full text-left px-3 py-2 hover:bg-slate-50">Colocar contenedores en serie</button>
                  <button onClick={() => { setMenu(false); onSpots(); }} className="w-full text-left px-3 py-2 hover:bg-slate-50">Número de lugares…</button>
                  <button onClick={removeDivision} className="w-full text-left px-3 py-2 hover:bg-red-50 text-red-600">Dar de baja</button>
                </div>
              )}
            </div>
          </>
        }
      />
      <div className="p-4 grid grid-cols-4 sm:grid-cols-6 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
        {spots.map((l) => {
          const s = Number(l.stored || 0), r = Number(l.reserved || 0), used = s + r;
          const free = spotFree(l);
          const hasBox = !!l.box_code;
          const full = hasBox && free === 0;
          const pickable = selecting > 0 && hasBox && !full && (free == null || free >= selecting);
          const lit = highlight === l.id;
          const title = hasBox
            ? `Contenedor ${l.box_code} en ${l.code}\n${s} guardados, ${r} reservados${l.capacity != null ? `, capacidad ${l.capacity}` : ""}${selecting && free != null && free < selecting ? `\nSolo caben ${free}` : ""}`
            : `${l.code}: sin contenedor${used ? `\n${used} rollo(s) registrados aquí` : ""}`;
          return (
            <div key={l.id} className="relative group">
              <button
                disabled={busy || (selecting > 0 && !pickable)}
                onClick={() => (selecting > 0 ? onPick(l) : onSpot(l))}
                title={title}
                className={cx(
                  "relative w-full aspect-[4/3] rounded-xl text-left px-2 py-1.5 overflow-hidden transition",
                  hasBox ? "ring-1 bg-white ring-slate-200" : "border-2 border-dashed border-slate-200 bg-slate-50/50",
                  full && "bg-slate-50",
                  (pickable || !selecting) && "hover:ring-2 hover:ring-indigo-500 hover:shadow-md cursor-pointer",
                  selecting > 0 && !pickable && "opacity-40",
                  lit && "ring-2 ring-amber-400 shadow-md"
                )}
              >
                {hasBox && l.capacity != null && (
                  <>
                    <div className="absolute inset-x-0 bottom-0 bg-emerald-100" style={{ height: `${Math.min(100, (s / l.capacity) * 100)}%` }} />
                    <div className="absolute inset-x-0 bg-sky-100" style={{ bottom: `${Math.min(100, (s / l.capacity) * 100)}%`, height: `${Math.min(100, (r / l.capacity) * 100)}%` }} />
                  </>
                )}
                <div className="relative">
                  <div className="text-[10px] text-slate-400 leading-none">{l.code}</div>
                  {hasBox ? (
                    <>
                      <div className="text-sm font-bold text-slate-900 leading-tight mt-0.5">{l.box_code}</div>
                      <div className="text-[11px] text-slate-500 fab-tnum">
                        {l.capacity != null ? `${used}/${l.capacity}` : `${used} rollos`}
                        {full && <span className="ml-1 font-medium text-slate-400">lleno</span>}
                      </div>
                    </>
                  ) : (
                    <div className="text-[11px] text-slate-400 mt-1">{used ? `${used} sin cont.` : "Vacío"}</div>
                  )}
                </div>
              </button>
              {!hasBox && used === 0 && !selecting && (
                <button
                  onClick={() => removeSpot(l)}
                  className="absolute -top-1.5 -right-1.5 hidden group-hover:flex w-5 h-5 rounded-full bg-white ring-1 ring-slate-200 items-center justify-center text-slate-400 hover:text-red-600"
                  aria-label={`Eliminar el lugar ${l.code}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
        <button onClick={() => setAddOpen(true)} className="aspect-[4/3] rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-indigo-300 hover:text-indigo-600 flex items-center justify-center" aria-label="Agregar lugares">
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <div className="px-4 pb-3 flex flex-wrap gap-4 text-[11px] text-slate-500">
        <span><span className="inline-block w-2.5 h-2.5 rounded bg-emerald-100 ring-1 ring-emerald-200 mr-1" />Guardados</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded bg-sky-100 ring-1 ring-sky-200 mr-1" />Reservados</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded border border-dashed border-slate-300 mr-1" />Lugar sin contenedor</span>
      </div>
      <DivisionModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={reload} division={d} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Click on a spot: place a container, swap it for another, move it to another
// spot, or take it off the spot. A container taken off keeps its rolls and
// shows as «sin lugar» until it is placed again.
// ---------------------------------------------------------------------------
function SpotModal({ open, spot, division, allSpots, boxIndex, unplaced = [], boxes = [], catalog, onClose, onSaved }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [box, setBox] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setBox(""); setMoveTo(""); } }, [open, spot?.id]);
  if (!open || !spot) return null;

  const used = spotUsed(spot);
  const code = normBox(box);
  const elsewhere = code ? boxIndex.get(code) : null;
  const floating = code ? unplaced.find((b) => b.code.toUpperCase() === code) : null;
  const floatingRolls = floating ? Number(floating.stored || 0) + Number(floating.reserved || 0) : 0;
  const sameAsHere = code && spot.box_code && code === spot.box_code.toUpperCase();
  const known = !code || !boxes.length || boxes.some((b) => b.code.toUpperCase() === code);
  const unknownText = code && !known ? `${code} no es uno de los ${catalog?.count || 80} contenedores (${catalog?.first || "F01"}–${catalog?.last || "F80"}).` : null;
  const emptySpots = allSpots.filter((l) => !l.box_code && spotUsed(l) === 0 && l.id !== spot.id)
    .sort((a, b) => byNum(a.code, b.code));

  const send = async (body, okText) => {
    setSaving(true);
    try {
      await post("/boxes/place", body);
      toast({ kind: "ok", text: okText });
      notifyChange();
      onClose();
      await onSaved();
    } catch (e) { toast({ kind: "err", text: e.message }); }
    finally { setSaving(false); }
  };

  // Place (or swap in) the typed container on this spot.
  const place = async () => {
    if (!code) return toast({ kind: "warn", text: "Escriba el número del contenedor, por ejemplo F01." });
    if (sameAsHere) return toast({ kind: "info", text: `${code} ya está en ${spot.code}.` });
    if (unknownText) return toast({ kind: "warn", text: unknownText });
    const lines = [];
    if (elsewhere) lines.push(`${code} está registrado en ${elsewhere.code}; se mueve aquí${spotUsed(elsewhere) ? ` con sus ${spotUsed(elsewhere)} rollo(s)` : ""}.`);
    if (floating && floatingRolls) lines.push(`${code} no tenía lugar; sus ${floatingRolls} rollo(s) quedan aquí.`);
    if (spot.box_code) lines.push(`${spot.box_code} queda sin lugar${used ? ` con sus ${used} rollo(s)` : ""} hasta que se registre donde está.`);
    if (lines.length) {
      const ok = await confirm({ title: `¿${code} está en ${spot.code}?`, text: lines.join(" "), confirmLabel: `Sí, registrar en ${spot.code}` });
      if (!ok) return;
    }
    send(
      { pairs: [{ locationId: spot.id, boxCode: code }], displace: !!spot.box_code },
      elsewhere ? `Contenedor ${code} movido de ${elsewhere.code} a ${spot.code}.` : `Contenedor ${code} registrado en ${spot.code}.`
    );
  };

  const move = async () => {
    const dest = allSpots.find((l) => String(l.id) === String(moveTo));
    if (!dest) return;
    const ok = await confirm({
      title: `¿Mover ${spot.box_code} a ${dest.code}?`,
      text: used ? `Sus ${used} rollo(s) se mueven con el contenedor.` : "El contenedor está vacío.",
      confirmLabel: "Mover",
    });
    if (!ok) return;
    send({ pairs: [{ locationId: dest.id, boxCode: spot.box_code }] }, `Contenedor ${spot.box_code} movido a ${dest.code}.`);
  };

  const remove = async () => {
    const ok = await confirm({
      title: `¿Quitar ${spot.box_code} de ${spot.code}?`,
      text: used ? `${spot.box_code} conserva sus ${used} rollo(s) y queda «sin lugar» hasta que lo registre en otro lugar.` : "El lugar quedará vacío.",
      danger: true, confirmLabel: "Quitar",
    });
    if (!ok) return;
    send({ pairs: [{ locationId: spot.id, boxCode: "" }] }, `${spot.box_code} quitado de ${spot.code}.`);
  };

  const codeInput = (
    <input
      className={cx(inputCls, "w-full font-mono uppercase")}
      value={box}
      onChange={(e) => setBox(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") place(); }}
      placeholder="F01"
      autoFocus={!spot.box_code}
    />
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={spot.box_code ? `Contenedor ${spot.box_code} · lugar ${spot.code}` : `Lugar ${spot.code} · división ${division?.code || ""}`}
      footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}
    >
      {spot.box_code ? (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3 text-center">
            {[["Guardados", spot.stored], ["Reservados", spot.reserved], ["Libres", spotFree(spot) ?? "—"]].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-slate-50 p-3">
                <div className="text-xl font-semibold text-slate-900 fab-tnum">{v ?? 0}</div>
                <div className="text-xs text-slate-500">{k}</div>
              </div>
            ))}
          </div>
          <Field label="Mover el contenedor a otro lugar" hint="Solo lugares vacíos. Los rollos se mueven con el contenedor.">
            <div className="flex gap-2">
              <select className={cx(inputCls, "flex-1")} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                <option value="">Elegir lugar vacío…</option>
                {emptySpots.map((l) => <option key={l.id} value={l.id}>{l.code} — división {l.division.code}</option>)}
              </select>
              <Button icon={MoveRight} disabled={!moveTo} loading={saving} onClick={move}>Mover</Button>
            </div>
          </Field>
          <Field label="En este lugar ahora está otro contenedor" hint={`${spot.box_code} quedará sin lugar (con sus rollos) hasta que lo registre donde está.`}>
            <div className="flex gap-2">
              {codeInput}
              <Button variant="secondary" icon={ArrowLeftRight} disabled={!code || sameAsHere || !!unknownText} loading={saving} onClick={place}>Cambiar</Button>
            </div>
            {unknownText && <div className="mt-1 text-sm text-red-600">{unknownText}</div>}
          </Field>
          <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
            <span className="text-sm text-slate-500">{used ? `Si lo quita, conserva sus ${used} rollo(s) y queda sin lugar.` : "El contenedor está vacío."}</span>
            <Button variant="danger" icon={Trash2} loading={saving} onClick={remove}>Quitar del lugar</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {used > 0 && <Banner kind="warn">Hay {used} rollo(s) registrados en {spot.code} sin contenedor. Al colocar uno aquí quedarán dentro de él.</Banner>}
          <Field label="Contenedor que está en este lugar" hint={`Uno de los ${catalog?.count || 80} contenedores: ${catalog?.first || "F01"}–${catalog?.last || "F80"}`}>{codeInput}</Field>
          {unknownText && <div className="text-sm text-red-600">{unknownText}</div>}
          {(elsewhere || floating) && (
            <div className="text-sm text-amber-700">
              {elsewhere
                ? <>{code} está registrado en {elsewhere.code}{spotUsed(elsewhere) ? ` con ${spotUsed(elsewhere)} rollo(s)` : ""}. Si continúa, se mueve aquí.</>
                : <>{code} no tenía lugar{floatingRolls ? `; sus ${floatingRolls} rollo(s) quedarán aquí` : ""}.</>}
            </div>
          )}
          <div className="flex justify-end">
            <Button icon={Container} loading={saving} disabled={!code || !!unknownText} onClick={place}>
              {elsewhere ? `Mover ${code} aquí` : "Registrar contenedor"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Place a series: F01…F30 on A01…A30 (consecutive containers on consecutive
// spots). Spots that already have a container and containers that are already
// placed somewhere are skipped and shown in the preview.
// ---------------------------------------------------------------------------
function SeriesModal({ open, divisions, initialDivision, boxIndex, boxes = [], catalog, onClose, onSaved }) {
  const toast = useToast();
  const [divId, setDivId] = useState("");
  const [fromSpot, setFromSpot] = useState("");
  const [prefix, setPrefix] = useState("F");
  const [first, setFirst] = useState(1);
  const [count, setCount] = useState(30);
  const [saving, setSaving] = useState(false);

  const division = divisions.find((d) => String(d.id) === String(divId));
  const spots = useMemo(() => [...(division?.locations || [])].sort((a, b) => byNum(a.code, b.code)), [division]);

  // Defaults: the division clicked (or the first with free spots), its first
  // free spot, and the next container number not yet placed.
  useEffect(() => {
    if (!open) return;
    const d = initialDivision || divisions.find((x) => (x.locations || []).some((l) => !l.box_code)) || divisions[0];
    setDivId(d ? String(d.id) : "");
    // first free container of the catalog (no spot, no rolls)
    const pf = catalog?.prefix || "F";
    const free = boxes
      .filter((b) => !b.location_id && !Number(b.stored || 0) && !Number(b.reserved || 0))
      .map((b) => new RegExp(`^${pf}(\\d+)$`).exec(b.code)).filter(Boolean).map((m) => Number(m[1]))
      .sort((a, b) => a - b);
    setPrefix(pf);
    setFirst(free.length ? free[0] : 1);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const firstFree = spots.find((l) => !l.box_code);
    setFromSpot(firstFree ? String(firstFree.id) : spots[0] ? String(spots[0].id) : "");
  }, [divId, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const i = spots.findIndex((l) => String(l.id) === String(fromSpot));
    if (i >= 0) setCount(spots.length - i);
  }, [fromSpot]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = useMemo(() => {
    const start = spots.findIndex((l) => String(l.id) === String(fromSpot));
    if (start < 0) return [];
    const n = Math.max(0, Math.min(500, parseInt(count, 10) || 0));
    const p = (prefix || "").trim().toUpperCase();
    const f = Math.max(0, parseInt(first, 10) || 0);
    return spots.slice(start, start + n).map((l, i) => {
      const code = normBox(`${p}${f + i}`);
      const at = boxIndex.get(code);
      const exists = !boxes.length || boxes.some((b) => b.code.toUpperCase() === code);
      const skip = l.box_code ? `ya tiene ${l.box_code}` : !exists ? `${code} no existe` : at ? `${code} ya está en ${at.code}` : null;
      return { spot: l, code, skip };
    });
  }, [spots, fromSpot, count, prefix, first, boxIndex, boxes]);
  const ok = plan.filter((x) => !x.skip);

  const save = async () => {
    if (!ok.length) return toast({ kind: "warn", text: "No hay contenedores nuevos que colocar." });
    setSaving(true);
    try {
      await post("/boxes/place", { pairs: ok.map((x) => ({ locationId: x.spot.id, boxCode: x.code })), allowMove: false });
      toast({ kind: "ok", text: `${ok.length} contenedor(es) colocados: ${ok[0].code} → ${ok[0].spot.code}${ok.length > 1 ? ` … ${ok[ok.length - 1].code} → ${ok[ok.length - 1].spot.code}` : ""}.` });
      notifyChange();
      onClose();
      await onSaved();
    } catch (e) { toast({ kind: "err", text: e.message }); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Colocar contenedores en serie"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={Container} loading={saving} disabled={!ok.length} onClick={save}>Colocar {ok.length} contenedor(es)</Button></>}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Field label="División">
          <select className={cx(inputCls, "w-full")} value={divId} onChange={(e) => setDivId(e.target.value)}>
            {divisions.map((d) => <option key={d.id} value={d.id}>División {d.code}</option>)}
          </select>
        </Field>
        <Field label="Desde el lugar">
          <select className={cx(inputCls, "w-full")} value={fromSpot} onChange={(e) => setFromSpot(e.target.value)}>
            {spots.map((l) => <option key={l.id} value={l.id}>{l.code}{l.box_code ? ` (${l.box_code})` : ""}</option>)}
          </select>
        </Field>
        <Field label="Primer contenedor">
          <div className="flex">
            <input className={cx(inputCls, "w-14 rounded-r-none font-mono uppercase")} value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} aria-label="Prefijo" />
            <input type="number" min="0" className={cx(inputCls, "w-full rounded-l-none -ml-px fab-tnum")} value={first} onChange={(e) => setFirst(e.target.value)} aria-label="Número" />
          </div>
        </Field>
        <Field label="Cuántos">
          <input type="number" min="1" className={cx(inputCls, "w-full")} value={count} onChange={(e) => setCount(e.target.value)} />
        </Field>
      </div>

      <div className="mt-5">
        <div className="text-xs font-medium text-slate-600 mb-2">Vista previa · {ok.length} se colocarán{plan.length - ok.length ? `, ${plan.length - ok.length} se omiten` : ""}</div>
        {plan.length === 0 ? (
          <div className="text-sm text-slate-400">Elija una división con lugares.</div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 max-h-[40vh] overflow-y-auto">
            {plan.map((x) => (
              <div key={x.spot.id} title={x.skip || ""} className={cx("rounded-lg px-2 py-1.5 text-sm ring-1", x.skip ? "bg-slate-50 ring-slate-200 text-slate-400" : "bg-white ring-indigo-200")}>
                <div className="text-[10px] leading-none">{x.spot.code}</div>
                <div className={cx("font-mono font-semibold", x.skip ? "line-through" : "text-slate-900")}>{x.code}</div>
                {x.skip && <div className="text-[10px] truncate">{x.skip}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// New division (A…E) with its spots, or more spots for an existing one.
// ---------------------------------------------------------------------------
function DivisionModal({ open, onClose, onSaved, division = null, defaultCount = 14, boxCapacity = 50 }) {
  const toast = useToast();
  // Spots are named division letter + 2 digits (A01…A14).
  const [form, setForm] = useState({ code: "", name: "", count: defaultCount, prefix: "", capacity: 100 });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setForm({ code: "", name: "", count: division ? 1 : defaultCount, prefix: "", capacity: 100 }); }, [open, division, defaultCount]);

  const prefixUsed = (form.prefix || (division ? division.code : form.code) || "").toUpperCase();
  const preview = useMemo(() => {
    const start = division ? (division.locations || []).length : 0;
    const n = Math.min(500, parseInt(form.count, 10) || 0);
    if (!n || !prefixUsed) return "";
    const a = `${prefixUsed}${String(start + 1).padStart(2, "0")}`;
    const b = `${prefixUsed}${String(start + n).padStart(2, "0")}`;
    return n === 1 ? a : `${a} … ${b}`;
  }, [form.count, prefixUsed, division]);

  const save = async () => {
    if (!division && !form.code.trim()) return toast({ kind: "warn", text: "Escriba la letra de la división." });
    setSaving(true);
    try {
      const body = { ...form, prefix: prefixUsed, separator: "", capacity: form.capacity || null };
      const d = division ? await post(`/containers/${division.id}/locations`, body) : await post("/containers", body);
      toast({ kind: "ok", text: division ? `${d.locationsAdded} lugar(es) agregados a la división ${division.code}.` : `División ${d.container.code} creada con ${d.locationsAdded} lugares.` });
      onClose();
      await onSaved();
    } catch (e) { toast({ kind: "err", text: e.message }); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={division ? `Agregar lugares a la división ${division.code}` : "Nueva división"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={Plus} loading={saving} onClick={save}>{division ? "Agregar lugares" : "Crear división"}</Button></>}
    >
      <div className="grid grid-cols-2 gap-4">
        {!division && (
          <>
            <Field label="Letra de la división"><input className={inputCls} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="A" autoFocus /></Field>
            <Field label="Nombre (opcional)"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Patio norte" /></Field>
          </>
        )}
        <Field label="Número de lugares"><input type="number" min="0" className={inputCls} value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} /></Field>
        <Field label="Prefijo del lugar" hint="Vacío = letra de la división"><input className={inputCls} value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value.toUpperCase() })} placeholder={division ? division.code : form.code || "A"} /></Field>
        <div className="col-span-2 text-sm text-slate-500">Cada contenedor guarda hasta <b className="text-slate-800">{boxCapacity} rollos</b> (igual para todos).</div>
      </div>
      {preview && <div className="mt-4 text-sm text-slate-500">Se crearán los lugares <span className="font-mono text-slate-800">{preview}</span>. Después coloque en ellos los contenedores (F01…).</div>}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// «Lugares por división»: every division gets exactly A01…A14 (or the number
// chosen). Spots outside the range are removed only when empty; the preview
// shows what changes and which spots still hold a container or rolls.
// ---------------------------------------------------------------------------
const rangeText = (codes) => {
  const parsed = codes.map((c) => /^(.*?)(\d+)$/.exec(c)).filter(Boolean).map((m) => ({ p: m[1], n: Number(m[2]), c: m[0] }))
    .sort((a, b) => (a.p === b.p ? a.n - b.n : a.p.localeCompare(b.p)));
  const out = [];
  for (let i = 0; i < parsed.length; i++) {
    let j = i;
    while (j + 1 < parsed.length && parsed[j + 1].p === parsed[i].p && parsed[j + 1].n === parsed[j].n + 1) j++;
    out.push(j > i ? `${parsed[i].c}–${parsed[j].c}` : parsed[i].c);
    i = j;
  }
  const odd = codes.filter((c) => !/\d$/.test(c));
  return [...out, ...odd].join(", ");
};

function SpotsModal({ open, divisions, initial, defaultCount = 14, onClose, onSaved }) {
  const toast = useToast();
  const [count, setCount] = useState(defaultCount);
  const [chosen, setChosen] = useState(new Set());
  const [preview, setPreview] = useState({});
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCount(defaultCount);
    setChosen(new Set(initial ? [String(initial.id)] : divisions.map((d) => String(d.id))));
    setPreview({});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ask the server what would change (dry run), per division.
  useEffect(() => {
    if (!open) return undefined;
    const n = parseInt(count, 10);
    if (!(n >= 1 && n <= 99)) { setPreview({}); return undefined; }
    let alive = true;
    const h = setTimeout(async () => {
      setChecking(true);
      const out = {};
      for (const d of divisions) {
        try { out[d.id] = await post(`/containers/${d.id}/spots`, { count: n, dryRun: true }); }
        catch (e) { out[d.id] = { error: e.message }; }
      }
      if (alive) { setPreview(out); setChecking(false); }
    }, 250);
    return () => { alive = false; clearTimeout(h); };
  }, [open, count, divisions]);

  const toggle = (id) => setChosen((p) => { const x = new Set(p); x.has(id) ? x.delete(id) : x.add(id); return x; });
  const selected = divisions.filter((d) => chosen.has(String(d.id)));
  const ready = selected.filter((d) => preview[d.id] && !preview[d.id].error && !preview[d.id].blocked?.length
    && (preview[d.id].add.length || preview[d.id].remove.length));
  const blocked = selected.filter((d) => preview[d.id]?.blocked?.length);

  const apply = async () => {
    setSaving(true);
    let done = 0;
    try {
      for (const d of ready) { await post(`/containers/${d.id}/spots`, { count: parseInt(count, 10) }); done++; }
      toast({
        kind: blocked.length ? "warn" : "ok",
        text: `${done} división(es) con ${count} lugares.${blocked.length ? ` ${blocked.map((d) => d.code).join(", ")} sin cambios: tienen contenedores o rollos fuera del rango.` : ""}`,
      });
      notifyChange();
      onClose();
      await onSaved();
    } catch (e) { toast({ kind: "err", text: e.message }); await onSaved(); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Lugares por división"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button icon={MapPin} loading={saving} disabled={!ready.length || checking} onClick={apply}>
          {ready.length ? `Aplicar a ${ready.length} división(es)` : "Sin cambios que aplicar"}
        </Button>
      </>}
    >
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Lugares en cada división">
          <input type="number" min="1" max="99" className={cx(inputCls, "w-28")} value={count} onChange={(e) => setCount(e.target.value)} />
        </Field>
        <div className="text-sm text-slate-500 pb-2">
          Quedan <b className="font-mono text-slate-800">A01–A{String(parseInt(count, 10) || 0).padStart(2, "0")}</b>, B01–B{String(parseInt(count, 10) || 0).padStart(2, "0")}…
          Los lugares de más se eliminan solo si están vacíos.
        </div>
      </div>

      <ul className="mt-4 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
        {divisions.map((d) => {
          const pv = preview[d.id];
          const on = chosen.has(String(d.id));
          const same = pv && !pv.error && !pv.add.length && !pv.remove.length;
          return (
            <li key={d.id} className={cx("px-4 py-3 flex items-start gap-3", !on && "opacity-50")}>
              <input type="checkbox" className="mt-1 rounded border-slate-300 text-indigo-600" checked={on} onChange={() => toggle(String(d.id))} aria-label={`División ${d.code}`} />
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-semibold text-slate-900">
                  División {d.code}
                  <span className="font-normal text-slate-500"> · {(d.locations || []).length} lugares{pv && !pv.error && !same ? ` → ${pv.count}` : ""}</span>
                </div>
                {!pv ? <div className="text-slate-400">Revisando…</div>
                  : pv.error ? <div className="text-red-600">{pv.error}</div>
                  : same ? <div className="text-emerald-700">Ya tiene {pv.count} lugares.</div>
                  : (
                    <div className="space-y-0.5">
                      {pv.remove.length > 0 && <div className="text-slate-600">Se quitan {pv.remove.length}: <span className="font-mono">{rangeText(pv.remove)}</span></div>}
                      {pv.add.length > 0 && <div className="text-slate-600">Se agregan {pv.add.length}: <span className="font-mono">{rangeText(pv.add)}</span></div>}
                      {pv.release?.length > 0 && (
                        <div className="text-slate-600">Quedan libres (vacíos): <span className="font-mono">{rangeText(pv.release)}</span></div>
                      )}
                      {pv.blocked.length > 0 && (
                        <div className="text-red-600">
                          No se puede todavía: {pv.blocked.length} lugar(es) con rollos —{" "}
                          <span className="font-mono">{rangeText(pv.blocked.map((b) => b.code))}</span>
                          {pv.blocked.some((b) => b.box_code) && <> (<span className="font-mono">{rangeText(pv.blocked.filter((b) => b.box_code).map((b) => b.box_code))}</span>)</>}
                          , {pv.blocked.reduce((a, b) => a + b.rolls, 0)} rollos.
                          {" "}Mueva esos contenedores a un lugar libre dentro de {d.code}01–{d.code}{String(pv.count).padStart(2, "0")} (o de otra división) y vuelva a intentar.
                        </div>
                      )}
                    </div>
                  )}
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}