import { useEffect, useMemo, useState } from "react";
import {
  Calculator,
  Layers,
  Scissors,
  Factory,
  Coins,
  Percent,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  Save,
  Check,
  RefreshCw,
  Plus,
  Trash2,
  AlertCircle,
  ClipboardCheck,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

/* ==========================================================================
   Style Costing — step-by-step costing sheet for a saved style order.

   Opened from the dashboard once a style exists. It loads the style order,
   pre-fills fabric/trim rows from the style's materials, and walks the user
   through the costing model:

     1 · Materiales      cost of fabric + cost of trims  -> total material cost
     2 · Manufactura     merma, MO cost, gastos %        -> gross cost
     3 · Venta           precio de venta, descuentos     -> net selling price
     4 · Resumen         full breakdown + save

   The whole sheet is one pure computation (computeCosting) so every line
   stays consistent as the user types. Results are stored back on the style
   order under order.data.costing (requires "costing" in the SECTIONS list of
   style-orders.js).
   ======================================================================== */

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });
const jsonHeaders = () => ({ ...authHeaders(), "Content-Type": "application/json" });

const uid = () => Math.random().toString(36).slice(2);
const n = (v) => (Number.isFinite(+v) ? +v : 0);

const money = (v) =>
  n(v).toLocaleString("es-MX", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const pct = (v) => `${(n(v) * 100).toLocaleString("es-MX", { maximumFractionDigits: 2 })}%`;

// ---- default rates & fixed inputs ----------------------------------------
const DEFAULT_RATES = {
  materialWaste: 0.02, // 2% material waste (merma) over total material cost
  seconds: 0.03, //        3% seconds over (total material + merma)
  homeDirect: 0.02, //     2% home direct expense (informativo, no entra al costo bruto)
  operating: 0.0624, //    6.24% operating expense over costo de tela
  financial: 0.03, //      3% financial expense over costo de tela
  skytexProd: 0.03, //     3% skytex production over costo de tela
  distributionCenter: 0, //% distribution center contract over precio de venta
};

const emptyFabric = (o = {}) => ({ key: uid(), desc: o.desc || "", costPerYard: o.costPerYard ?? "", consumption: o.consumption ?? "" });
const emptyTrim = (o = {}) => ({ key: uid(), desc: o.desc || "", usPrice: o.usPrice ?? "", priceNumerator: o.priceNumerator ?? "1", consumption: o.consumption ?? "" });

// ==========================================================================
//  The costing model — one pure function, faithful to the 19 steps.
// ==========================================================================
export function computeCosting(input) {
  const rates = { ...DEFAULT_RATES, ...(input.rates || {}) };

  // -- materials -----------------------------------------------------------
  const fabricLines = (input.fabrics || []).map((f) => ({ ...f, lineCost: n(f.costPerYard) * n(f.consumption) }));
  const trimLines = (input.trims || []).map((t) => {
    const denom = n(t.priceNumerator) || 1; // price numerator, never divide by 0
    return { ...t, lineCost: (n(t.usPrice) / denom) * n(t.consumption) };
  });

  const costOfFabric = fabricLines.reduce((s, l) => s + l.lineCost, 0); // (1)
  const costOfTrims = trimLines.reduce((s, l) => s + l.lineCost, 0); //   (2)
  const totalMaterialCost = costOfFabric + costOfTrims; //               (3)

  // -- manufacturing & expenses -------------------------------------------
  const materialWaste = totalMaterialCost * n(rates.materialWaste); //   (4)  2% * total material
  const moCost = n(input.cpm) * n(input.sam); //                         (5)  cpm * sam
  const freight = n(input.freight); //                                   (6)  freight (input)
  const seconds = (totalMaterialCost + materialWaste) * n(rates.seconds); // 3% seconds
  const license = n(input.license); //                                   15% license (input, 0)
  const homeDirect = totalMaterialCost * n(rates.homeDirect); //         (7)  2% (informativo)
  const operatingExpense = costOfFabric * n(rates.operating); //         (8)  6.24% * costo de tela
  const financialExpense = costOfFabric * n(rates.financial); //         (9)  3%   * costo de tela
  const skytexProduction = costOfFabric * n(rates.skytexProd); //        (10) 3%   * costo de tela
  const fixedOverhead = n(input.fixedOverhead); //                       fixed 4.35
  const costoSkytex = n(input.costoSkytex); //                           costo del skytex (input, 0)

  // (11) gross cost — exactly the sum the user listed (home direct is NOT in it)
  const grossCost =
    fixedOverhead +
    materialWaste +
    moCost +
    costoSkytex +
    freight +
    seconds +
    license +
    operatingExpense +
    financialExpense +
    skytexProduction;

  // -- selling & margins ---------------------------------------------------
  const grossSellingPrice = n(input.grossSellingPrice); // precio de venta bruto
  const grossMargin = grossSellingPrice ? (grossSellingPrice - grossCost) / grossSellingPrice : 0; // (12)
  const customerDiscount = n(input.customerDiscount); //                 (13)
  const netAfterDiscount = grossSellingPrice - customerDiscount; //      (14)
  const distributionCenter = grossSellingPrice * n(rates.distributionCenter); // (15)
  const demonstration = n(input.demonstration); //                      (16) 0
  const chargedExpense = n(input.chargedExpense); //                    (17) 0
  const netSellingPrice = netAfterDiscount - (distributionCenter + demonstration + chargedExpense); // (18)
  const netMargin = netSellingPrice ? (netSellingPrice - grossCost) / netSellingPrice : 0; // (19)

  return {
    fabricLines,
    trimLines,
    costOfFabric,
    costOfTrims,
    totalMaterialCost,
    materialWaste,
    moCost,
    freight,
    seconds,
    license,
    homeDirect,
    operatingExpense,
    financialExpense,
    skytexProduction,
    fixedOverhead,
    costoSkytex,
    grossCost,
    grossSellingPrice,
    grossMargin,
    customerDiscount,
    netAfterDiscount,
    distributionCenter,
    demonstration,
    chargedExpense,
    netSellingPrice,
    netMargin,
  };
}

const STEPS = [
  { id: "materiales", n: 1, label: "Materiales", sub: "Tela y avíos", icon: Layers },
  { id: "manufactura", n: 2, label: "Manufactura", sub: "Merma, MO y gastos", icon: Factory },
  { id: "venta", n: 3, label: "Venta", sub: "Precio y descuentos", icon: Coins },
  { id: "resumen", n: 4, label: "Resumen", sub: "Revisar y guardar", icon: ClipboardCheck },
];

// ==========================================================================
export default function StyleCostingWizard({ orderId, onDone }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState(null);

  const [order, setOrder] = useState(null); // the full style order (kept intact for save)
  const [fabrics, setFabrics] = useState([emptyFabric()]);
  const [trims, setTrims] = useState([emptyTrim()]);
  const [rates, setRates] = useState(DEFAULT_RATES);
  const [inputs, setInputs] = useState({
    sam: "",
    cpm: "",
    fixedOverhead: "4.35",
    freight: "0",
    license: "0",
    costoSkytex: "0",
    grossSellingPrice: "",
    customerDiscount: "0",
    demonstration: "0",
    chargedExpense: "0",
  });

  const step = STEPS[stepIdx];
  const showToast = (msg, kind = "ok") => { setToast({ msg, kind }); setTimeout(() => setToast(null), 2600); };
  const setInput = (k, v) => setInputs((s) => ({ ...s, [k]: v }));
  const setRate = (k, v) => setRates((s) => ({ ...s, [k]: v === "" ? "" : n(v) / 100 }));

  // ---- load the style order + any saved costing --------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/style-orders/${orderId}`, { headers: authHeaders() });
        if (res.status === 401) { window.location.href = "/login"; return; }
        const data = await res.json();
        if (!alive) return;
        const o = data.order || {};
        setOrder(o);

        const c = o.costing || null;
        if (c) {
          // reopen a previously saved costing
          setFabrics((c.fabrics || []).map(emptyFabric).length ? c.fabrics.map((f) => ({ key: uid(), ...f })) : [emptyFabric()]);
          setTrims((c.trims || []).length ? c.trims.map((t) => ({ key: uid(), ...t })) : [emptyTrim()]);
          setRates({ ...DEFAULT_RATES, ...(c.rates || {}) });
          setInputs((s) => ({ ...s, ...(c.inputs || {}) }));
        } else {
          // first time: pre-fill rows from the style's materials (costs left blank)
          const fb = (o.fabrics || [])
            .filter((f) => f.code || f.composition || f.position)
            .map((f) => emptyFabric({ desc: [f.position, f.code, f.composition].filter(Boolean).join(" · ") }));
          const tr = (o.trimMaterials || [])
            .filter((t) => t.code || t.desc)
            .map((t) => emptyTrim({ desc: [t.code, t.desc].filter(Boolean).join(" · "), consumption: t.consumption }));
          setFabrics(fb.length ? fb : [emptyFabric()]);
          setTrims(tr.length ? tr : [emptyTrim()]);
          // SAM: reuse the style's total SAM if it was entered on the ficha
          const sam = o.header?.samMinutes ?? (o.sam || []).reduce((s, r) => s + n(r.minutes), 0);
          setInputs((s) => ({ ...s, sam: sam ? String(sam) : "" }));
        }
      } catch (err) {
        showToast("No se pudo cargar la orden", "error");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line
  }, [orderId]);

  const r = useMemo(
    () => computeCosting({ fabrics, trims, rates, ...inputs, sam: inputs.sam, cpm: inputs.cpm }),
    [fabrics, trims, rates, inputs]
  );

  // ---- save costing back onto the style order (preserving all sections) --
  const save = async () => {
    if (!order) return;
    setSaving(true);
    try {
      const costing = { fabrics: stripKeys(fabrics), trims: stripKeys(trims), rates, inputs, totals: totalsOnly(r), savedAt: new Date().toISOString() };
      const body = { ...order, status: order.status, costing };
      const res = await fetch(`${API_URL}/api/style-orders/${orderId}`, { method: "PUT", headers: jsonHeaders(), body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "No se pudo guardar");
      setSaved(true);
      showToast("Costeo guardado");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const head = order || {};
  const goto = (i) => setStepIdx(Math.max(0, Math.min(STEPS.length - 1, i)));

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 grid place-items-center text-sm text-slate-400">
        <div className="flex items-center gap-2"><RefreshCw size={18} className="animate-spin" /> Cargando costeo…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 pb-24">
      {/* header bar */}
      <div className="bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <button onClick={() => onDone?.()} className="inline-flex items-center gap-1.5 text-sm text-slate-300 hover:text-white">
            <ChevronLeft size={16} /> Volver
          </button>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center"><Calculator size={18} /></div>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">Costeo · {head.styleNo || `#${orderId}`}</div>
              <div className="text-[11px] text-slate-400 truncate">{head.customerName || "—"} · {head.styleName || head.orderNo || ""}</div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-4 text-right">
            <Metric label="Costo bruto" value={money(r.grossCost)} />
            <Metric label="Precio neto" value={money(r.netSellingPrice)} />
            <Metric label="Margen neto" value={pct(r.netMargin)} accent={r.netMargin >= 0 ? "emerald" : "rose"} />
          </div>
        </div>
      </div>

      {/* stepper */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex overflow-x-auto">
          {STEPS.map((s, i) => {
            const Active = i === stepIdx;
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                onClick={() => goto(i)}
                className={`flex items-center gap-2 px-4 py-3 border-b-2 whitespace-nowrap text-sm ${
                  Active ? "border-slate-900 text-slate-900 font-semibold" : "border-transparent text-slate-400 hover:text-slate-600"
                }`}
              >
                <span className={`w-6 h-6 rounded-full grid place-items-center text-[11px] ${Active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>{s.n}</span>
                <span className="hidden sm:block">{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* ---- STEP 1: materials ------------------------------------------ */}
        {step.id === "materiales" && (
          <>
            <SectionCard icon={Layers} title="1 · Costo de tela" subtitle="Costo por yarda × consumo por prenda"
              right={<Big label="Costo de tela" value={money(r.costOfFabric)} />}>
              <FabricTable rows={fabrics} onChange={setFabrics} />
            </SectionCard>

            <SectionCard icon={Scissors} title="2 · Costo de avíos" subtitle="(Precio US ÷ numerador de precio) × consumo"
              right={<Big label="Costo de avíos" value={money(r.costOfTrims)} />}>
              <TrimTable rows={trims} onChange={setTrims} />
            </SectionCard>

            <SummaryStrip items={[
              ["Costo de tela", money(r.costOfFabric)],
              ["Costo de avíos", money(r.costOfTrims)],
              ["3 · Costo total de material", money(r.totalMaterialCost), true],
            ]} />
          </>
        )}

        {/* ---- STEP 2: manufacturing -------------------------------------- */}
        {step.id === "manufactura" && (
          <>
            <SectionCard icon={Factory} title="Mano de obra y merma" subtitle="Tiempo estándar, costo por minuto y desperdicio">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <Field label="SAM (min)" value={inputs.sam} onChange={(v) => setInput("sam", v)} />
                <Field label="CPM · costo por minuto" value={inputs.cpm} onChange={(v) => setInput("cpm", v)} />
                <Derived label="5 · Costo MO" hint="CPM × SAM" value={money(r.moCost)} />
                <PctField label="Merma de material" value={rates.materialWaste} onChange={(v) => setRate("materialWaste", v)} />
                <Derived label="4 · Merma (2%)" hint="Costo total material × %" value={money(r.materialWaste)} />
                <Field label="Overhead fijo" value={inputs.fixedOverhead} onChange={(v) => setInput("fixedOverhead", v)} />
              </div>
            </SectionCard>

            <SectionCard icon={Coins} title="Fletes, licencias y gastos" subtitle="Bases indicadas en cada línea">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <Field label="6 · Flete" value={inputs.freight} onChange={(v) => setInput("freight", v)} />
                <PctField label="Seconds" value={rates.seconds} onChange={(v) => setRate("seconds", v)} />
                <Derived label="Seconds (3%)" hint="(material + merma) × %" value={money(r.seconds)} />
                <Field label="Licencia 15%" value={inputs.license} onChange={(v) => setInput("license", v)} />
                <Field label="Costo del skytex" value={inputs.costoSkytex} onChange={(v) => setInput("costoSkytex", v)} />
                <div />
                <PctField label="Gasto operativo" value={rates.operating} onChange={(v) => setRate("operating", v)} />
                <Derived label="8 · Gasto operativo" hint="Costo de tela × %" value={money(r.operatingExpense)} />
                <div />
                <PctField label="Gasto financiero" value={rates.financial} onChange={(v) => setRate("financial", v)} />
                <Derived label="9 · Gasto financiero" hint="Costo de tela × %" value={money(r.financialExpense)} />
                <div />
                <PctField label="Producción skytex" value={rates.skytexProd} onChange={(v) => setRate("skytexProd", v)} />
                <Derived label="10 · Producción skytex" hint="Costo de tela × %" value={money(r.skytexProduction)} />
                <div />
                <PctField label="Gasto directo casa" value={rates.homeDirect} onChange={(v) => setRate("homeDirect", v)} />
                <Derived label="7 · Gasto directo (2%)" hint="Costo material × % · informativo" value={money(r.homeDirect)} muted />
                <div />
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-[11px] text-slate-400">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>
                  El gasto directo de casa (2%) se muestra como referencia y <b className="text-slate-500">no</b> se suma al costo bruto, tal como en la lista del paso 11.
                  Las bases de gasto operativo/financiero/skytex usan el <b className="text-slate-500">costo de tela</b>; ajusta el porcentaje o la base si tu hoja difiere.
                </span>
              </p>
            </SectionCard>

            <SummaryStrip items={[
              ["Overhead fijo", money(r.fixedOverhead)],
              ["Merma", money(r.materialWaste)],
              ["Costo MO", money(r.moCost)],
              ["11 · Costo bruto", money(r.grossCost), true],
            ]} />
          </>
        )}

        {/* ---- STEP 3: selling ------------------------------------------- */}
        {step.id === "venta" && (
          <>
            <SectionCard icon={TrendingUp} title="Precio y margen bruto" subtitle="Precio de venta bruto contra costo bruto"
              right={<Big label="12 · Margen bruto" value={pct(r.grossMargin)} accent={r.grossMargin >= 0 ? "emerald" : "rose"} />}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <Field label="Precio de venta bruto" value={inputs.grossSellingPrice} onChange={(v) => setInput("grossSellingPrice", v)} />
                <Derived label="Costo bruto" hint="del paso 2" value={money(r.grossCost)} />
                <Derived label="12 · Margen bruto" hint="(venta − costo) / venta" value={pct(r.grossMargin)} />
              </div>
            </SectionCard>

            <SectionCard icon={Percent} title="Descuentos y contratos" subtitle="Descuento al cliente, centro de distribución y otros">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <Field label="13 · Descuento cliente" value={inputs.customerDiscount} onChange={(v) => setInput("customerDiscount", v)} />
                <Derived label="14 · Utilidad tras descuento" hint="venta − descuento" value={money(r.netAfterDiscount)} />
                <div />
                <PctField label="Contrato centro distribución" value={rates.distributionCenter} onChange={(v) => setRate("distributionCenter", v)} />
                <Derived label="15 · Centro de distribución" hint="venta × %" value={money(r.distributionCenter)} />
                <div />
                <Field label="16 · Demostración" value={inputs.demonstration} onChange={(v) => setInput("demonstration", v)} />
                <Field label="17 · Gasto cargado" value={inputs.chargedExpense} onChange={(v) => setInput("chargedExpense", v)} />
                <div />
              </div>
            </SectionCard>

            <SummaryStrip items={[
              ["18 · Precio neto de venta", money(r.netSellingPrice), true],
              ["19 · Margen neto", pct(r.netMargin), true],
            ]} />
          </>
        )}

        {/* ---- STEP 4: summary ------------------------------------------- */}
        {step.id === "resumen" && (
          <SectionCard icon={ClipboardCheck} title="Resumen del costeo" subtitle="Desglose completo de las 19 líneas">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10">
              <LineList title="Material y manufactura" lines={[
                ["1 · Costo de tela", money(r.costOfFabric)],
                ["2 · Costo de avíos", money(r.costOfTrims)],
                ["3 · Costo total de material", money(r.totalMaterialCost)],
                ["4 · Merma de material", money(r.materialWaste)],
                ["5 · Costo MO (CPM × SAM)", money(r.moCost)],
                ["6 · Flete", money(r.freight)],
                ["· Seconds (3%)", money(r.seconds)],
                ["· Licencia 15%", money(r.license)],
                ["7 · Gasto directo casa (2%, ref.)", money(r.homeDirect)],
                ["8 · Gasto operativo (6.24%)", money(r.operatingExpense)],
                ["9 · Gasto financiero (3%)", money(r.financialExpense)],
                ["10 · Producción skytex (3%)", money(r.skytexProduction)],
                ["· Overhead fijo", money(r.fixedOverhead)],
                ["· Costo del skytex", money(r.costoSkytex)],
              ]} />
              <LineList title="Venta y márgenes" strong={["11 · Costo bruto", "18 · Precio neto de venta", "19 · Margen neto"]} lines={[
                ["11 · Costo bruto", money(r.grossCost)],
                ["· Precio de venta bruto", money(r.grossSellingPrice)],
                ["12 · Margen bruto", pct(r.grossMargin)],
                ["13 · Descuento cliente", money(r.customerDiscount)],
                ["14 · Utilidad tras descuento", money(r.netAfterDiscount)],
                ["15 · Centro de distribución", money(r.distributionCenter)],
                ["16 · Demostración", money(r.demonstration)],
                ["17 · Gasto cargado", money(r.chargedExpense)],
                ["18 · Precio neto de venta", money(r.netSellingPrice)],
                ["19 · Margen neto", pct(r.netMargin)],
              ]} />
            </div>

            {saved && (
              <div className="mt-5 flex items-start gap-3 rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-3 text-sm text-emerald-800">
                <Check size={18} className="mt-0.5 shrink-0" />
                <div>Costeo guardado en la orden <b className="font-mono">{head.styleNo || `#${orderId}`}</b>. Puedes volver al listado o seguir ajustando.</div>
              </div>
            )}
          </SectionCard>
        )}
      </main>

      {/* sticky action bar */}
      <div className="fixed bottom-0 inset-x-0 z-40 border-t border-slate-200 bg-white/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => goto(stepIdx - 1)} disabled={stepIdx === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 disabled:opacity-40 hover:border-slate-400">
            <ChevronLeft size={16} /> Anterior
          </button>
          <div className="hidden sm:block text-xs text-slate-400">Paso {step.n} de {STEPS.length} · {step.label}</div>
          <div className="ml-auto flex items-center gap-3">
            <button onClick={() => onDone?.()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-500 hover:border-slate-400">
              Cerrar
            </button>
            {step.id !== "resumen" ? (
              <button onClick={() => goto(stepIdx + 1)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
                Siguiente <ChevronRight size={16} />
              </button>
            ) : (
              <button onClick={save} disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />} Guardar costeo
              </button>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm text-white shadow-lg ${toast.kind === "error" ? "bg-rose-600" : "bg-slate-900"}`}>
          {toast.kind === "error" ? <AlertCircle size={15} /> : <Check size={15} />} {toast.msg}
        </div>
      )}
    </div>
  );
}

// ---- persistence helpers --------------------------------------------------
const stripKeys = (rows) => rows.map(({ key, lineCost, ...rest }) => rest);
const totalsOnly = (r) => ({
  costOfFabric: r.costOfFabric, costOfTrims: r.costOfTrims, totalMaterialCost: r.totalMaterialCost,
  grossCost: r.grossCost, grossMargin: r.grossMargin, netSellingPrice: r.netSellingPrice, netMargin: r.netMargin,
});

// ==========================================================================
//  Small presentational primitives (match the app's slate card style)
// ==========================================================================
function SectionCard({ icon: Icon, title, subtitle, right, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0"><Icon size={18} /></div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-800 truncate">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
        </div>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400";

function Field({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      <input type="number" inputMode="decimal" className={`${inputCls} text-right font-mono`} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function PctField({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label} (%)</span>
      <div className="relative">
        <input type="number" inputMode="decimal" className={`${inputCls} text-right font-mono pr-7`}
          value={value === "" ? "" : +(n(value) * 100).toFixed(4)} onChange={(e) => onChange(e.target.value)} />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">%</span>
      </div>
    </label>
  );
}

function Derived({ label, hint, value, muted }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${muted ? "border-slate-100 bg-slate-50" : "border-slate-200 bg-slate-50"}`}>
      <div className="text-xs font-medium text-slate-600">{label}</div>
      {hint && <div className="text-[10px] text-slate-400">{hint}</div>}
      <div className={`mt-0.5 text-sm font-semibold font-mono ${muted ? "text-slate-500" : "text-slate-800"}`}>{value}</div>
    </div>
  );
}

function Metric({ label, value, accent }) {
  const cls = accent === "emerald" ? "text-emerald-300" : accent === "rose" ? "text-rose-300" : "text-white";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-sm font-semibold font-mono ${cls}`}>{value}</div>
    </div>
  );
}

function Big({ label, value, accent }) {
  const cls = accent === "emerald" ? "text-emerald-600" : accent === "rose" ? "text-rose-600" : "text-slate-900";
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-base font-bold font-mono ${cls}`}>{value}</div>
    </div>
  );
}

function SummaryStrip({ items }) {
  return (
    <div className="flex flex-wrap items-stretch gap-3">
      {items.map(([k, v, strong], i) => (
        <div key={i} className={`flex-1 min-w-[150px] rounded-xl border px-4 py-3 ${strong ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"}`}>
          <div className={`text-[10px] uppercase tracking-wide ${strong ? "text-slate-300" : "text-slate-400"}`}>{k}</div>
          <div className={`mt-0.5 text-base font-bold font-mono ${strong ? "text-white" : "text-slate-800"}`}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function LineList({ title, lines, strong = [] }) {
  return (
    <div className="py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">{title}</div>
      {lines.map(([k, v], i) => {
        const isStrong = strong.includes(k);
        return (
          <div key={i} className={`flex items-baseline justify-between gap-3 border-b border-slate-50 py-1.5 ${isStrong ? "font-semibold text-slate-900" : "text-slate-600"}`}>
            <span className="text-xs">{k}</span>
            <span className="text-sm font-mono">{v}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---- editable material tables --------------------------------------------
function FabricTable({ rows, onChange }) {
  const set = (key, k, v) => onChange(rows.map((r) => (r.key === key ? { ...r, [k]: v } : r)));
  const add = () => onChange([...rows, emptyFabric()]);
  const del = (key) => onChange(rows.length > 1 ? rows.filter((r) => r.key !== key) : [emptyFabric()]);
  return (
    <div className="space-y-2">
      <div className="hidden sm:grid grid-cols-12 gap-2 px-1 text-[11px] uppercase tracking-wide text-slate-400">
        <div className="col-span-6">Tela</div>
        <div className="col-span-2 text-right">Costo/yarda</div>
        <div className="col-span-2 text-right">Consumo</div>
        <div className="col-span-2 text-right">Importe</div>
      </div>
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-12 gap-2 items-center">
          <input className={`${inputCls} col-span-12 sm:col-span-6`} placeholder="Descripción / código" value={r.desc} onChange={(e) => set(r.key, "desc", e.target.value)} />
          <input type="number" inputMode="decimal" className={`${inputCls} col-span-4 sm:col-span-2 text-right font-mono`} placeholder="0" value={r.costPerYard} onChange={(e) => set(r.key, "costPerYard", e.target.value)} />
          <input type="number" inputMode="decimal" className={`${inputCls} col-span-4 sm:col-span-2 text-right font-mono`} placeholder="0" value={r.consumption} onChange={(e) => set(r.key, "consumption", e.target.value)} />
          <div className="col-span-3 sm:col-span-2 flex items-center justify-end gap-1">
            <span className="text-sm font-mono text-slate-700">{money(n(r.costPerYard) * n(r.consumption))}</span>
            <button onClick={() => del(r.key)} className="p-1 text-slate-300 hover:text-rose-600"><Trash2 size={15} /></button>
          </div>
        </div>
      ))}
      <button onClick={add} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><Plus size={15} /> Agregar tela</button>
    </div>
  );
}

function TrimTable({ rows, onChange }) {
  const set = (key, k, v) => onChange(rows.map((r) => (r.key === key ? { ...r, [k]: v } : r)));
  const add = () => onChange([...rows, emptyTrim()]);
  const del = (key) => onChange(rows.length > 1 ? rows.filter((r) => r.key !== key) : [emptyTrim()]);
  const line = (r) => (n(r.usPrice) / (n(r.priceNumerator) || 1)) * n(r.consumption);
  return (
    <div className="space-y-2">
      <div className="hidden sm:grid grid-cols-12 gap-2 px-1 text-[11px] uppercase tracking-wide text-slate-400">
        <div className="col-span-5">Avío</div>
        <div className="col-span-2 text-right">Precio US</div>
        <div className="col-span-1 text-right">Num.</div>
        <div className="col-span-2 text-right">Consumo</div>
        <div className="col-span-2 text-right">Importe</div>
      </div>
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-12 gap-2 items-center">
          <input className={`${inputCls} col-span-12 sm:col-span-5`} placeholder="Descripción / código" value={r.desc} onChange={(e) => set(r.key, "desc", e.target.value)} />
          <input type="number" inputMode="decimal" className={`${inputCls} col-span-4 sm:col-span-2 text-right font-mono`} placeholder="0" value={r.usPrice} onChange={(e) => set(r.key, "usPrice", e.target.value)} />
          <input type="number" inputMode="decimal" className={`${inputCls} col-span-3 sm:col-span-1 text-right font-mono`} placeholder="1" value={r.priceNumerator} onChange={(e) => set(r.key, "priceNumerator", e.target.value)} />
          <input type="number" inputMode="decimal" className={`${inputCls} col-span-3 sm:col-span-2 text-right font-mono`} placeholder="0" value={r.consumption} onChange={(e) => set(r.key, "consumption", e.target.value)} />
          <div className="col-span-2 sm:col-span-2 flex items-center justify-end gap-1">
            <span className="text-sm font-mono text-slate-700">{money(line(r))}</span>
            <button onClick={() => del(r.key)} className="p-1 text-slate-300 hover:text-rose-600"><Trash2 size={15} /></button>
          </div>
        </div>
      ))}
      <button onClick={add} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><Plus size={15} /> Agregar avío</button>
    </div>
  );
}