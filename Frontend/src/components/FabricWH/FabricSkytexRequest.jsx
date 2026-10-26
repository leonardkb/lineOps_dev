// components/FabricWH/FabricSkytexRequest.jsx
// Almacén de Tela — Solicitar a Skytex.
//   1. Cargar  — live from Skytex (optional PO) or the test JSON (drop, upload or paste)
//   2. Elegir  — search, filter by any of the agreed fields, select by PO in one click
//   3. Solicitar — floating bar → confirmation with a per-PO summary
import { useState, useMemo, useRef, useEffect } from "react";
import {
  DownloadCloud, FileJson, Upload, Plus, X, Send, Columns, Check, Filter, ClipboardPaste,
} from "lucide-react";
import {
  api, post, num, cx, FABRIC_FIELDS, StatusBadge, Card, CardHeader, Button, PageHeader,
  SegTabs, SearchInput, EmptyState, RollTable, ActionBar, Modal, Banner, useSelection,
  useToast, inputCls, notifyChange,
} from "./fabricShared";

const COLS_KEY = "fabricSkytexColumns";
const DEFAULT_COLS = ["roll_no", "po_number", "supplier", "fabric_name", "fabric_type", "color", "lot", "yards", "meters", "width", "customer", "arrival_date"];

function Steps({ step }) {
  const steps = ["Cargar rollos", "Elegir", "Solicitar"];
  return (
    <ol className="flex items-center gap-2 text-sm">
      {steps.map((s, i) => {
        const n = i + 1;
        const done = step > n, on = step === n;
        return (
          <li key={s} className="flex items-center gap-2">
            <span className={cx("w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold",
              done ? "bg-emerald-500 text-white" : on ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-500")}>
              {done ? <Check className="w-3.5 h-3.5" /> : n}
            </span>
            <span className={cx(on ? "text-slate-900 font-medium" : "text-slate-500")}>{s}</span>
            {i < steps.length - 1 && <span className="w-8 h-px bg-slate-300 mx-1" />}
          </li>
        );
      })}
    </ol>
  );
}

export default function FabricSkytexRequest({ onNavigate = () => {} }) {
  const toast = useToast();
  const [mode, setMode] = useState("skytex");
  const [po, setPo] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [rolls, setRolls] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [filters, setFilters] = useState([]);
  const [quick, setQuick] = useState("");
  const [hideRequested, setHideRequested] = useState(true);
  const [cols, setCols] = useState(() => {
    try { return JSON.parse(localStorage.getItem(COLS_KEY)) || DEFAULT_COLS; } catch { return DEFAULT_COLS; }
  });
  const [colsOpen, setColsOpen] = useState(false);
  const { sel, toggle, setAll, clear } = useSelection();
  const fileRef = useRef(null);
  const colsRef = useRef(null);

  useEffect(() => { try { localStorage.setItem(COLS_KEY, JSON.stringify(cols)); } catch { /* */ } }, [cols]);
  useEffect(() => {
    const h = (e) => { if (colsRef.current && !colsRef.current.contains(e.target)) setColsOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const setLoaded = (list, m) => {
    setRolls((list || []).map((r) => ({ ...r, id: r._key })));
    setMeta(m);
    clear();
  };

  const loadSkytex = async () => {
    setLoading(true); setError(null);
    try {
      const d = await api(`/skytex/rolls${po.trim() ? `?po_number=${encodeURIComponent(po.trim())}` : ""}`);
      setLoaded(d.rolls, { source: "Skytex", total: d.total });
    } catch (e) { setLoaded([], null); setError(e.message); }
    finally { setLoading(false); }
  };

  const loadJson = async (text) => {
    const body = text ?? jsonText;
    if (!body.trim()) return setError("Pegue el JSON o cargue el archivo.");
    setLoading(true); setError(null);
    try {
      const d = await post("/skytex/preview", { data: body });
      setLoaded(d.rolls, { source: "JSON de prueba", total: d.total, skipped: d.skippedWithoutRoll, unmapped: d.unmappedKeys });
    } catch (e) { setLoaded([], null); setError(e.message); }
    finally { setLoading(false); }
  };

  const readFile = async (f) => {
    if (!f) return;
    const text = await f.text();
    setJsonText(text);
    loadJson(text);
  };

  const isFree = (r) => !r.local_status || r.local_status === "cancelled";

  const shown = useMemo(() => {
    const q = quick.trim().toLowerCase();
    return rolls.filter((r) => {
      if (hideRequested && !isFree(r)) return false;
      for (const f of filters) {
        if (f.value.trim() && !String(r[f.key] ?? "").toLowerCase().includes(f.value.trim().toLowerCase())) return false;
      }
      if (q && !FABRIC_FIELDS.some((f) => String(r[f.key] ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rolls, filters, quick, hideRequested]);

  const byPo = useMemo(() => {
    const m = new Map();
    for (const r of shown) {
      if (!isFree(r)) continue;
      const k = r.po_number || "Sin PO";
      m.set(k, [...(m.get(k) || []), r.id]);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [shown]);

  const chosen = rolls.filter((r) => sel.has(r.id));
  const yards = chosen.reduce((s, r) => s + (Number(r.yards) || 0), 0);
  const meters = chosen.reduce((s, r) => s + (Number(r.meters) || 0), 0);
  const chosenByPo = useMemo(() => {
    const m = new Map();
    for (const r of chosen) {
      const k = r.po_number || "Sin PO";
      const c = m.get(k) || { rolls: 0, yards: 0 };
      c.rolls++; c.yards += Number(r.yards) || 0;
      m.set(k, c);
    }
    return [...m.entries()];
  }, [chosen]);

  const request = async () => {
    setSaving(true);
    try {
      const d = await post("/requests", { rolls: chosen });
      const keys = new Set(chosen.map((r) => r.id));
      setRolls((prev) => prev.map((r) => (keys.has(r.id) ? { ...r, local_status: "requested" } : r)));
      clear();
      setConfirmOpen(false);
      notifyChange();
      toast({
        kind: "ok",
        title: `${d.created} rollo(s) solicitados`,
        text: d.duplicates?.length ? `${d.duplicates.length} ya estaban solicitados.` : "Ahora asígneles un contenedor en Ubicaciones.",
        action: { label: "Asignar ubicaciones →", onClick: () => onNavigate("ubicaciones") },
      });
    } catch (e) { toast({ kind: "err", text: e.message }); }
    finally { setSaving(false); }
  };

  const used = new Set(filters.map((f) => f.key));
  const addFilter = () => {
    const next = FABRIC_FIELDS.find((f) => !used.has(f.key));
    if (next) setFilters((p) => [...p, { key: next.key, value: "" }]);
  };

  const columns = [
    {
      key: "local_status", label: "Estado",
      render: (r) => (r.local_status ? <StatusBadge status={r.local_status} /> : <span className="text-xs text-emerald-600 font-medium">Disponible</span>),
    },
    ...FABRIC_FIELDS.filter((f) => cols.includes(f.key)).map((f) => ({
      key: f.key,
      label: f.short || f.label,
      align: f.type === "number" ? "right" : undefined,
      mono: f.key === "roll_no",
      render: f.type === "number" ? (r) => num(r[f.key], 2) : undefined,
    })),
  ];

  const step = !rolls.length ? 1 : sel.size ? 3 : 2;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Solicitar rollos a Skytex"
        subtitle="Cargue los rollos disponibles, elija los que necesita y envíe la solicitud."
        actions={<Steps step={step} />}
      />

      {/* 1. Source */}
      <Card>
        <CardHeader
          title="Cargar rollos"
          actions={
            <SegTabs
              size="sm"
              value={mode}
              onChange={setMode}
              tabs={[{ key: "skytex", label: "Sistema Skytex", icon: DownloadCloud }, { key: "file", label: "JSON de prueba", icon: FileJson }]}
            />
          }
        />
        <div className="p-5">
          {mode === "skytex" ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex-1 min-w-[240px] flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600">Purchase order number <span className="text-slate-400 font-normal">(opcional)</span></span>
                <input
                  value={po}
                  onChange={(e) => setPo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && loadSkytex()}
                  placeholder="Ej. PO-2026-0145 — vacío para traer todos"
                  className={inputCls}
                />
              </label>
              <Button icon={DownloadCloud} loading={loading} onClick={loadSkytex}>Consultar Skytex</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); readFile(e.dataTransfer.files?.[0]); }}
                onClick={() => fileRef.current?.click()}
                className={cx(
                  "cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition",
                  dragOver ? "border-indigo-400 bg-indigo-50" : "border-slate-300 hover:border-indigo-300 hover:bg-slate-50"
                )}
              >
                <Upload className="w-7 h-7 mx-auto text-slate-400" />
                <div className="mt-2 text-sm font-medium text-slate-800">Arrastre aquí el archivo .json de Skytex</div>
                <div className="text-xs text-slate-500">o haga clic para elegirlo</div>
                <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ""; }} />
              </div>
              <button onClick={() => setShowPaste((v) => !v)} className="text-sm text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1.5">
                <ClipboardPaste className="w-4 h-4" /> {showPaste ? "Ocultar texto" : "Pegar el JSON como texto"}
              </button>
              {showPaste && (
                <div className="space-y-2">
                  <textarea
                    value={jsonText}
                    onChange={(e) => setJsonText(e.target.value)}
                    rows={6}
                    placeholder='[{"Purchase order number": "PO-1", "Rollo de tela": "R-001", "Yardas": 120, ...}]'
                    className={cx(inputCls, "w-full font-mono text-xs")}
                  />
                  <Button icon={FileJson} loading={loading} onClick={() => loadJson()}>Leer JSON</Button>
                </div>
              )}
            </div>
          )}
          {error && <div className="mt-4"><Banner kind="err" onClose={() => setError(null)}>{error}</Banner></div>}
          {meta?.unmapped?.length > 0 && (
            <div className="mt-4">
              <Banner kind="warn">
                Estos campos del JSON no son de los {FABRIC_FIELDS.length} acordados (se guardan, pero no se muestran):{" "}
                <span className="font-mono">{meta.unmapped.join(", ")}</span>
              </Banner>
            </div>
          )}
          {meta?.skipped > 0 && <div className="mt-3"><Banner kind="warn">{meta.skipped} registro(s) sin «Rollo de tela» se omitieron.</Banner></div>}
        </div>
      </Card>

      {/* 2. Choose */}
      {(rolls.length > 0 || loading) && (
        <Card>
          <CardHeader
            title="Elegir rollos"
            subtitle={meta ? `${num(rolls.length)} rollos de ${meta.source} · ${num(rolls.filter(isFree).length)} disponibles` : null}
            actions={
              <>
                <label className="inline-flex items-center gap-2 text-sm text-slate-600 mr-1">
                  <input type="checkbox" className="rounded border-slate-300 text-indigo-600" checked={hideRequested} onChange={(e) => setHideRequested(e.target.checked)} />
                  Ocultar ya solicitados
                </label>
                <div className="relative" ref={colsRef}>
                  <Button size="sm" variant="secondary" icon={Columns} onClick={() => setColsOpen((v) => !v)}>Columnas</Button>
                  {colsOpen && (
                    <div className="absolute right-0 mt-2 z-30 w-64 max-h-80 overflow-y-auto bg-white rounded-xl shadow-xl ring-1 ring-slate-900/10 p-2">
                      <div className="flex justify-between px-2 py-1 text-xs">
                        <button className="text-indigo-600" onClick={() => setCols(FABRIC_FIELDS.map((f) => f.key))}>Todas</button>
                        <button className="text-indigo-600" onClick={() => setCols(DEFAULT_COLS)}>Predeterminadas</button>
                      </div>
                      {FABRIC_FIELDS.map((f) => (
                        <label key={f.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 text-sm">
                          <input
                            type="checkbox"
                            className="rounded border-slate-300 text-indigo-600"
                            checked={cols.includes(f.key)}
                            disabled={f.key === "roll_no"}
                            onChange={(e) => setCols((p) => (e.target.checked ? [...p, f.key] : p.filter((k) => k !== f.key)))}
                          />
                          {f.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </>
            }
          />

          <div className="px-5 py-3 border-b border-slate-100 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <SearchInput value={quick} onChange={setQuick} placeholder={`Buscar en los ${FABRIC_FIELDS.length} campos…`} className="flex-1 min-w-[240px]" />
              <Button variant="secondary" icon={Filter} onClick={addFilter} disabled={used.size >= FABRIC_FIELDS.length}>Filtrar por campo</Button>
            </div>
            {filters.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {filters.map((f, i) => (
                  <div key={i} className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 ring-1 ring-inset ring-indigo-200 pl-1.5 pr-1 py-1">
                    <select
                      value={f.key}
                      onChange={(e) => setFilters((p) => p.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                      className="text-xs bg-transparent border-0 py-0 pl-1 pr-6 text-indigo-800 font-medium focus:ring-0"
                    >
                      {FABRIC_FIELDS.filter((x) => x.key === f.key || !used.has(x.key)).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                    </select>
                    <input
                      value={f.value}
                      onChange={(e) => setFilters((p) => p.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                      placeholder="contiene…"
                      className="w-32 px-2 py-1 rounded-md bg-white ring-1 ring-inset ring-indigo-200 text-xs focus:outline-none focus:ring-indigo-400"
                      autoFocus
                    />
                    <button onClick={() => setFilters((p) => p.filter((_, j) => j !== i))} className="p-1 text-indigo-400 hover:text-indigo-800" aria-label="Quitar filtro">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button onClick={() => setFilters([])} className="text-xs text-slate-500 hover:text-slate-800 underline">Quitar filtros</button>
              </div>
            )}
            {byPo.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500">Seleccionar por PO:</span>
                {byPo.slice(0, 12).map(([p, ids]) => {
                  const allIn = ids.every((id) => sel.has(id));
                  return (
                    <button
                      key={p}
                      onClick={() => setAll(ids, !allIn)}
                      className={cx("text-xs rounded-full px-2.5 py-1 ring-1 ring-inset transition",
                        allIn ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-300 hover:ring-indigo-300")}
                    >
                      {allIn && <Check className="w-3 h-3 inline mr-1" />}{p} <span className="opacity-70">{ids.length}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <RollTable
            rows={shown}
            columns={columns}
            selected={sel}
            onToggle={toggle}
            onToggleAll={(on, ids) => setAll(ids, on)}
            onRowClick={(r) => isFree(r) && toggle(r.id)}
            canSelect={isFree}
            loading={loading}
            rowClass={(r) => (!isFree(r) ? "opacity-50" : "")}
            empty={<EmptyState icon={Filter} title="Ningún rollo coincide" text="Cambie la búsqueda o quite filtros." />}
          />
        </Card>
      )}

      {!rolls.length && !loading && !error && (
        <Card>
          <EmptyState
            icon={DownloadCloud}
            title="Aún no hay rollos cargados"
            text={mode === "skytex" ? "Consulte Skytex (con o sin orden de compra) para ver los rollos disponibles." : "Arrastre el JSON de prueba de Skytex para ver los rollos."}
          />
        </Card>
      )}

      {/* 3. Request */}
      <ActionBar count={sel.size} summary={`${num(yards, 1)} yd · ${num(meters, 1)} m`} onClear={clear}>
        <Button icon={Send} onClick={() => setConfirmOpen(true)}>Solicitar {sel.size} rollo(s)</Button>
      </ActionBar>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirmar solicitud a Skytex"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>Cancelar</Button>
            <Button icon={Send} loading={saving} onClick={request}>Solicitar {sel.size} rollo(s)</Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 mb-3">Se solicitarán estos rollos. Después podrá asignarles su contenedor.</p>
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-slate-500 text-left border-b"><th className="py-1.5">PO</th><th className="py-1.5 text-right">Rollos</th><th className="py-1.5 text-right">Yardas</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {chosenByPo.map(([p, v]) => (
              <tr key={p}><td className="py-1.5 font-mono">{p}</td><td className="py-1.5 text-right fab-tnum">{v.rolls}</td><td className="py-1.5 text-right fab-tnum">{num(v.yards, 1)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t font-semibold"><td className="py-1.5">Total</td><td className="py-1.5 text-right fab-tnum">{sel.size}</td><td className="py-1.5 text-right fab-tnum">{num(yards, 1)}</td></tr></tfoot>
        </table>
      </Modal>
    </div>
  );
}