// components/FabricWH/FabricReports.jsx
// Almacén de Tela — Reportes de entradas y salidas.
// Quick date ranges, a day-by-day chart, totals per container (entradas) or per
// type (salidas), top suppliers, and the sortable detail. Click a row to open
// the roll. Everything exports to CSV (opens in Excel).
import { useState, useEffect, useCallback, useMemo } from "react";
import { Download, ArrowDownToLine, ArrowUpFromLine, Ruler, Package, Factory } from "lucide-react";
import {
  api, num, cx, Card, CardHeader, Button, PageHeader, SegTabs, StatCard, RollTable, EmptyState,
  Banner, fmtDateTime, todayStr, downloadCsv, inputCls, useRollDrawer, locationText, boxSortKey,
} from "./fabricShared";

const OUT_TYPE = { inspection_out: "Enviado a inspección", supplier_return: "Devuelto a proveedor" };

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function preset(key) {
  const now = new Date();
  if (key === "today") return [todayStr(), todayStr()];
  if (key === "yesterday") return [todayStr(-1), todayStr(-1)];
  if (key === "7d") return [todayStr(-6), todayStr()];
  if (key === "30d") return [todayStr(-29), todayStr()];
  if (key === "month") return [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), todayStr()];
  if (key === "lastMonth") return [ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ymd(new Date(now.getFullYear(), now.getMonth(), 0))];
  return null;
}
const PRESETS = [["today", "Hoy"], ["yesterday", "Ayer"], ["7d", "7 días"], ["30d", "30 días"], ["month", "Este mes"], ["lastMonth", "Mes pasado"]];

function DailyChart({ rows, from, to, kind }) {
  const days = useMemo(() => {
    const out = [];
    const start = new Date(`${from}T00:00:00`), end = new Date(`${to}T00:00:00`);
    for (let d = new Date(start); d <= end && out.length < 93; d.setDate(d.getDate() + 1)) out.push(ymd(d));
    return out;
  }, [from, to]);
  const data = useMemo(() => {
    const m = Object.fromEntries(days.map((d) => [d, { a: 0, b: 0 }]));
    for (const r of rows) {
      const d = ymd(new Date(r.moved_at));
      if (!m[d]) continue;
      if (kind === "outbound" && r.type === "supplier_return") m[d].b++; else m[d].a++;
    }
    return days.map((d) => ({ d, ...m[d] }));
  }, [rows, days, kind]);
  const max = Math.max(1, ...data.map((x) => x.a + x.b));
  if (days.length < 2) return null;
  return (
    <Card>
      <CardHeader
        title="Rollos por día"
        actions={kind === "outbound" && (
          <div className="flex gap-3 text-xs text-slate-500">
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-violet-400 mr-1" />Inspección</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-slate-400 mr-1" />Devolución</span>
          </div>
        )}
      />
      <div className="px-5 pt-4 pb-3">
        <div className="h-40 flex items-end gap-[3px]">
          {data.map((x) => (
            <div key={x.d} className="flex-1 h-full flex flex-col justify-end group relative" title={`${x.d}: ${x.a + x.b} rollo(s)`}>
              <div className="w-full rounded-t-sm bg-slate-400" style={{ height: `${(x.b / max) * 100}%` }} />
              <div className={cx("w-full", x.b ? "" : "rounded-t-sm", kind === "inbound" ? "bg-emerald-500 group-hover:bg-emerald-600" : "bg-violet-400 group-hover:bg-violet-500")} style={{ height: `${(x.a / max) * 100}%`, minHeight: x.a + x.b ? 2 : 0 }} />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[11px] text-slate-400 mt-1.5 fab-tnum">
          <span>{data[0].d.slice(5)}</span>
          <span>{data[Math.floor(data.length / 2)].d.slice(5)}</span>
          <span>{data[data.length - 1].d.slice(5)}</span>
        </div>
      </div>
    </Card>
  );
}

export default function FabricReports() {
  const openRoll = useRollDrawer();
  const [kind, setKind] = useState("inbound");
  const [range, setRange] = useState("month");
  const [[from, to], setDates] = useState(() => preset("month"));
  const [outType, setOutType] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const choose = (key) => { setRange(key); const p = preset(key); if (p) setDates(p); };

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const qs = `from=${from}&to=${to}${kind === "outbound" && outType ? `&type=${outType}` : ""}`;
      setData(await api(`/reports/${kind}?${qs}`));
    } catch (e) { setError(e.message); setData(null); }
    finally { setLoading(false); }
  }, [kind, from, to, outType]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (data?.rows || []).map((r) => ({ ...r, id: r.movement_id })), [data]);
  const summary = kind === "inbound" ? data?.byBox || data?.byContainer || [] : data?.byType || [];
  const suppliers = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const k = r.supplier || r.supplier_code || "Sin proveedor";
      const c = m.get(k) || { rolls: 0, yards: 0 };
      c.rolls++; c.yards += Number(r.yards) || 0;
      m.set(k, c);
    }
    return [...m.entries()].sort((a, b) => b[1].rolls - a[1].rolls).slice(0, 6);
  }, [rows]);

  const exportCsv = () => {
    downloadCsv(`${kind === "inbound" ? "entradas" : "salidas"}-tela-${from}_${to}.csv`, [
      { label: "Fecha y hora", get: (r) => fmtDateTime(r.moved_at) },
      ...(kind === "outbound" ? [{ label: "Tipo", get: (r) => OUT_TYPE[r.type] || r.type }] : []),
      { label: "Contenedor", key: "box_code" },
      { label: "Lugar", key: "location_code" },
      { label: "División", key: "container_code" },
      { label: "Rollo de tela", key: "roll_no" },
      { label: "Purchase order number", key: "po_number" },
      { label: "Supplier", key: "supplier" },
      { label: "Supplier Code", key: "supplier_code" },
      { label: "Fabric item number", key: "fabric_item_number" },
      { label: "Fabric name", key: "fabric_name" },
      { label: "Tipo de tela", key: "fabric_type" },
      { label: "Color", key: "color" },
      { label: "Lote", key: "lot" },
      { label: "Width", key: "width" },
      { label: "Width Unit", key: "width_unit" },
      { label: "Weight", key: "weight" },
      { label: "Weight Unit", key: "weight_unit" },
      { label: "Gramaje (g/m²)", key: "weight_gsm" },
      { label: "Composition", key: "composition" },
      { label: "Cliente", key: "customer" },
      { label: "Item SKU code", key: "item_sku_code" },
      { label: "Yardas", key: "yards" },
      { label: "Metros", key: "meters" },
      ...(kind === "outbound" ? [{ label: "Referencia", key: "reference" }, { label: "Motivo", key: "reason" }] : []),
      { label: "Usuario", key: "user_name" },
    ], rows);
  };

  const columns = [
    { key: "moved_at", label: "Fecha y hora", render: (r) => fmtDateTime(r.moved_at) },
    ...(kind === "outbound" ? [{ key: "type", label: "Tipo", render: (r) => (
      <span className={cx("text-xs rounded-md px-1.5 py-0.5 font-medium", r.type === "inspection_out" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-600")}>{OUT_TYPE[r.type] || r.type}</span>
    ) }] : []),
    { key: "box_code", label: kind === "inbound" ? "Guardado en" : "Salió de", sortValue: boxSortKey, render: (r) => locationText(r) },
    { key: "roll_no", label: "Rollo", mono: true },
    { key: "po_number", label: "PO" },
    { key: "supplier", label: "Proveedor" },
    { key: "fabric_name", label: "Tela", render: (r) => <span>{r.fabric_name || "—"} <span className="text-slate-400">· {r.color || "—"}</span></span> },
    { key: "lot", label: "Lote" },
    { key: "yards", label: "Yardas", align: "right", render: (r) => num(r.yards, 1) },
    { key: "meters", label: "Metros", align: "right", render: (r) => num(r.meters, 1) },
    ...(kind === "outbound" ? [{ key: "reference", label: "Referencia / motivo", render: (r) => [r.reference, r.reason === "approved" || r.reason === "rejected" ? null : r.reason].filter(Boolean).join(" · ") || "—" }] : []),
    { key: "user_name", label: "Usuario" },
  ];

  const isIn = kind === "inbound";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reportes"
        subtitle="Entradas al contenedor y salidas del almacén. Elija el periodo y exporte a Excel."
        actions={<Button variant="secondary" icon={Download} onClick={exportCsv} disabled={!rows.length}>Exportar CSV</Button>}
      />

      <Card className="p-4 flex flex-wrap items-center gap-3">
        <SegTabs
          value={kind}
          onChange={setKind}
          tabs={[{ key: "inbound", label: "Entradas", icon: ArrowDownToLine }, { key: "outbound", label: "Salidas", icon: ArrowUpFromLine }]}
        />
        <div className="flex flex-wrap gap-1">
          {PRESETS.map(([k, label]) => (
            <button key={k} onClick={() => choose(k)}
              className={cx("px-2.5 py-1.5 rounded-lg text-sm transition", range === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input type="date" value={from} max={to} onChange={(e) => { setRange("custom"); setDates([e.target.value, to]); }} className={cx(inputCls, "py-1.5")} aria-label="Desde" />
          <span className="text-slate-400">→</span>
          <input type="date" value={to} min={from} onChange={(e) => { setRange("custom"); setDates([from, e.target.value]); }} className={cx(inputCls, "py-1.5")} aria-label="Hasta" />
        </div>
        {!isIn && (
          <select value={outType} onChange={(e) => setOutType(e.target.value)} className={cx(inputCls, "py-1.5")} aria-label="Tipo de salida">
            <option value="">Todas las salidas</option>
            <option value="inspection_out">Enviado a inspección</option>
            <option value="supplier_return">Devuelto a proveedor</option>
          </select>
        )}
      </Card>

      {error && <Banner kind="err">{error}</Banner>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={isIn ? ArrowDownToLine : ArrowUpFromLine} label={isIn ? "Rollos recibidos" : "Rollos que salieron"} value={data?.totals?.rolls ?? 0} tone={isIn ? "emerald" : "violet"} />
        <StatCard icon={Ruler} label="Yardas" value={num(data?.totals?.yards ?? 0, 1)} tone="indigo" />
        <StatCard icon={Ruler} label="Metros" value={num(data?.totals?.meters ?? 0, 1)} tone="indigo" />
      </div>

      <DailyChart rows={rows} from={from} to={to} kind={kind} />

      {rows.length > 0 && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader title={isIn ? "Por contenedor" : "Por tipo de salida"} />
            <ul className="divide-y divide-slate-100">
              {summary.map((s) => {
                const pct = data?.totals?.rolls ? (s.rolls / data.totals.rolls) * 100 : 0;
                return (
                  <li key={s.box_code || s.container_code || s.type} className="px-5 py-3">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium text-slate-800">
                        {s.box_code || s.container_code || OUT_TYPE[s.type] || s.type}
                        {s.box_code && s.location_code && <span className="font-normal text-slate-400"> · {s.location_code}</span>}
                      </span>
                      <span className="text-slate-500 fab-tnum">{num(s.rolls)} rollos · {num(s.yards, 1)} yd</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-slate-100"><div className={cx("h-full rounded-full", isIn ? "bg-emerald-500" : "bg-violet-400")} style={{ width: `${pct}%` }} /></div>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Por proveedor" />
            <ul className="divide-y divide-slate-100">
              {suppliers.map(([s, v]) => (
                <li key={s} className="px-5 py-3 flex items-center gap-3 text-sm">
                  <Factory className="w-4 h-4 text-slate-400" />
                  <span className="font-medium text-slate-800 flex-1 truncate">{s}</span>
                  <span className="text-slate-500 fab-tnum">{num(v.rolls)} rollos · {num(v.yards, 1)} yd</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <Card className="overflow-hidden">
        <CardHeader title="Detalle" subtitle={`${rows.length} movimiento(s) del ${from} al ${to}`} />
        <RollTable
          rows={rows}
          columns={columns}
          loading={loading}
          onRowClick={(r) => openRoll({ ...r, id: r.roll_id })}
          defaultSort={{ key: "moved_at", dir: "desc" }}
          empty={<EmptyState icon={Package} title="Sin movimientos en este periodo" text="Pruebe con otro rango de fechas." />}
        />
      </Card>
    </div>
  );
}