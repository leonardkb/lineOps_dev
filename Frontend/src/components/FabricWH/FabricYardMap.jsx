// components/FabricWH/FabricYardMap.jsx
// Almacén de Tela — Mapa del patio (inside Ubicaciones).
//
//   División (A–E)  →  Lugar (A01…)  →  Contenedor (F01…F80)  →  Rollos
//
// • One division at a time; its spots are laid out to FILL the available
//   height and width (columns are computed from the real size), so the page
//   never scrolls — laptop, desktop or phone.
// • Each spot shows its container, how full it is (guardados / inspección /
//   reservados) and warnings (rolls over the aging limit).
// • Selecting a container opens its detail: a slot view where every square is
//   a roll, the roll list (filter, group by PO / tela) and the full data of a
//   roll. Desktop: side panel. Phone: bottom sheet.
// • Search finds a container, a spot or a ROLL and jumps straight to it.
// • Keyboard: arrows move between spots, Esc closes the detail.
// • highlight (spot id, from «Con escáner»): the map jumps to that spot's
//   division, opens its detail and marks it as the scanner's target.
//   onSpotClick (optional) is told which spot was clicked, so the scanner can
//   take it as the spot without scanning its label.
import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import {
  Search, X, ScanLine, Pencil, ChevronLeft, Clock, Container, MapPin, History,
  PackageOpen, Layers, Boxes,
} from "lucide-react";
import {
  api, num, cx, Card, Button, StatusBadge, DaysCell, fmtDateTime, useRollDrawer,
} from "./fabricShared";

const DIV_KEY = "fabricYardDivision";
const byNum = (a, b) => String(a).localeCompare(String(b), "es", { numeric: true });
const n0 = (v) => Number(v || 0);
const used = (l) => n0(l.stored) + n0(l.reserved) + n0(l.inspection);

// ---------------------------------------------------------------------------
// Layout hooks
// ---------------------------------------------------------------------------

// Height from the element's top to the bottom of the window.
// Returns [callbackRef, height] — a callback ref, so it measures as soon as the
// element exists (the map appears only after the data has loaded).
function useFitHeight(min = 360, gap = 8) {
  const [el, setEl] = useState(null);
  const [h, setH] = useState(null);
  useLayoutEffect(() => {
    if (!el) return undefined;
    const calc = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      // Space the surrounding layout keeps below us (padding/borders of the parents).
      let below = 0;
      for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        below += (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
      }
      setH(Math.max(min, Math.floor(window.innerHeight - top - below - gap)));
    };
    calc();
    const t = setTimeout(calc, 60);
    window.addEventListener("resize", calc);
    window.addEventListener("orientationchange", calc);
    // the header above can change height (buttons wrapping, banners)
    const ro = new ResizeObserver(calc);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => { clearTimeout(t); ro.disconnect(); window.removeEventListener("resize", calc); window.removeEventListener("orientationchange", calc); };
  }, [el, min, gap]);
  return [setEl, h];
}

// Best columns × rows so n cells fill the box with cells close to 4:3.
function useGridFit(ref, n, gap = 8) {
  const [fit, setFit] = useState({ cols: 6, rows: Math.ceil(n / 6) || 1, cw: 110, ch: 84 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const calc = () => {
      const W = el.clientWidth, H = el.clientHeight;
      if (!W || !H || !n) return;
      let best = null;
      for (let cols = 2; cols <= Math.min(12, Math.max(2, n)); cols++) {
        const rows = Math.ceil(n / cols);
        const cw = (W - gap * (cols - 1)) / cols;
        const ch = (H - gap * (rows - 1)) / rows;
        const fits = cw >= 54 && ch >= 40;
        const score = fits ? Math.abs(Math.log(cw / ch / 1.3)) : 100 - Math.min(cw / 54, ch / 40);
        if (!best || score < best.score) best = { cols, rows, cw, ch, score, fits };
      }
      setFit(best);
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, n, gap]);
  return fit;
}

const isMobile = () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;

// Screen width class, decided in JS so the layout does not depend on the
// project's Tailwind setup (breakpoints / custom-value classes).
function useViewport() {
  const get = () => (typeof window === "undefined" ? 1280 : window.innerWidth);
  const [w, setW] = useState(get);
  useEffect(() => {
    const on = () => setW(get());
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => { window.removeEventListener("resize", on); window.removeEventListener("orientationchange", on); };
  }, []);
  return { desktop: w >= 1024, panelW: w >= 1280 ? 400 : 360 };
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
export default function FabricYardMap({
  divisions = [], unplaced = [], agingDays = 30, version = 0,
  onScanHere = () => {}, onEditSpot = () => {}, onEditSpots = null,
  highlight = null, onSpotClick = null,
}) {
  const [rootRef, height] = useFitHeight();
  const vp = useViewport();
  const [divKey, setDivKey] = useState(() => sessionStorage.getItem(DIV_KEY) || "");
  const [sel, setSel] = useState(null);          // { kind: "spot", id } | { kind: "box", id }
  const [focusRollId, setFocusRollId] = useState(null);
  const [colorBy, setColorBy] = useState("fill"); // fill | age

  useEffect(() => { if (divKey) sessionStorage.setItem(DIV_KEY, divKey); }, [divKey]);

  // Per-division totals for the tabs and the header.
  const stats = useMemo(() => {
    const m = new Map();
    for (const d of divisions) {
      const ls = d.locations || [];
      m.set(String(d.id), {
        spots: ls.length,
        placed: ls.filter((l) => l.box_id).length,
        stored: ls.reduce((a, l) => a + n0(l.stored), 0),
        reserved: ls.reduce((a, l) => a + n0(l.reserved), 0),
        inspection: ls.reduce((a, l) => a + n0(l.inspection), 0),
        aged: ls.reduce((a, l) => a + n0(l.aged), 0),
        yards: ls.reduce((a, l) => a + n0(l.yards), 0),
      });
    }
    return m;
  }, [divisions]);

  const lost = useMemo(() => unplaced.filter((b) => n0(b.stored) + n0(b.reserved) + n0(b.inspection) > 0), [unplaced]);
  const current = divKey === "lost" && lost.length ? "lost" : divisions.find((d) => String(d.id) === divKey) || divisions[0] || null;
  const spots = useMemo(
    () => (current && current !== "lost" ? [...(current.locations || [])].sort((a, b) => byNum(a.code, b.code)) : []),
    [current]
  );

  // What is selected (looked up again after every reload so numbers stay fresh).
  const target = useMemo(() => {
    if (!sel) return null;
    if (sel.kind === "box") {
      const b = unplaced.find((x) => String(x.id) === String(sel.id));
      return b ? { box: b } : null;
    }
    for (const d of divisions) {
      const l = (d.locations || []).find((x) => String(x.id) === String(sel.id));
      if (l) return { spot: l, division: d };
    }
    return null;
  }, [sel, divisions, unplaced]);

  const choose = useCallback((next, rollId = null) => { setSel(next); setFocusRollId(rollId); }, []);
  const close = useCallback(() => { setSel(null); setFocusRollId(null); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Follow the scanner: show the spot it is working on.
  useEffect(() => {
    if (highlight == null) return;
    const d = divisions.find((x) => (x.locations || []).some((l) => String(l.id) === String(highlight)));
    if (!d) return;
    setDivKey(String(d.id));
    choose({ kind: "spot", id: highlight });
    requestAnimationFrame(() => document.getElementById(`yard-spot-${highlight}`)?.scrollIntoView({ block: "nearest" }));
  }, [highlight]); // eslint-disable-line react-hooks/exhaustive-deps

  const goDivision = (key) => { setDivKey(String(key)); if (!isMobile()) close(); };

  // Arrow keys move between spots of the division.
  const onGridKey = (e, cols) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(e.key) || !spots.length) return;
    e.preventDefault();
    const i = Math.max(0, spots.findIndex((l) => sel?.kind === "spot" && String(l.id) === String(sel.id)));
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    const next = spots[Math.min(spots.length - 1, Math.max(0, i + d))];
    if (next) {
      choose({ kind: "spot", id: next.id });
      document.getElementById(`yard-spot-${next.id}`)?.focus();
    }
  };

  if (!divisions.length) {
    return (
      <Card className="p-10 text-center text-slate-500">
        <Layers className="w-8 h-8 mx-auto text-slate-300" />
        <div className="mt-2 font-medium text-slate-700">Aún no hay divisiones</div>
        <div className="text-sm">Cree una división (A, B, C…) con «Nueva división» para ver el mapa.</div>
      </Card>
    );
  }

  const st = current && current !== "lost" ? stats.get(String(current.id)) : null;

  return (
    <div ref={rootRef} style={height ? { height } : undefined} className="flex flex-col gap-3 min-h-0">
      {/* Toolbar */}
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 flex-shrink-0">
        <YardSearch divisions={divisions} unplaced={unplaced} onPick={(r) => {
          if (r.divisionId != null) setDivKey(String(r.divisionId));
          if (r.lost) setDivKey("lost");
          choose(r.sel, r.rollId || null);
        }} />
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar order-3 sm:order-none w-full sm:w-auto sm:flex-1 min-w-0">
          {divisions.map((d) => {
            const s = stats.get(String(d.id));
            const on = current !== "lost" && current && String(current.id) === String(d.id);
            return (
              <button
                key={d.id}
                onClick={() => goDivision(d.id)}
                className={cx("flex-shrink-0 rounded-xl px-3 py-1.5 text-left ring-1 transition",
                  on ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-200 hover:ring-slate-400")}
              >
                <div className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
                  División {d.code}
                  {s.aged > 0 && <span className={cx("w-1.5 h-1.5 rounded-full", on ? "bg-red-400" : "bg-red-500")} title={`${s.aged} rollo(s) con más de ${agingDays} días`} />}
                </div>
                <div className={cx("fab-t11 leading-tight fab-tnum", on ? "text-slate-300" : "text-slate-500")}>
                  {s.placed} cont. · {s.stored + s.inspection} rollos{s.reserved ? ` · ${s.reserved} res.` : ""}
                </div>
              </button>
            );
          })}
          {lost.length > 0 && (
            <button
              onClick={() => goDivision("lost")}
              className={cx("flex-shrink-0 rounded-xl px-3 py-1.5 text-left ring-1 transition",
                current === "lost" ? "bg-amber-600 text-white ring-amber-600" : "bg-amber-50 text-amber-800 ring-amber-300 hover:ring-amber-500")}
            >
              <div className="text-sm font-semibold leading-tight">Sin lugar</div>
              <div className="fab-t11 leading-tight fab-tnum opacity-80">{lost.length} contenedor(es)</div>
            </button>
          )}
        </div>
        <div className="inline-flex p-0.5 rounded-lg bg-slate-100 text-xs flex-shrink-0" role="tablist" aria-label="Color del mapa">
          {[["fill", "Ocupación"], ["age", "Antigüedad"]].map(([k, label]) => (
            <button key={k} onClick={() => setColorBy(k)}
              className={cx("px-2.5 py-1 rounded-md font-medium transition", colorBy === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div
        className="flex-1 min-h-0"
        style={{
          display: "grid",
          gridTemplateRows: "minmax(0, 1fr)",
          gridTemplateColumns: vp.desktop ? `minmax(0, 1fr) ${vp.panelW}px` : "minmax(0, 1fr)",
          gap: vp.desktop ? 16 : 12,
        }}
      >
        <Card className="min-h-0 flex flex-col overflow-hidden">
          {current === "lost" ? (
            <LostBoxes boxes={lost} sel={sel} onPick={(b) => choose({ kind: "box", id: b.id })} />
          ) : (
            <>
              <div className="px-3 sm:px-4 py-2 sm:py-2.5 border-b border-slate-100 flex items-center gap-x-4 gap-y-1 flex-shrink-0 min-w-0">
                <div className="font-semibold text-slate-900 flex-shrink-0">División {current.code}<span className="hidden sm:inline">{current.name && <span className="font-normal text-slate-500"> · {current.name}</span>}</span></div>
                <div className="flex gap-x-3 text-xs text-slate-500 fab-tnum whitespace-nowrap overflow-x-auto no-scrollbar min-w-0">
                  <span>
                    {st.placed}/{st.spots} con contenedor
                    {onEditSpots && (
                      <button onClick={() => onEditSpots(current)} className="ml-1.5 text-indigo-600 hover:text-indigo-800 font-medium" title="Cambiar el número de lugares de la división">
                        · {st.spots} lugares
                      </button>
                    )}
                  </span>
                  <span><Dot c="bg-emerald-500" />{st.stored} guardados</span>
                  {st.inspection > 0 && <span><Dot c="bg-violet-400" />{st.inspection} inspección</span>}
                  <span><Dot c="bg-sky-300" />{st.reserved} reservados</span>
                  <span>{num(st.yards, 0)} yd</span>
                  {st.aged > 0 && <span className="text-red-600 font-medium"><Clock className="w-3 h-3 inline -mt-0.5 mr-0.5" />{st.aged} &gt; {agingDays} días</span>}
                </div>
              </div>
              <SpotGrid
                spots={spots}
                sel={sel}
                colorBy={colorBy}
                agingDays={agingDays}
                highlight={highlight}
                onPick={(l) => { choose({ kind: "spot", id: l.id }); onSpotClick?.(l, current); }}
                onKey={onGridKey}
              />
            </>
          )}
        </Card>

        {/* Detail: side panel on desktop, bottom sheet on phones */}
        {target ? (
          <>
            {!vp.desktop && <div className="fixed inset-0 bg-slate-900/40 fab-fade" style={{ zIndex: 40 }} onClick={close} aria-hidden />}
            <aside
              className={cx("bg-white ring-1 ring-slate-200 flex flex-col overflow-hidden fab-pop min-h-0",
                vp.desktop ? "rounded-2xl" : "rounded-t-2xl shadow-2xl")}
              style={vp.desktop ? undefined : { position: "fixed", left: 0, right: 0, bottom: 0, height: "82vh", maxHeight: "82dvh", zIndex: 50 }}
              aria-label="Detalle del contenedor"
            >
              {!vp.desktop && <div className="flex justify-center pt-2 flex-shrink-0"><span className="w-10 h-1 rounded-full bg-slate-300" /></div>}
              <ContainerPanel
                target={target}
                agingDays={agingDays}
                version={version}
                focusRollId={focusRollId}
                onClose={close}
                onScanHere={onScanHere}
                onEditSpot={onEditSpot}
              />
            </aside>
          </>
        ) : (
          vp.desktop && <aside className="flex min-h-0 rounded-2xl bg-white ring-1 ring-slate-200 flex-col overflow-hidden">
            {current === "lost"
              ? <PanelHint />
              : <DivisionSummary division={current} spots={spots} agingDays={agingDays} onPick={(l) => choose({ kind: "spot", id: l.id })} />}
          </aside>
        )}
      </div>
    </div>
  );
}

const Dot = ({ c }) => <span className={cx("inline-block w-2 h-2 rounded-full mr-1 align-middle", c)} />;

// ---------------------------------------------------------------------------
// The spots of one division, fitted to the available space
// ---------------------------------------------------------------------------
function SpotGrid({ spots, sel, colorBy, agingDays, highlight, onPick, onKey }) {
  const ref = useRef(null);
  const fit = useGridFit(ref, spots.length);
  // What fits in a cell: compact = code + bar; then fabric line; then yards.
  const compact = fit.ch < 70 || fit.cw < 88;
  const showFabric = !compact && fit.ch >= 88;
  const roomy = showFabric && fit.ch >= 108;
  return (
    <div className="flex-1 min-h-0 p-2.5 sm:p-3">
      <div
        ref={ref}
        role="grid"
        aria-label="Lugares de la división"
        onKeyDown={(e) => onKey(e, fit.cols)}
        className={cx("h-full grid gap-2", !fit.fits && "overflow-auto")}
        style={{ gridTemplateColumns: `repeat(${fit.cols}, minmax(0, 1fr))`, gridTemplateRows: fit.fits ? `repeat(${fit.rows}, minmax(0, 1fr))` : `repeat(${fit.rows}, 56px)` }}
      >
        {spots.map((l) => (
          <SpotCell
            key={l.id}
            l={l}
            compact={compact}
            showFabric={showFabric}
            roomy={roomy}
            selected={sel?.kind === "spot" && String(sel.id) === String(l.id)}
            scanning={highlight != null && String(highlight) === String(l.id)}
            colorBy={colorBy}
            agingDays={agingDays}
            onClick={() => onPick(l)}
          />
        ))}
      </div>
    </div>
  );
}

function SpotCell({ l, compact, showFabric, roomy, selected, scanning, colorBy, agingDays, onClick }) {
  const s = n0(l.stored), r = n0(l.reserved), i = n0(l.inspection), u = s + r + i;
  const cap = l.capacity != null ? Number(l.capacity) : null;
  const scale = cap || Math.max(u, 1);
  const hasBox = !!l.box_id;
  const pct = cap ? Math.round((u / cap) * 100) : null;
  const oldest = l.oldest_days;
  const ageTone = colorBy === "age" && hasBox && s > 0
    ? oldest >= agingDays ? "bg-red-50 ring-red-200" : oldest >= agingDays * 0.7 ? "bg-amber-50 ring-amber-200" : "bg-emerald-50/60 ring-emerald-200"
    : null;
  const title = hasBox
    ? `${l.box_code} en ${l.code}\n${s} guardados · ${i} en inspección · ${r} reservados${cap ? ` · capacidad ${cap}` : ""}${oldest != null ? `\nRollo más antiguo: ${oldest} días` : ""}`
    : `${l.code}: sin contenedor${u ? ` (${u} rollos registrados)` : ""}`;

  return (
    <button
      id={`yard-spot-${l.id}`}
      role="gridcell"
      aria-selected={selected}
      aria-current={scanning ? "step" : undefined}
      onClick={onClick}
      title={title}
      className={cx(
        "relative min-w-0 min-h-0 rounded-xl text-left transition flex flex-col overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
        compact ? "px-1.5 py-1" : "px-2.5 py-2",
        scanning && "ring-offset-2 ring-offset-indigo-100",
        selected || scanning
          ? cx("ring-2 ring-indigo-600 shadow-lg z-10", hasBox ? (ageTone ? ageTone.split(" ")[0] : "bg-white") : "bg-slate-50")
          : hasBox ? cx("ring-1", ageTone || "bg-white ring-slate-200") : "border-2 border-dashed border-slate-200 bg-slate-50",
        !selected && !scanning && "hover:ring-2 hover:ring-indigo-400 hover:shadow-md"
      )}
    >
      {scanning && (
        <span className="absolute top-1 right-1 flex items-center gap-1 rounded-md bg-indigo-600 text-white px-1.5 py-0.5 fab-t9 font-semibold motion-safe:animate-pulse" title="El escáner espera el contenedor de este lugar">
          <ScanLine className="w-2.5 h-2.5" />{!compact && "Escaneando"}
        </span>
      )}
      <div className="flex items-center gap-1 min-w-0 flex-shrink-0">
        <span className={cx("text-slate-400 truncate", compact ? "fab-t9" : "fab-t11")}>{l.code}</span>
        <span className={cx("ml-auto flex items-center gap-0.5 flex-shrink-0", scanning && "invisible")}>
          {n0(l.aged) > 0 && <span className="w-1.5 h-1.5 rounded-full bg-red-500" title={`${l.aged} con más de ${agingDays} días`} />}
          {i > 0 && <span className="w-1.5 h-1.5 rounded-full bg-violet-500" title={`${i} en inspección`} />}
        </span>
      </div>
      {hasBox ? (
        <>
          <div className={cx("font-bold text-slate-900 leading-tight truncate flex-shrink-0", compact ? "text-xs" : "text-base")}>{l.box_code}</div>
          {showFabric && l.main_fabric && (
            <div className="fab-t11 text-slate-500 truncate flex-shrink-0" title={l.fabrics > 1 ? `${l.fabrics} telas` : l.main_fabric}>
              {l.main_fabric}{l.fabrics > 1 && <span className="text-slate-400"> +{l.fabrics - 1}</span>}
            </div>
          )}
          {roomy && n0(l.yards) > 0 && <div className="fab-t11 text-slate-400 fab-tnum flex-shrink-0">{num(l.yards, 0)} yd</div>}
          <div className="mt-auto">
            {!compact && (
              <div className="flex items-baseline justify-between fab-t11 text-slate-500 fab-tnum">
                <span>{u}{cap ? `/${cap}` : " rollos"}</span>
                {pct != null && <span className={cx(pct >= 100 ? "text-red-600 font-semibold" : pct >= 90 ? "text-amber-600" : "")}>{pct}%</span>}
              </div>
            )}
            <div className={cx("w-full rounded-full bg-slate-100 overflow-hidden flex", compact ? "h-1 mt-0.5" : "h-1.5 mt-1")}>
              <div className="bg-emerald-500" style={{ width: `${(s / scale) * 100}%` }} />
              <div className="bg-violet-400" style={{ width: `${(i / scale) * 100}%` }} />
              <div className="bg-sky-300" style={{ width: `${(r / scale) * 100}%` }} />
            </div>
          </div>
        </>
      ) : (
        <div className={cx("text-slate-400 mt-auto", compact ? "fab-t10" : "text-xs")}>{u ? `${u} sin cont.` : "Vacío"}</div>
      )}
    </button>
  );
}

function LostBoxes({ boxes, sel, onPick }) {
  return (
    <div className="flex-1 min-h-0 overflow-auto p-4">
      <div className="text-sm text-amber-800 bg-amber-50 rounded-xl px-3 py-2 mb-3">
        Estos contenedores tienen rollos pero falta registrar dónde están. Escanee el lugar y después el contenedor para ubicarlos.
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 xl:grid-cols-6 gap-2">
        {boxes.map((b) => {
          const on = sel?.kind === "box" && String(sel.id) === String(b.id);
          return (
            <button key={b.id} onClick={() => onPick(b)}
              className={cx("rounded-xl px-2.5 py-2 text-left bg-amber-50", on ? "ring-2 ring-indigo-600" : "ring-1 ring-amber-300 hover:ring-2 hover:ring-amber-500")}>
              <div className="font-bold text-slate-900">{b.code}</div>
              <div className="fab-t11 text-slate-600 fab-tnum">{n0(b.stored) + n0(b.reserved) + n0(b.inspection)} rollos</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search: container, spot or roll → jump to it
// ---------------------------------------------------------------------------
function YardSearch({ divisions, unplaced, onPick }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [rolls, setRolls] = useState([]);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);

  const t = q.trim().toUpperCase().replace(/[\s-]+/g, "");
  const local = useMemo(() => {
    if (!t) return [];
    const out = [];
    for (const d of divisions) {
      for (const l of d.locations || []) {
        const box = String(l.box_code || "").toUpperCase(), code = String(l.code).toUpperCase();
        if ((box && box.includes(t)) || code.includes(t)) {
          out.push({
            key: `s${l.id}`, kind: "spot", sel: { kind: "spot", id: l.id }, divisionId: d.id,
            title: l.box_code ? `${l.box_code}` : `${l.code}`,
            sub: l.box_code ? `en ${l.code} · División ${d.code} · ${used(l)} rollos` : `Lugar vacío · División ${d.code}`,
            exact: box === t || code === t,
          });
        }
      }
    }
    for (const b of unplaced) {
      if (String(b.code).toUpperCase().includes(t) && n0(b.stored) + n0(b.reserved) + n0(b.inspection) > 0) {
        out.push({ key: `b${b.id}`, kind: "box", sel: { kind: "box", id: b.id }, lost: true, title: b.code, sub: "Sin lugar registrado", exact: String(b.code).toUpperCase() === t });
      }
    }
    return out.sort((a, b) => (b.exact - a.exact) || byNum(a.title, b.title)).slice(0, 6);
  }, [t, divisions, unplaced]);

  // Rolls: ask the server (debounced)
  useEffect(() => {
    if (q.trim().length < 3) { setRolls([]); return undefined; }
    const h = setTimeout(async () => {
      try {
        const d = await api(`/rolls?q=${encodeURIComponent(q.trim())}&status=in_stock,assigned,at_inspection&limit=8`);
        setRolls((d.rolls || []).slice(0, 8));
      } catch { setRolls([]); }
    }, 250);
    return () => clearTimeout(h);
  }, [q]);

  const rollItems = rolls.map((r) => ({
    key: `r${r.id}`, kind: "roll", rollId: r.id,
    sel: r.location_id ? { kind: "spot", id: r.location_id } : r.box_id ? { kind: "box", id: r.box_id } : null,
    divisionId: r.container_id, lost: !r.location_id && !!r.box_id,
    title: r.roll_no,
    sub: `${[r.fabric_name, r.color].filter(Boolean).join(" · ") || "Rollo"} — ${r.box_code ? `${r.box_code}${r.location_code ? ` · ${r.location_code}` : " (sin lugar)"}` : r.status === "requested" ? "En Skytex" : "sin contenedor"}`,
  })).filter((x) => x.sel);
  const items = [...local, ...rollItems];

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    const off = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, []);

  const pick = (it) => { onPick(it); setOpen(false); setQ(""); };

  return (
    <div ref={boxRef} className="relative flex-1 min-w-0 sm:flex-none sm:w-64">
      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          if (e.key === "Enter" && items[active]) { e.preventDefault(); pick(items[active]); }
          if (e.key === "Escape") { setOpen(false); e.stopPropagation(); }
        }}
        placeholder="Buscar contenedor o rollo…"
        className="w-full pl-9 pr-8 py-2 rounded-xl bg-white ring-1 ring-inset ring-slate-300 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        aria-label="Buscar contenedor, lugar o rollo"
      />
      {q && <button onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700" aria-label="Borrar búsqueda"><X className="w-3.5 h-3.5" /></button>}
      {open && t && (
        <div className="absolute z-50 mt-1 w-full sm:w-96 bg-white rounded-xl shadow-xl ring-1 ring-slate-900/10 py-1 max-h-80 overflow-auto">
          {items.length === 0 ? (
            <div className="px-3 py-3 text-sm text-slate-400">{q.trim().length < 3 ? "Siga escribiendo para buscar rollos…" : "Sin resultados"}</div>
          ) : items.map((it, i) => (
            <button key={it.key} onMouseEnter={() => setActive(i)} onClick={() => pick(it)}
              className={cx("w-full text-left px-3 py-2 flex items-center gap-3", i === active ? "bg-indigo-50" : "hover:bg-slate-50")}>
              <span className={cx("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0",
                it.kind === "roll" ? "bg-slate-100 text-slate-600" : it.kind === "box" ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700")}>
                {it.kind === "roll" ? <Boxes className="w-3.5 h-3.5" /> : it.kind === "box" ? <Container className="w-3.5 h-3.5" /> : <MapPin className="w-3.5 h-3.5" />}
              </span>
              <span className="min-w-0">
                <span className={cx("block text-sm font-semibold text-slate-900 truncate", it.kind === "roll" && "font-mono")}>{it.title}</span>
                <span className="block text-xs text-slate-500 truncate">{it.sub}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nothing selected (desktop): what needs attention in this division
// ---------------------------------------------------------------------------
function PanelHint() {
  return (
    <div className="m-auto text-center px-8 text-slate-500">
      <Container className="w-8 h-8 mx-auto text-slate-300" />
      <div className="mt-2 text-sm">Seleccione un contenedor para ver sus rollos.</div>
    </div>
  );
}

function DivisionSummary({ division, spots, agingDays, onPick }) {
  const withBox = spots.filter((l) => l.box_id);
  const fullest = [...withBox].filter((l) => l.capacity).sort((a, b) => used(b) / b.capacity - used(a) / a.capacity).slice(0, 5);
  const oldest = [...withBox].filter((l) => l.oldest_days != null).sort((a, b) => b.oldest_days - a.oldest_days).slice(0, 5);
  const free = withBox.filter((l) => used(l) === 0).length;
  const Row = ({ l, right }) => (
    <button onClick={() => onPick(l)} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-slate-50 text-left">
      <span className="font-bold text-slate-900 w-12">{l.box_code}</span>
      <span className="text-xs text-slate-500 flex-1">{l.code}</span>
      {right}
    </button>
  );
  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="px-4 py-4 border-b border-slate-100">
        <div className="text-xs text-slate-500">Resumen</div>
        <div className="text-lg font-semibold text-slate-900">División {division.code}</div>
        <div className="mt-1 text-sm text-slate-500">Seleccione un contenedor en el mapa para ver los rollos que tiene.</div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <MiniStat label="Contenedores" value={withBox.length} />
          <MiniStat label="Vacíos" value={free} />
          <MiniStat label="Rollos" value={spots.reduce((a, l) => a + n0(l.stored) + n0(l.inspection), 0)} />
        </div>
      </div>
      {fullest.length > 0 && (
        <div className="py-2">
          <div className="px-4 py-1 text-xs font-semibold text-slate-500">Más llenos</div>
          {fullest.map((l) => {
            const p = Math.round((used(l) / l.capacity) * 100);
            return <Row key={l.id} l={l} right={<span className={cx("text-xs fab-tnum font-medium", p >= 100 ? "text-red-600" : p >= 90 ? "text-amber-600" : "text-slate-600")}>{p}%</span>} />;
          })}
        </div>
      )}
      {oldest.length > 0 && (
        <div className="py-2 border-t border-slate-100">
          <div className="px-4 py-1 text-xs font-semibold text-slate-500">Rollos más antiguos</div>
          {oldest.map((l) => <Row key={l.id} l={l} right={<DaysCell days={l.oldest_days} limit={agingDays} />} />)}
        </div>
      )}
    </div>
  );
}

const MiniStat = ({ label, value, tone = "text-slate-900" }) => (
  <div className="rounded-xl bg-slate-50 px-2 py-2">
    <div className={cx("text-lg font-semibold fab-tnum leading-tight", tone)}>{value}</div>
    <div className="fab-t11 text-slate-500">{label}</div>
  </div>
);

// ---------------------------------------------------------------------------
// One container: slot view, roll list / groups, roll detail
// ---------------------------------------------------------------------------
const ROLL_FILTERS = [
  ["all", "Todos"], ["in_stock", "Guardados"], ["at_inspection", "Inspección"], ["assigned", "Reservados"],
];
const ORDER = { in_stock: 0, at_inspection: 1, assigned: 2 };

function slotColor(r, agingDays) {
  if (r.status === "assigned") return "bg-sky-300";
  if (r.status === "at_inspection") return "bg-violet-400";
  return (r.days_in_stock ?? 0) >= agingDays ? "bg-red-500" : "bg-emerald-500";
}

function ContainerPanel({ target, agingDays, version, focusRollId, onClose, onScanHere, onEditSpot }) {
  const openRoll = useRollDrawer();
  const spot = target.spot || null;
  const division = target.division || null;
  const boxId = spot?.box_id || target.box?.id || null;
  const code = spot?.box_code || target.box?.code || null;
  const [rolls, setRolls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("rolls");     // rolls | po | fabric
  const [filter, setFilter] = useState("all");
  const [group, setGroup] = useState(null);     // { type: "po"|"fabric", key }
  const [rollId, setRollId] = useState(null);
  const [q, setQ] = useState("");

  const key = boxId ? `b${boxId}` : spot ? `s${spot.id}` : "none";
  useEffect(() => { setTab("rolls"); setFilter("all"); setGroup(null); setRollId(null); setQ(""); }, [key]);
  useEffect(() => {
    let alive = true;
    const path = boxId ? `/boxes/${boxId}/rolls?include=inspection` : spot && used(spot) > 0 ? `/locations/${spot.id}/rolls` : null;
    if (!path) { setRolls([]); return undefined; }
    setLoading(true);
    api(path)
      .then((d) => { if (alive) setRolls(d.rolls || []); })
      .catch(() => { if (alive) setRolls([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [key, version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focusRollId) setRollId(focusRollId); }, [focusRollId, key]);

  const counts = useMemo(() => ({
    in_stock: rolls.filter((r) => r.status === "in_stock").length,
    at_inspection: rolls.filter((r) => r.status === "at_inspection").length,
    assigned: rolls.filter((r) => r.status === "assigned").length,
    aged: rolls.filter((r) => r.status === "in_stock" && (r.days_in_stock ?? 0) >= agingDays).length,
    yards: rolls.filter((r) => r.status === "in_stock").reduce((a, r) => a + n0(r.yards), 0),
    meters: rolls.filter((r) => r.status === "in_stock").reduce((a, r) => a + n0(r.meters), 0),
  }), [rolls, agingDays]);
  const cap = spot?.capacity ?? target.box?.capacity ?? null;
  const usedN = rolls.length;

  const ordered = useMemo(() => [...rolls].sort((a, b) =>
    (ORDER[a.status] - ORDER[b.status]) || ((b.days_in_stock ?? -1) - (a.days_in_stock ?? -1)) || byNum(a.roll_no, b.roll_no)), [rolls]);
  const groupKey = (r, type) => (type === "po" ? r.po_number || "Sin PO" : [r.fabric_name, r.color].filter(Boolean).join(" · ") || "Sin datos de tela");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return ordered.filter((r) =>
      (filter === "all" || r.status === filter) &&
      (!group || groupKey(r, group.type) === group.key) &&
      (!t || [r.roll_no, r.po_number, r.fabric_name, r.color, r.lot, r.supplier, r.customer].some((v) => String(v ?? "").toLowerCase().includes(t))));
  }, [ordered, filter, group, q]);
  const groups = useMemo(() => {
    if (tab === "rolls") return [];
    const m = new Map();
    for (const r of rolls) {
      const k = groupKey(r, tab);
      const g = m.get(k) || { key: k, n: 0, yards: 0, stored: 0, reserved: 0 };
      g.n++; g.yards += n0(r.yards); if (r.status === "assigned") g.reserved++; else g.stored++;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [rolls, tab]);

  const roll = rollId ? rolls.find((r) => String(r.id) === String(rollId)) : null;

  // Slot view: one square per roll, empty squares up to the capacity.
  const slots = cap && cap <= 200 ? Math.max(cap, usedN) : Math.max(20, Math.ceil(usedN / 10) * 10);
  // full rows: 50 → 2 × 25, 100 → 4 × 25, small containers → rows of 10
  const slotCols = slots % 25 === 0 ? 25 : slots <= 40 ? 10 : 20;

  // ---- spot without container ----
  if (!boxId) {
    return (
      <>
        <PanelHeader title={`Lugar ${spot?.code}`} sub={`División ${division?.code} · sin contenedor`} onClose={onClose} />
        <div className="flex-1 min-h-0 overflow-auto p-5 space-y-4">
          <div className="rounded-xl border-2 border-dashed border-slate-200 p-6 text-center text-slate-500">
            <PackageOpen className="w-8 h-8 mx-auto text-slate-300" />
            <div className="mt-2 text-sm">No hay contenedor registrado en este lugar.</div>
            <Button className="mt-3" icon={Container} onClick={() => onEditSpot(spot, division)}>Colocar contenedor</Button>
          </div>
          {rolls.length > 0 && (
            <div className="text-sm text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
              Hay {rolls.length} rollo(s) registrados aquí sin contenedor. Al colocar uno quedarán dentro de él.
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <PanelHeader
        title={code}
        sub={spot ? `Lugar ${spot.code} · División ${division?.code}` : "Sin lugar registrado"}
        onClose={onClose}
        actions={
          <>
            {spot && (
              <button onClick={() => onScanHere(spot, division)} title="Registrar con el escáner el contenedor de este lugar"
                className="p-2 rounded-lg text-slate-500 hover:text-indigo-700 hover:bg-indigo-50"><ScanLine className="w-4 h-4" /></button>
            )}
            {spot && (
              <button onClick={() => onEditSpot(spot, division)} title="Mover, cambiar o quitar el contenedor"
                className="p-2 rounded-lg text-slate-500 hover:text-indigo-700 hover:bg-indigo-50"><Pencil className="w-4 h-4" /></button>
            )}
          </>
        }
      />

      {/* Numbers + slot view */}
      <div className="px-4 pb-3 flex-shrink-0 border-b border-slate-100">
        <div className="grid grid-cols-4 gap-1.5 text-center">
          <MiniStat label="Guardados" value={counts.in_stock} tone="text-emerald-700" />
          <MiniStat label="Inspección" value={counts.at_inspection} tone="text-violet-700" />
          <MiniStat label="Reservados" value={counts.assigned} tone="text-sky-700" />
          <MiniStat label="Yardas" value={num(counts.yards, 0)} />
        </div>
        <div className="mt-3 flex items-baseline justify-between text-xs text-slate-500">
          <span className="font-medium text-slate-700">Vista del contenedor</span>
          <span className="fab-tnum">{usedN}{cap ? ` / ${cap}` : ""} rollos{cap ? ` · caben ${Math.max(0, cap - usedN)}` : ""}</span>
        </div>
        <div className="mt-1.5 grid" style={{ gap: 3, gridTemplateColumns: `repeat(${slotCols}, minmax(0, 1fr))` }} role="list" aria-label="Rollos dentro del contenedor">
          {Array.from({ length: slots }, (_, idx) => {
            const r = ordered[idx];
            if (!r) return <span key={`e${idx}`} className="fab-r3 bg-slate-100" style={{ aspectRatio: "1 / 1" }} aria-hidden />;
            const on = String(r.id) === String(rollId);
            return (
              <button
                key={r.id}
                role="listitem"
                onClick={() => setRollId(r.id)}
                title={`${r.roll_no} · ${r.status === "assigned" ? "reservado" : r.status === "at_inspection" ? "en inspección" : `${r.days_in_stock ?? 0} días`}`}
                style={{ aspectRatio: "1 / 1" }}
                className={cx("fab-r3 transition transform hover:scale-125 hover:z-10", slotColor(r, agingDays),
                  on && "ring-2 ring-offset-1 ring-slate-900 scale-125 z-10")}
                aria-label={`Rollo ${r.roll_no}`}
              />
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 fab-t11 text-slate-500">
          <span><Dot c="bg-emerald-500" />Guardado</span>
          <span><Dot c="bg-red-500" />&gt; {agingDays} días{counts.aged ? ` (${counts.aged})` : ""}</span>
          <span><Dot c="bg-violet-400" />Inspección</span>
          <span><Dot c="bg-sky-300" />Reservado</span>
        </div>
      </div>

      {/* Roll detail or list */}
      {roll ? (
        <RollDetail roll={roll} agingDays={agingDays} onBack={() => setRollId(null)} onHistory={() => openRoll(roll)} />
      ) : (
        <>
          <div className="px-4 pt-3 flex-shrink-0 space-y-2">
            <div className="flex gap-1 p-0.5 rounded-lg bg-slate-100 text-xs" role="tablist">
              {[["rolls", `Rollos (${rolls.length})`], ["po", "Por PO"], ["fabric", "Por tela"]].map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={cx("flex-1 px-2 py-1.5 rounded-md font-medium", tab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
                  {label}
                </button>
              ))}
            </div>
            {tab === "rolls" && (
              <div className="flex items-center gap-2">
                <div className="flex gap-1 overflow-x-auto no-scrollbar">
                  {ROLL_FILTERS.filter(([k]) => k === "all" || counts[k] > 0).map(([k, label]) => (
                    <button key={k} onClick={() => setFilter(k)}
                      className={cx("flex-shrink-0 px-2 py-1 rounded-full fab-t11 font-medium ring-1",
                        filter === k ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200 hover:ring-slate-400")}>
                      {label}{k !== "all" && ` ${counts[k]}`}
                    </button>
                  ))}
                </div>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar…"
                  className="ml-auto w-24 sm:w-28 px-2 py-1 rounded-lg ring-1 ring-inset ring-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" aria-label="Filtrar rollos" />
              </div>
            )}
            {tab === "rolls" && group && (
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded-full bg-indigo-50 text-indigo-700 px-2 py-0.5 truncate">{group.type === "po" ? "PO" : "Tela"}: {group.key}</span>
                <button onClick={() => setGroup(null)} className="text-slate-500 hover:text-slate-800 underline">quitar</button>
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-auto mt-2">
            {loading && rolls.length === 0 ? (
              <div className="px-4 py-6 space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-9 rounded-lg bg-slate-100 animate-pulse" />)}</div>
            ) : rolls.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-400">
                <PackageOpen className="w-7 h-7 mx-auto text-slate-300" />
                <div className="mt-1">{code} está vacío.</div>
              </div>
            ) : tab === "rolls" ? (
              <ul className="divide-y divide-slate-100">
                {shown.map((r) => (
                  <li key={r.id}>
                    <button onClick={() => setRollId(r.id)} className="w-full px-4 py-2 flex items-center gap-3 text-left hover:bg-slate-50">
                      <span className={cx("w-2.5 h-2.5 rounded-sm flex-shrink-0", slotColor(r, agingDays))} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-sm font-semibold text-slate-900 truncate">{r.roll_no}</span>
                        <span className="block text-xs text-slate-500 truncate">
                          {[r.fabric_name, r.color, r.po_number && `PO ${r.po_number}`].filter(Boolean).join(" · ") || "Datos de Skytex pendientes"}
                        </span>
                      </span>
                      <span className="text-right flex-shrink-0">
                        <span className="block text-sm text-slate-700 fab-tnum">{num(r.yards, 1)} yd</span>
                        <span className="block fab-t11">
                          {r.status === "assigned" ? <span className="text-sky-700">reservado</span>
                            : r.status === "at_inspection" ? <span className="text-violet-700">inspección</span>
                            : <DaysCell days={r.days_in_stock} limit={agingDays} />}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
                {shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">Ningún rollo coincide.</li>}
              </ul>
            ) : (
              <ul className="divide-y divide-slate-100">
                {groups.map((g) => (
                  <li key={g.key}>
                    <button onClick={() => { setGroup({ type: tab, key: g.key }); setTab("rolls"); setFilter("all"); }}
                      className="w-full px-4 py-2.5 text-left hover:bg-slate-50">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium text-slate-900 truncate flex-1">{tab === "po" && g.key !== "Sin PO" ? `PO ${g.key}` : g.key}</span>
                        <span className="text-xs text-slate-500 fab-tnum flex-shrink-0">{g.n} rollos · {num(g.yards, 0)} yd</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden flex">
                        <div className="bg-emerald-500" style={{ width: `${(g.stored / rolls.length) * 100}%` }} />
                        <div className="bg-sky-300" style={{ width: `${(g.reserved / rolls.length) * 100}%` }} />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </>
  );
}

function PanelHeader({ title, sub, onClose, actions }) {
  return (
    <div className="px-4 pt-3 pb-3 flex items-start gap-2 flex-shrink-0">
      <div className="min-w-0 flex-1">
        <div className="fab-t11 uppercase tracking-wide text-slate-400">Contenedor</div>
        <div className="text-2xl font-bold text-slate-900 leading-tight truncate">{title}</div>
        <div className="text-xs text-slate-500 truncate">{sub}</div>
      </div>
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {actions}
        <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label="Cerrar detalle">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function RollDetail({ roll: r, agingDays, onBack, onHistory }) {
  const F = ({ label, value, mono, wide }) => (
    <div className={cx("min-w-0", wide && "col-span-2")}>
      <div className="fab-t11 text-slate-400">{label}</div>
      <div className={cx("text-sm text-slate-900 break-words", mono && "font-mono")}>{value ?? <span className="text-slate-300">—</span>}</div>
    </div>
  );
  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="px-4 pt-3 pb-4">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800">
          <ChevronLeft className="w-3.5 h-3.5" /> Volver a la lista
        </button>
        <div className="mt-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-xl font-bold text-slate-900 break-all leading-tight">{r.roll_no}</div>
            <div className="text-sm text-slate-500">{[r.fabric_name, r.color].filter(Boolean).join(" · ") || "Datos de Skytex pendientes"}</div>
          </div>
          <StatusBadge status={r.status} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
          <MiniStat label="Yardas" value={num(r.yards, 1)} />
          <MiniStat label="Metros" value={num(r.meters, 1)} />
          <div className="rounded-xl bg-slate-50 px-2 py-2">
            <div className="text-lg font-semibold leading-tight">{r.status === "in_stock" ? <DaysCell days={r.days_in_stock} limit={agingDays} /> : "—"}</div>
            <div className="fab-t11 text-slate-500">Días</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          <F label="PO" value={r.po_number} />
          <F label="Proveedor" value={r.supplier || r.supplier_code} />
          <F label="Artículo" value={r.fabric_item_number} />
          <F label="Tipo de tela" value={r.fabric_type} />
          <F label="Lote" value={r.lot} />
          <F label="Ancho" value={r.width ? `${r.width}${r.width_unit ? ` ${r.width_unit}` : ""}` : null} />
          <F label="Peso" value={r.weight ? `${r.weight}${r.weight_unit ? ` ${r.weight_unit}` : ""}` : null} />
          <F label="Gramaje" value={r.weight_gsm ? `${r.weight_gsm}${/[a-z]/i.test(r.weight_gsm) ? "" : " g/m²"}` : null} />
          <F label="Cliente" value={r.customer} />
          <F label="Composición" value={r.composition} wide />
          <F label="SKU" value={r.item_sku_code} mono />
          <F label="Fecha de entrega" value={r.arrival_date} />
          <F label={r.status === "assigned" ? "Reservado" : "Recibido"} value={fmtDateTime(r.status === "assigned" ? r.location_set_at : r.received_at)} />
          {r.open_inspection_request && <F label="Inspección" value={r.open_inspection_request} />}
          {r.inspection_result && <F label="Resultado de inspección" value={r.inspection_result === "rejected" ? "Rechazado" : "Aprobado"} />}
          {r.remarks && <F label="Observaciones" value={r.remarks} wide />}
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm" icon={History} onClick={onHistory}>Historial completo</Button>
        </div>
      </div>
    </div>
  );
}