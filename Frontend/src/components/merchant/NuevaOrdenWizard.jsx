import { useEffect, useMemo, useRef, useState } from "react";
import {
  Layers, Ruler, Palette, Users, FileText, CalendarClock, Scissors,
  Plus, Trash2, Check, X, AlertCircle, RefreshCw, ChevronLeft, ChevronRight,
  Camera, ClipboardList,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { API_URL, TIPOS, MODELOS, TALLAS } from "../../lib/masterCodeCatalog";
import MerchantNavbar from "./MerchantNavbar";

/* -----------------------------------------------------------------------
 *  Step-by-step wizard: creates the master codes (one per size × color)
 *  AND the production order (PO) in a single submit.
 *  PO number: SKM####-<cliente>-<tipo><modelo><correlativo>
 * --------------------------------------------------------------------- */

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const STEPS = [
  { n: 1, label: "Estilo", icon: Layers },
  { n: 2, label: "Tallas y colores", icon: Palette },
  { n: 3, label: "Cliente", icon: Users },
  { n: 4, label: "Detalles y logística", icon: FileText },
  { n: 5, label: "Revisar", icon: ClipboardList },
];

// Temporada codes. Stored value is code + 2-digit year, e.g. "SU26".
const SEASONS = [
  { code: "SP", label: "Spring" },
  { code: "SU", label: "Summer" },
  { code: "FA", label: "Fall" },
  { code: "WN", label: "Winter" },
  { code: "HO", label: "Holiday" },
];

function SectionCard({ icon: Icon, title, subtitle, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center">
          <Icon size={18} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function ChipGrid({ options, value, onChange, cols = "grid-cols-3 sm:grid-cols-5" }) {
  return (
    <div className={`grid ${cols} gap-2`}>
      {options.map((opt) => {
        const active = value === opt.code;
        return (
          <button
            key={opt.code}
            type="button"
            onClick={() => onChange(opt.code)}
            className={`rounded-lg border px-2 py-2 text-center transition-all
              ${active ? "border-slate-900 bg-slate-900 text-white shadow"
                       : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"}`}
          >
            <span className="block font-mono text-sm font-bold tracking-wider">{opt.code}</span>
            <span className={`block text-[11px] ${active ? "text-slate-300" : "text-slate-400"}`}>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Drop blank entries and duplicates from a line's fabric list.
function cleanFabrics(list) {
  const out = [];
  const seen = new Set();
  for (const f of list || []) {
    const name = (f.name || "").trim();
    if (!name) continue;
    const code = (f.code || "").trim() || null;
    const yieldVal = (f.yield ?? "").toString().trim();
    const key = `${name}|${code || ""}`.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, code, yield: yieldVal === "" ? null : yieldVal });
  }
  return out;
}

// One labelled input inside a color-row card (step 2).
function RowField({ label, children, hint }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1" title={hint}>
        {label}
      </span>
      {children}
    </label>
  );
}

// Piezas de esta prenda por conjunto. 1 chamarra + 1 pantalon = ratio 1 en las
// dos; "1 chamarra + 2 pantalones" = 1 y 2.
const ratioNum = (v) => {
  const n = parseFloat(v);
  return !isFinite(n) || n <= 0 ? 1 : n;
};

// Arma las POs de UNA prenda a partir de la rejilla compartida del paso 2.
//   fabricsFor(row) -> las telas de ESTA prenda en esa fila de color
//   ratio           -> multiplica las cantidades capturadas
// Una PO por (color + estilo cliente + PO cliente + fecha de entrega + item code).
// Con item code activo, cada item code (destino de Nike) es su PROPIA PO aunque
// todo lo demás coincida.
//   withItemCode    -> respeta el item code de cada línea (reparto de Nike por
//                      destino). Dos líneas con la misma talla pero distinto
//                      item code quedan como líneas SEPARADAS de la misma PO.
function buildPoPlan({ colorRows, sizes, fabricsFor, ratio = 1, withItemCode = false }) {
  const order = [];            // first-seen order of the buckets
  const buckets = new Map();   // key -> { cells: [] }
  const packingOf = (row, talla) => parseInt(row.packing?.[talla], 10) || 0;
  const skuOf = (row, talla) => parseInt(row.sku?.[talla], 10) || 0;

  for (const row of colorRows) {
    const color = row.color.trim();
    const est = (row.estilo || "").trim();
    if (!color || est.length !== 6) continue;

    const customerPo = (row.customerPo || "").trim() || null;
    const commitmentDate = row.deliveryDate || null;
    const itemCode = withItemCode ? ((row.itemCode || "").trim() || null) : null;
    const meta = {
      estilo: est,
      customerPo,
      commitmentDate,
      itemCode,
      fabrics: cleanFabrics(fabricsFor(row)),
    };
    const rowCells = [];
    for (const talla of sizes) {
      // Las cantidades se capturan UNA vez (por conjunto) y cada prenda las
      // multiplica por su ratio.
      const packingQty = packingOf(row, talla) * ratio;
      const skuQty = skuOf(row, talla) * ratio;
      const q = packingQty + skuQty;
      if (q > 0) rowCells.push({ talla, color, ...meta, packingQty, skuQty, quantity: q });
    }
    if (rowCells.length === 0) continue;

    const key = `${color}|${est}|${customerPo || ""}|${commitmentDate || ""}|${itemCode || ""}`;
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { cells: [] }; buckets.set(key, bucket); order.push(key); }
    for (const cell of rowCells) {
      // Misma talla + mismo item code = se suma. Distinto item code = otra
      // línea de la PO (el índice único incluye item_code).
      const dup = bucket.cells.find(
        (c) => c.talla === cell.talla && (c.itemCode || "") === (cell.itemCode || "")
      );
      if (dup) {
        dup.quantity += cell.quantity;
        // packing y sku son piezas: se suman igual que la cantidad.
        dup.packingQty += cell.packingQty;
        dup.skuQty += cell.skuQty;
        const seenTela = new Set(dup.fabrics.map((f) => `${f.name}|${f.code || ""}`.toUpperCase()));
        for (const f of cell.fabrics || []) {
          const k = `${f.name}|${f.code || ""}`.toUpperCase();
          if (!seenTela.has(k)) { seenTela.add(k); dup.fabrics = [...dup.fabrics, f]; }
        }
      } else {
        bucket.cells.push({ ...cell, fabrics: [...(cell.fabrics || [])] });
      }
    }
  }

  const firstOf = (cells, k) => cells.find((c) => c[k])?.[k] || null;
  // Distinct name+code pairs across the PO's lines.
  const mergeFabrics = (cells) => {
    const out = [];
    const seen = new Set();
    for (const c of cells) {
      for (const f of c.fabrics || []) {
        const key = `${f.name}|${f.code || ""}`.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(f);
      }
    }
    return out;
  };
  return order
    .map((key) => buckets.get(key))
    .filter((b) => b.cells.length > 0)
    .map((b) => {
      const fabricList = mergeFabrics(b.cells);
      return {
        cells: b.cells,
        // header summary = first line that has a value
        date: firstOf(b.cells, "commitmentDate"),
        fabricList,
        fabricName: fabricList[0]?.name || null,
        fabricCode: fabricList[0]?.code || null,
        yield: fabricList[0]?.yield ?? null,
        customerPos: [...new Set(b.cells.map((c) => c.customerPo).filter(Boolean))].join(", ") || null,
        itemCodes: [...new Set(b.cells.map((c) => c.itemCode).filter(Boolean))].join(", ") || null,
        fabrics: fabricList
          .map((f) => `${f.name}${f.code ? ` (${f.code})` : ""}${f.yield ? ` \u00b7 rend ${f.yield}` : ""}`)
          .join(", ") || null,
        pieces: b.cells.reduce((s, c) => s + c.quantity, 0),
        colors: [...new Set(b.cells.map((c) => c.color))].join(", "),
        estilos: [...new Set(b.cells.map((c) => c.estilo))].join(", "),
      };
    });
}

// Una PRENDA del pedido. Un pedido normal tiene una; un CONJUNTO (caso Reebok:
// chamarra + pantalon) tiene dos o mas. Cada prenda es su propio estilo, su
// propio SAM y su propia foto — y termina siendo su propia PO en produccion.
// Las CANTIDADES no viven aqui: son las del paso 2, compartidas por todas las
// prendas y multiplicadas por el ratio de cada una.
let COMPONENT_SEQ = 0;
const newComponent = (label = "") => ({
  id: `c${++COMPONENT_SEQ}`,
  label,                 // CHAMARRA / PANTALON — lo que FWH vera en la caja
  tipo: "", modelo: "", correlativo: "",
  description: "", sam: "",
  photo: null,
  ratio: "1",            // piezas de esta prenda por conjunto
  warehouseStock: "", extraQuantity: "",
  autoFilling: false,
});

export default function NuevaOrdenWizard() {
  const [step, setStep] = useState(1);

  // Pre-orden de origen (opcional). /nuevo-orden-wizard?preOrderId=123 abre el
  // wizard con el estilo, el cliente y las piezas ya comprometidas; lo que falta
  // — tallas, colores, telas, entregas, SAM — es justo lo que se captura aquí.
  // Al crear la(s) PO(s) la pre-orden se marca como convertida.
  const location = useLocation();
  const navigate = useNavigate();
  const preOrderId = new URLSearchParams(location.search).get("preOrderId");
  const [preOrder, setPreOrder] = useState(null);

  // catalogs
  const [customers, setCustomers] = useState([]);
  const [fabrics, setFabrics] = useState([]);
  const [skmSeq, setSkmSeq] = useState("");

  // step 1 — prendas (1 = pedido normal, 2+ = CONJUNTO)
  const [components, setComponents] = useState([newComponent()]);
  const isSet = components.length > 1;
  const primary = components[0];
  // Alias de solo lectura para todo lo que ya esperaba UN estilo. La prenda 1
  // sigue siendo "el estilo de la orden".
  const { tipo, modelo, correlativo, autoFilling } = primary;

  const setComp = (i, patch) =>
    setComponents((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const addComponent = () =>
    setComponents((cs) => (cs.length >= 4 ? cs : [...cs, newComponent()]));
  const removeComponent = (i) =>
    setComponents((cs) => (cs.length === 1 ? cs : cs.filter((_, idx) => idx !== i)));

  // step 2 — one line per color + estilo cliente + PO cliente, each with its
  // own delivery date, fabric, fabric code, yield and size quantities.
  const [sizes, setSizes] = useState([]); // array of talla codes
  // Each line may use SEVERAL fabrics, each with its own code:
  //   fabrics: [{ name, code }, ...]
  const [colorRows, setColorRows] = useState([
    { color: "", estilo: "", itemCode: "", packing: {}, sku: {}, customerPo: "", deliveryDate: "", fabrics: [{ name: "", code: "", yield: "" }] },
  ]); // packing / sku (piezas) keyed by talla; la cantidad de la talla = packing + sku

  // step 3 — customer
  const [customerId, setCustomerId] = useState("");
  const [clienteCode, setClienteCode] = useState("");

  // ITEM CODE por línea. Nike reparte una misma PO entre varios destinos y cada
  // destino trae su propio item code: la misma talla/color/estilo se captura en
  // varias líneas, una por item code, y CADA item code es su propia PO. Se enciende sola cuando el cliente es Nike; para otros clientes
  // es opcional.
  const [useItemCodes, setUseItemCodes] = useState(false);

  // step 4 — details + logistics. La descripcion, el SAM, la foto, el stock y
  // los extras son POR PRENDA (viven en components[]): el SAM de una chamarra
  // no es el de un pantalon, y el stock de una no descuenta la otra.
  const description = primary.description;
  const sam = primary.sam;
  const photo = primary.photo;
  const [seasonCode, setSeasonCode] = useState("");
  const [seasonYear, setSeasonYear] = useState(String(new Date().getFullYear()).slice(-2));
  const warehouseStock = primary.warehouseStock;
  const extraQuantity = primary.extraQuantity;
  // Conversión incremental: cuando se completa una pre-orden que trae varias POs
  // de cliente y solo llegó la tela de una(s), el merchant marca esto para crear
  // SOLO esas POs y dejar la pre-orden como 'parcial' con el resto pendiente.
  const [keepRemaining, setKeepRemaining] = useState(false);

  const [saving, setSaving] = useState(false);
  const [savingFabric, setSavingFabric] = useState(null); // name being added to the catalog
  const [toast, setToast] = useState(null);
  const fileRef = useRef(null);

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  };

  // load catalogs + next SKM sequence
  useEffect(() => {
    (async () => {
      try {
        const [custRes, fabRes, seqRes] = await Promise.all([
          fetch(`${API_URL}/api/customers`, { headers: authHeaders() }),
          fetch(`${API_URL}/api/fabrics`, { headers: authHeaders() }),
          fetch(`${API_URL}/api/production-orders/next-number`, { headers: authHeaders() }),
        ]);
        if (custRes.ok) setCustomers((await custRes.json()).customers || []);
        if (fabRes.ok) setFabrics((await fabRes.json()).fabrics || []);
        if (seqRes.ok) setSkmSeq((await seqRes.json()).sequence || "");
      } catch {
        showToast("⚠️ No se pudieron cargar los catálogos", true);
      }
    })();
  }, []);

  // Cliente Nike -> activa el item code por línea (no lo apaga si se cambia de
  // cliente: lo ya capturado no se pierde, el merchant lo apaga a mano).
  useEffect(() => {
    const c = customers.find((x) => String(x.id) === String(customerId));
    if (c && /nike/i.test(`${c.name || ""} ${c.code || ""}`)) setUseItemCodes(true);
  }, [customerId, customers]);

  // Carga la pre-orden y precarga los pasos 1, 3 y 4 con lo que ya se sabe.
  useEffect(() => {
    if (!preOrderId) return;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/pre-orders/${preOrderId}`, { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo cargar la pre-orden");
        const p = data.preOrder;
        if (p.status === "converted") {
          showToast(`${p.pre_order_no} ya se convirtió en ${p.work_order_nos || "una PO"}`, true);
          return;
        }
        setPreOrder(p);
        // La pre-orden precarga la PRIMERA prenda; si el pedido resulta ser un
        // conjunto, el merchant agrega la segunda a mano en el paso 1.
        setComponents((cs) => cs.map((c, i) => (i === 0 ? {
          ...c,
          tipo: p.tipo || c.tipo,
          modelo: p.modelo || c.modelo,
          correlativo: p.correlativo || c.correlativo,
          description: p.style_description || c.description,
          // Si la pre-orden ya traia SAM, se hereda para no recapturarlo.
          sam: Number(p.sam_minutes) > 0 ? String(p.sam_minutes) : c.sam,
        } : c)));
        if (p.customer_id) setCustomerId(String(p.customer_id));
        if (p.cliente_code) setClienteCode(p.cliente_code);
        // Estilo cliente y PO del cliente entran en la primera línea del paso 2,
        // donde las piezas se reparten por talla y color.
        if (p.estilo || p.customer_po) {
          setColorRows((rows) => rows.map((r, i) => (i === 0
            ? { ...r, estilo: p.estilo || r.estilo, customerPo: p.customer_po || r.customerPo }
            : r)));
        }
        // "Por repartir" = lo que falta por convertir (importa al reabrir una parcial).
        const remaining = Number(p.remaining_pieces != null ? p.remaining_pieces : p.pieces) || 0;
        const already = p.status === "partially_converted" && p.work_order_nos
          ? ` · ya convertidas: ${p.work_order_nos}`
          : "";
        showToast(`Pre-orden ${p.pre_order_no} cargada · ${remaining.toLocaleString()} pzs por repartir${already}`);
      } catch (err) {
        showToast(err.message, true);
      }
    })();
  }, [preOrderId]); // eslint-disable-line react-hooks/exhaustive-deps

  // auto-fetch correlativo when tipo+modelo chosen — para CADA prenda, porque
  // en un conjunto la chamarra y el pantalon llevan correlativos distintos.
  const styleKeys = components.map((c) => `${c.tipo}|${c.modelo}|${c.correlativo}`).join(",");
  useEffect(() => {
    components.forEach((c, i) => {
      if (!c.tipo || !c.modelo || c.correlativo || c.autoFilling) return;
      (async () => {
        setComp(i, { autoFilling: true });
        try {
          const res = await fetch(
            `${API_URL}/api/master-codes/next-correlativo?type=${c.tipo}&modelo=${c.modelo}`,
            { headers: authHeaders() }
          );
          if (res.ok) {
            const data = await res.json();
            if (data.success) setComp(i, { correlativo: data.nextCorrelativo });
          }
        } catch { /* keep manual entry */ }
        finally { setComp(i, { autoFilling: false }); }
      })();
    });
  }, [styleKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------- derived -----------------------------------------------------
  const styleBase = `${tipo}${modelo}${correlativo}`;

  // La cantidad de una talla = packing + sku (ambas en piezas).
  const packingOf = (row, talla) => parseInt(row.packing?.[talla], 10) || 0;
  const skuOf = (row, talla) => parseInt(row.sku?.[talla], 10) || 0;
  const sizeQtyOf = (row, talla) => packingOf(row, talla) + skuOf(row, talla);

  const cells = useMemo(() => {
    const out = [];
    for (const row of colorRows) {
      const color = row.color.trim();
      const est = (row.estilo || "").trim();
      if (!color) continue;
      const meta = {
        estilo: est,
        customerPo: (row.customerPo || "").trim() || null,
        itemCode: useItemCodes ? ((row.itemCode || "").trim() || null) : null,
      };
      for (const talla of sizes) {
        const packingQty = packingOf(row, talla);
        const skuQty = skuOf(row, talla);
        const q = packingQty + skuQty;
        if (q > 0) out.push({
          talla, color, ...meta,
          packingQty, skuQty,
          quantity: q, // = packing + sku
        });
      }
    }
    return out;
  }, [colorRows, sizes, useItemCodes]);

  // Per-color estilo checks (step 2)
  const activeColorRows = colorRows.filter((r) => r.color.trim());
  const colorList = activeColorRows.map((r) => r.color.trim());
  // A row's color+estilo may repeat; POs are split by color+estilo+PO+entrega (see poPlan).
  const allEstiloValid =
    activeColorRows.length > 0 && activeColorRows.every((r) => (r.estilo || "").trim().length === 6);
  // Con item code activo, cada línea necesita el suyo: una línea sin item code
  // no se sabe a qué destino va.
  const allItemCodesValid =
    !useItemCodes || activeColorRows.every((r) => (r.itemCode || "").trim().length > 0);
  // Misma PO (color+estilo+PO cliente+entrega) con el mismo item code repetido:
  // las cantidades se suman, casi siempre es un error de captura.
  const repeatedItemCodes = useItemCodes
    ? (() => {
        const seen = new Set(), dups = new Set();
        for (const r of activeColorRows) {
          const ic = (r.itemCode || "").trim();
          if (!ic) continue;
          const k = [r.color.trim(), (r.estilo || "").trim(), (r.customerPo || "").trim(), r.deliveryDate || "", ic].join("|");
          if (seen.has(k)) dups.add(ic); else seen.add(k);
        }
        return [...dups];
      })()
    : [];

  // ---- telas POR PRENDA (accesor) --------------------------------------
  // Se declara ANTES del useMemo de abajo: ese memo corre durante el render y
  // usa este accesor, asi que declararlo despues seria un ReferenceError.
  // La prenda 1 sigue usando row.fabrics (nada cambia para un pedido normal);
  // las prendas 2+ guardan las suyas en row.fabricsBy[compId].
  const blankFabrics = () => [{ name: "", code: "", yield: "" }];
  const fabricsOf = (row, ci) =>
    (ci === 0 ? row.fabrics : row.fabricsBy?.[components[ci]?.id]) || blankFabrics();

  // Build the PO buckets: ONE PO per (color + estilo + PO cliente + fecha de
  // entrega) Y POR PRENDA. Rows that share all four merge into the same PO; the
  // rest of the details (tallas, cantidades, telas, código de tela,
  // rendimiento) travel with the bucket. A repeated talla inside a bucket has
  // its quantity summed and its telas unioned — the (work_order_id, talla,
  // color, estilo) unique index allows only one line per size in a PO. The
  // header keeps the bucket's values as a summary. This mirrors the split the
  // backend enforces.
  //
  // En un CONJUNTO la rejilla de cantidades es UNA SOLA (se captura una vez) y
  // cada prenda la multiplica por su ratio. Por eso el plan se calcula una vez
  // POR PRENDA con las telas y el ratio de esa prenda.
  const plans = useMemo(
    () => components.map((c, ci) => buildPoPlan({
      colorRows, sizes,
      fabricsFor: (row) => fabricsOf(row, ci),
      ratio: ratioNum(c.ratio),
      withItemCode: useItemCodes,
    })),
    [colorRows, sizes, components, useItemCodes] // eslint-disable-line react-hooks/exhaustive-deps
  );
  // El plan de la prenda 1: lo que ya usaban la revisión y los totales.
  const poPlan = plans[0] || [];
  // Cuántas POs se van a crear en total (todas las prendas).
  const totalPos = plans.reduce((n, p) => n + p.length, 0);


  // La rejilla del paso 2 se captura UNA vez. En un pedido normal eso son
  // piezas; en un conjunto son CONJUNTOS, y cada prenda multiplica por su ratio.
  const orderedQty = cells.reduce((s, c) => s + c.quantity, 0);
  const setsQty = orderedQty;
  // Piezas reales que va a coser la planta, sumando todas las prendas.
  const piecesTotal = components.reduce((t, c) => t + setsQty * ratioNum(c.ratio), 0);
  // Stock y extras son por prenda: el total a producir los descuenta prenda a
  // prenda, no una sola vez sobre el conjunto.
  const totalToProduce = components.reduce((t, c) => t + Math.max(
    setsQty * ratioNum(c.ratio) - (parseFloat(c.warehouseStock) || 0) + (parseFloat(c.extraQuantity) || 0), 0
  ), 0);
  const season = seasonCode ? `${seasonCode}${seasonYear}` : "";

  // Piezas comprometidas en la pre-orden vs. las capturadas hasta ahora. Es una
  // referencia, no un candado: la orden real puede subir o bajar.
  // Al reabrir una pre-orden parcial, la referencia es lo que FALTA, no el total.
  const preOrderPieces = preOrder
    ? Number(preOrder.remaining_pieces != null ? preOrder.remaining_pieces : preOrder.pieces) || 0
    : 0;
  const piecesDiff = preOrder ? orderedQty - preOrderPieces : 0;

  // ------- step handlers ----------------------------------------------
  // Order selected sizes by their position in the TALLAS catalog (smallest →
  // largest), not by click order, so the grid columns and review read naturally.
  const sizeOrder = (code) => {
    const i = TALLAS.findIndex((t) => t.code === code);
    return i === -1 ? 999 : i;
  };
  const toggleSize = (code) =>
    setSizes((s) =>
      s.includes(code)
        ? s.filter((x) => x !== code)
        : [...s, code].sort((a, b) => sizeOrder(a) - sizeOrder(b))
    );

  const setColor = (i, val) =>
    setColorRows((rows) => rows.map((r, idx) =>
      idx === i ? { ...r, color: val.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) } : r));
  const setEstiloRow = (i, val) =>
    setColorRows((rows) => rows.map((r, idx) =>
      idx === i ? { ...r, estilo: val.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) } : r));
  // La cantidad asignada a cada talla se captura en dos partes: packing y SKU.
  // La cantidad de la talla es la suma de ambas (packing + sku). Solo enteros.
  const setPacking = (i, talla, val) =>
    setColorRows((rows) => rows.map((r, idx) =>
      idx === i ? { ...r, packing: { ...r.packing, [talla]: val.replace(/[^0-9]/g, "") } } : r));
  const setSku = (i, talla, val) =>
    setColorRows((rows) => rows.map((r, idx) =>
      idx === i ? { ...r, sku: { ...r.sku, [talla]: val.replace(/[^0-9]/g, "") } } : r));
  // Generic per-line setter for the non-normalised fields (PO cliente, entrega,
  // tela, código de tela, rendimiento).
  const setRowField = (i, key, val) =>
    setColorRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  // Item code de Nike: alfanumérico + guion, en mayúsculas.
  const setItemCode = (i, val) =>
    setRowField(i, "itemCode", val.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 40));
  // Copia la línea (color, estilo, PO, entrega, telas) justo debajo, con item
  // code y cantidades en blanco: así se reparte la misma línea entre destinos.
  const duplicateRow = (i) =>
    setColorRows((rows) => {
      const src = rows[i];
      const copy = {
        ...src,
        itemCode: "",
        packing: {},
        sku: {},
        fabrics: (src.fabrics || []).map((f) => ({ ...f })),
        ...(src.fabricsBy
          ? { fabricsBy: Object.fromEntries(Object.entries(src.fabricsBy).map(([k, v]) => [k, (v || []).map((f) => ({ ...f }))])) }
          : {}),
      };
      return [...rows.slice(0, i + 1), copy, ...rows.slice(i + 1)];
    });
  const newRow = () => ({
    color: "", estilo: "", itemCode: "", packing: {}, sku: {}, customerPo: "",
    deliveryDate: "", fabrics: [{ name: "", code: "", yield: "" }],
  });

  // Register a fabric name in the catalog (POST /api/fabrics) so it shows up in
  // the suggestions from now on. The per-line CODE stays on the work order —
  // the catalog only stores names.
  const saveFabricToCatalog = async (rawName, rawCode) => {
    const name = (rawName || "").trim();
    if (!name || savingFabric) return;
    setSavingFabric(name);
    try {
      const res = await fetch(`${API_URL}/api/fabrics`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name, code: (rawCode || "").trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo guardar la tela");
      setFabrics((f) => [...f, data.fabric].sort((a, b) => a.name.localeCompare(b.name)));
      showToast(`✅ Tela "${name}" agregada al catálogo`);
    } catch (err) {
      showToast(`⚠️ ${err.message}`, true);
    } finally {
      setSavingFabric(null);
    }
  };

  // ---- per-line fabric list -------------------------------------------
  const setFabricField = (i, j, key, val) =>
    setColorRows((rows) => rows.map((r, idx) => {
      if (idx !== i) return r;
      return {
        ...r,
        fabrics: r.fabrics.map((f, fi) => {
          if (fi !== j) return f;
          const next = { ...f, [key]: val };
          // Picking a catalogued fabric fills its code, unless one was typed.
          if (key === "name" && !(f.code || "").trim()) {
            const hit = fabrics.find((c) => (c.name || "").toLowerCase() === val.trim().toLowerCase());
            if (hit?.code) next.code = hit.code;
          }
          return next;
        }),
      };
    }));
  const addFabric = (i) =>
    setColorRows((rows) => rows.map((r, idx) =>
      idx === i ? { ...r, fabrics: [...r.fabrics, { name: "", code: "", yield: "" }] } : r));
  const removeFabric = (i, j) =>
    setColorRows((rows) => rows.map((r, idx) =>
      idx === i && r.fabrics.length > 1
        ? { ...r, fabrics: r.fabrics.filter((_, fi) => fi !== j) }
        : r));
  // ---- escritura de telas por prenda (el accesor esta mas arriba) --------
  const writeFabrics = (i, ci, next) =>
    setColorRows((rows) => rows.map((r, idx) => {
      if (idx !== i) return r;
      if (ci === 0) return { ...r, fabrics: next };
      return { ...r, fabricsBy: { ...(r.fabricsBy || {}), [components[ci].id]: next } };
    }));
  const setFabricFieldFor = (i, ci, j, key, val) => {
    const list = fabricsOf(colorRows[i], ci).map((f, fi) => {
      if (fi !== j) return f;
      const next = { ...f, [key]: val };
      // Picking a catalogued fabric fills its code, unless one was typed.
      if (key === "name" && !(f.code || "").trim()) {
        const hit = fabrics.find((c) => (c.name || "").toLowerCase() === val.trim().toLowerCase());
        if (hit?.code) next.code = hit.code;
      }
      return next;
    });
    writeFabrics(i, ci, list);
  };
  const addFabricFor = (i, ci) =>
    writeFabrics(i, ci, [...fabricsOf(colorRows[i], ci), { name: "", code: "", yield: "" }]);
  const removeFabricFor = (i, ci, j) => {
    const list = fabricsOf(colorRows[i], ci);
    if (list.length <= 1) return;
    writeFabrics(i, ci, list.filter((_, fi) => fi !== j));
  };

  const addColor = () => setColorRows((r) => [...r, newRow()]);
  const removeColor = (i) =>
    setColorRows((r) => (r.length === 1 ? r : r.filter((_, idx) => idx !== i)));

  const onCustomer = (id) => {
    setCustomerId(id);
    const c = customers.find((x) => String(x.id) === String(id));
    if (c?.code) setClienteCode(c.code.toUpperCase());
  };

  // La foto es de la PRENDA: la chamarra y el pantalon no son la misma imagen.
  const handlePhoto = (e, ci = 0) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Keep the File for the presigned S3 upload at submit time; the base64 is
    // only used for the on-screen preview thumbnail (not sent in the JSON body).
    const reader = new FileReader();
    reader.onload = () =>
      setComp(ci, { photo: { file, url: URL.createObjectURL(file), base64: reader.result } });
    reader.readAsDataURL(file);
  };

  // ------- validation per step ----------------------------------------
  // Cada prenda del conjunto se valida por separado: un conjunto a medio
  // capturar produciria una PO huerfana sin su pareja.
  const compName = (c, i) => (c.label || "").trim() || `Prenda ${i + 1}`;
  const compStyleOk = (c) => c.tipo && c.modelo && (c.correlativo || "").length === 2;
  const compDetailOk = (c) => (c.description || "").trim() && c.sam && Number(c.sam) > 0;
  // Nombres distintos: son la etiqueta que FWH usa para saber que pieza falta.
  const labelsOk = !isSet || (
    components.every((c) => (c.label || "").trim().length > 0) &&
    new Set(components.map((c) => (c.label || "").trim().toUpperCase())).size === components.length
  );

  const stepValid = (s) => {
    if (s === 1) return components.every(compStyleOk) && labelsOk;
    if (s === 2) return sizes.length > 0 && cells.length > 0 && allEstiloValid && allItemCodesValid;
    if (s === 3) return customerId && clienteCode.length === 3;
    if (s === 4) return components.every(compDetailOk);
    return true;
  };
  const canCreate = [1, 2, 3, 4].every(stepValid) && !saving;

  // Human-readable list of what's still blocking creation (shown on review step).
  const missing = [
    ...components.flatMap((c, i) => {
      const who = isSet ? ` — ${compName(c, i)}` : "";
      return [
        !c.tipo && `Tipo${who} (paso 1)`,
        !c.modelo && `Modelo${who} (paso 1)`,
        (c.correlativo || "").length !== 2 && `Correlativo de 2 dígitos${who} (paso 1)`,
        !(c.description || "").trim() && `Descripción${who} (paso 4)`,
        !(c.sam && Number(c.sam) > 0) && `SAM mayor a 0${who} (paso 4)`,
      ];
    }),
    !labelsOk && "Un nombre distinto para cada prenda del conjunto (paso 1)",
    sizes.length === 0 && "Al menos una talla (paso 2)",
    cells.length === 0 && "Cantidad en al menos una celda color × talla (paso 2)",
    !allEstiloValid && "Estilo cliente (6 caracteres) por cada color (paso 2)",
    !allItemCodesValid && "Item code en cada línea (paso 2)",
    !customerId && "Cliente (paso 3)",
    clienteCode.length !== 3 && "Código de cliente de 3 letras (paso 3)",
  ].filter(Boolean);

  const next = () => { if (stepValid(step)) setStep((s) => Math.min(5, s + 1)); };
  const back = () => setStep((s) => Math.max(1, s - 1));

  // ------- submit ------------------------------------------------------
  const handleCreate = async () => {
    if (!canCreate) return;
    setSaving(true);
    try {
      // Upload the photo straight to S3 first (presigned PUT), so only a small
      // key travels in the JSON body — this avoids Lambda's ~6MB request limit
      // (base64 in the body was hitting a 413). One image, shared by all POs.
      // Una foto POR PRENDA: la chamarra y el pantalon no son la misma imagen.
      const uploadPhoto = async (file) => {
        if (!file) return null;
        const presRes = await fetch(`${API_URL}/api/master-codes/photo-upload-url`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type || "image/jpeg",
          }),
        });
        const pres = await presRes.json();
        if (!presRes.ok || !pres.uploadUrl) throw new Error(pres.error || "No se pudo preparar la subida de la foto");
        const putRes = await fetch(pres.uploadUrl, { method: "PUT", body: file });
        if (!putRes.ok) throw new Error("No se pudo subir la foto a S3");
        return pres.photoKey;
      };
      const photoKeys = [];
      for (const c of components) photoKeys.push(await uploadPhoto(c.photo?.file));
      const photoKey = photoKeys[0];   // compat: la foto de la prenda 1

      // One atomic request. The backend creates one PO per bucket in poPlan
      // (distinct color+estilo rows share the first PO; each repeat is its own PO)
      // and auto-numbers them (SKM####).
      // Cada PO de cada prenda, ya con sus cantidades multiplicadas por el
      // ratio. El backend crea UNA PO por elemento de `orders` y, cuando hay 2+
      // prendas, tambien la cabecera del conjunto que las amarra.
      const ordersOf = (plan) => plan.map((p) => ({
        // Each cell carries its own customerPo, commitmentDate, fabricName,
        // fabricCode and yield -> work_order_lines. The order-level values
        // below are the header summary (and the fallback for blank lines).
        lines: p.cells,
        commitmentDate: p.date,
        fabrics: p.fabricList,
        fabricName: p.fabricName,
        fabricCode: p.fabricCode,
        yield: p.yield,
      }));

      const payload = {
        // Compat: la prenda 1 sigue viajando tambien en la raiz, para cualquier
        // consumidor viejo del endpoint.
        tipo, modelo, correlativo,
        clienteCode, customerId: Number(customerId),
        description: (description || "").trim(), sam: Number(sam),
        photoKey,
        orders: ordersOf(plans[0] || []),
        components: components.map((c, ci) => ({
          label: (c.label || "").trim() || null,   // CHAMARRA / PANTALON
          ratio: ratioNum(c.ratio),
          tipo: c.tipo, modelo: c.modelo, correlativo: c.correlativo,
          description: (c.description || "").trim(),
          sam: Number(c.sam),
          photoKey: photoKeys[ci] || null,
          // Stock y extras son POR PRENDA: el stock de chamarras no descuenta
          // pantalones.
          warehouseStock: parseFloat(c.warehouseStock) || 0,
          extraQuantity: parseFloat(c.extraQuantity) || 0,
          orders: ordersOf(plans[ci] || []),
        })),
        // Solo se usa cuando hay 2+ prendas.
        set: isSet ? { label: components.map((c, i) => compName(c, i)).join(" + ") } : null,
        season: season || null,
        // Compat con el cuerpo viejo (un solo estilo).
        warehouseStock: parseFloat(warehouseStock) || 0,
        extraQuantity: parseFloat(extraQuantity) || 0,
      };
      const res = await fetch(`${API_URL}/api/production-orders`, {
        method: "POST", headers: authHeaders(), body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudieron crear las órdenes");

      const nos = (data.workOrders || [data.workOrder]).filter(Boolean).map((w) => w.work_order_no);
      showToast(data.set
        ? `✅ Conjunto ${data.set.set_no} creado con ${nos.length} orden(es): ${nos.join(", ")}`
        : `✅ ${nos.length} orden(es) creada(s): ${nos.join(", ")}`);

      // Cierra la pre-orden y le deja el rastro de las POs que produjo. Si esto
      // falla las órdenes YA existen: se avisa y la pre-orden queda pendiente
      // para cerrarla a mano — no se deshace nada.
      if (preOrder) {
        try {
          const convRes = await fetch(`${API_URL}/api/pre-orders/${preOrder.id}/convert`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
              workOrderIds: (data.workOrders || [data.workOrder]).filter(Boolean).map((w) => w.id),
              workOrderNos: nos,
              // Parcial: crea solo estas POs y deja el resto de la pre-orden
              // pendiente. convertedPieces alimenta el contador y encoge la ficha
              // PRE (y sus holds) en el tablero por lo que acaba de salir.
              partial: keepRemaining,
              convertedPieces: orderedQty,
            }),
          });
          if (!convRes.ok) throw new Error("Las órdenes se crearon, pero la pre-orden sigue pendiente");
          showToast(
            keepRemaining
              ? `✅ ${nos.length} PO creada(s); ${preOrder.pre_order_no} queda parcial con el resto pendiente`
              : `✅ ${preOrder.pre_order_no} convertida`
          );
          setTimeout(() => navigate("/pre-ordenes"), 1200);
          return;
        } catch (err) {
          showToast(err.message, true);
        }
      }
      // reset
      setStep(1);
      setComponents([newComponent()]);
      setSizes([]); setColorRows([newRow()]);
      setCustomerId(""); setClienteCode("");
      setUseItemCodes(false);
      setSeasonCode("");
      if (fileRef.current) fileRef.current.value = "";
      const seqRes = await fetch(`${API_URL}/api/production-orders/next-number`, { headers: authHeaders() });
      if (seqRes.ok) setSkmSeq((await seqRes.json()).sequence || "");
    } catch (err) {
      showToast(`❌ ${err.message}`, true);
    } finally {
      setSaving(false);
    }
  };

  const fabricNames = fabrics.map((f) => f.name);
  const sizeLabel = (code) => TALLAS.find((t) => t.code === code)?.label || "";

  return (
    <div className="min-h-screen bg-slate-100">
      <MerchantNavbar
        title={preOrder ? `Completar ${preOrder.pre_order_no} → PO` : "Nueva orden · Código maestro + PO"}
        showRefresh={false}
      />

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Viene de una pre-orden: qué se comprometió y qué llevamos capturado */}
        {preOrder && (
          <div className="rounded-xl bg-slate-900 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ClipboardList size={16} className="text-slate-400" />
              <div>
                <p className="text-[11px] uppercase tracking-widest text-slate-400">Completando pre-orden</p>
                <p className="font-mono text-sm font-bold">
                  {preOrder.pre_order_no} · {preOrder.customer_name}
                  {preOrder.target_date ? ` · objetivo ${preOrder.target_date}` : ""}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-widest text-slate-400">Piezas capturadas</p>
              <p className="font-mono text-sm font-bold">
                {orderedQty.toLocaleString()}
                <span className="text-slate-400"> / {preOrderPieces.toLocaleString()}</span>
                {piecesDiff !== 0 && (
                  <span className={piecesDiff > 0 ? "ml-2 text-amber-300" : "ml-2 text-rose-300"}>
                    {piecesDiff > 0 ? `+${piecesDiff.toLocaleString()}` : piecesDiff.toLocaleString()}
                  </span>
                )}
              </p>
            </div>
          </div>
        )}

        {/* Stepper */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <div className="flex items-center">
            {STEPS.map((s, idx) => {
              const done = s.n < step;
              const active = s.n === step;
              return (
                <div key={s.n} className="flex items-center flex-1 last:flex-none">
                  <button
                    type="button"
                    onClick={() => s.n < step && setStep(s.n)}
                    className={`flex items-center gap-2 ${s.n < step ? "cursor-pointer" : "cursor-default"}`}
                  >
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0
                      ${active ? "bg-slate-900 text-white"
                        : done ? "bg-emerald-500 text-white"
                        : "bg-slate-200 text-slate-500"}`}>
                      {done ? <Check size={14} /> : s.n}
                    </span>
                    <span className={`text-xs font-medium hidden sm:block ${active ? "text-slate-900" : "text-slate-500"}`}>
                      {s.label}
                    </span>
                  </button>
                  {idx < STEPS.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-2 ${s.n < step ? "bg-emerald-400" : "bg-slate-200"}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Step 1 — Prendas (1 = pedido normal, 2+ = conjunto) */}
        {step === 1 && (
          <div className="space-y-4">
            {components.map((c, ci) => {
              const base = `${c.tipo}${c.modelo}${c.correlativo}`;
              return (
                <SectionCard
                  key={c.id}
                  icon={Layers}
                  title={isSet ? `1 · Prenda ${ci + 1}${c.label ? ` · ${c.label}` : ""}` : "1 · Estilo"}
                  subtitle="Tipo y modelo — el correlativo se genera solo"
                >
                  {isSet && (
                    <div className="flex items-end gap-3 mb-4">
                      <div className="flex-1">
                        <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                          Nombre de la prenda
                        </label>
                        <input
                          value={c.label}
                          onChange={(e) => setComp(ci, { label: e.target.value.toUpperCase().slice(0, 20) })}
                          placeholder="CHAMARRA"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm
                                     focus:outline-none focus:ring-2 focus:ring-slate-900"
                        />
                        <p className="text-[11px] text-slate-400 mt-1">
                          Es lo que verá el almacén al armar la caja
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                          Pzs por conjunto
                        </label>
                        <input
                          value={c.ratio}
                          onChange={(e) => setComp(ci, { ratio: e.target.value.replace(/[^0-9.]/g, "") })}
                          inputMode="decimal"
                          className="w-24 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-center
                                     focus:outline-none focus:ring-2 focus:ring-slate-900"
                        />
                      </div>
                      {components.length > 1 && (
                        <button type="button" onClick={() => removeComponent(ci)}
                          className="rounded-lg border border-slate-200 p-2 text-slate-400 hover:text-rose-600 hover:border-rose-300">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  )}

                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Tipo</p>
                  <ChipGrid options={TIPOS} value={c.tipo}
                    onChange={(v) => setComp(ci, { tipo: v, correlativo: "" })} />
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mt-5 mb-2">Modelo</p>
                  <ChipGrid options={MODELOS} value={c.modelo}
                    onChange={(v) => setComp(ci, { modelo: v, correlativo: "" })} />
                  <div className="mt-5 flex items-end gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">Correlativo</label>
                      <input
                        value={c.correlativo}
                        onChange={(e) => setComp(ci, { correlativo: e.target.value.replace(/[^0-9]/g, "").slice(0, 2) })}
                        placeholder="01"
                        className="w-24 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tracking-widest text-center
                                   focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                      <p className="text-[11px] text-slate-400 mt-1">{c.autoFilling ? "Cargando…" : "2 dígitos · auto"}</p>
                    </div>
                    {base.length === 8 && (
                      <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                        <span className="text-[11px] text-slate-500 uppercase tracking-wide">Estilo</span>
                        <p className="font-mono text-sm font-bold text-slate-800">{base}</p>
                      </div>
                    )}
                  </div>
                </SectionCard>
              );
            })}

            {/* CONJUNTO: el cliente compra chamarra + pantalón como una unidad.
                Se captura UNA vez; producción recibe una PO por prenda y el
                almacén las vuelve a juntar al final. */}
            {components.length < 4 && (
              <button type="button" onClick={addComponent}
                className="w-full rounded-xl border-2 border-dashed border-slate-300 bg-white px-4 py-3
                           text-sm font-medium text-slate-600 hover:border-slate-900 hover:text-slate-900
                           inline-flex items-center justify-center gap-2">
                <Plus size={16} />
                {isSet ? "Agregar otra prenda al conjunto" : "Es un conjunto (chamarra + pantalón)"}
              </button>
            )}
            {isSet && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3">
                <p className="text-xs text-indigo-800 leading-relaxed">
                  <b>Conjunto de {components.length} prendas.</b> Las tallas, colores y cantidades se
                  capturan <b>una sola vez</b> en el paso 2 y cada prenda las multiplica por sus
                  piezas por conjunto. Se creará <b>una PO por prenda</b> para producción, agrupadas
                  bajo un número de conjunto para el cliente y el almacén.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 2 — Sizes + colors grid */}
        {step === 2 && (
          <SectionCard icon={Palette} title="2 · Tallas, colores y cantidades" subtitle="Cada línea lleva su propio estilo cliente, PO, entrega, tela, rendimiento y cantidades por talla">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Tallas</p>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {TALLAS.map((t) => {
                const active = sizes.includes(t.code);
                return (
                  <button key={t.code} type="button" onClick={() => toggleSize(t.code)}
                    className={`rounded-lg border px-1 py-1.5 text-center transition-all
                      ${active ? "border-emerald-600 bg-emerald-600 text-white shadow"
                               : "border-slate-200 bg-white text-slate-700 hover:border-emerald-400"}`}>
                    <span className="block font-mono text-xs font-bold">{t.code}</span>
                    <span className={`block text-[10px] ${active ? "text-emerald-100" : "text-slate-400"}`}>{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Item code por línea (Nike reparte la PO por destino) */}
            <label className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 cursor-pointer">
              <input type="checkbox" checked={useItemCodes} onChange={(e) => setUseItemCodes(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300" />
              <span className="text-xs text-slate-600">
                <b className="text-slate-800">Item code por línea</b>
                <span className="text-slate-500"> · para clientes como Nike que reparten la misma PO entre varios destinos.
                  Captura una línea por item code (usa <i>Duplicar</i>); cada item code se vuelve su propia orden de
                  producción, aunque el color, estilo, PO y entrega sean iguales.</span>
              </span>
            </label>

            {sizes.length === 0 ? (
              <p className="text-sm text-slate-400 mt-4">Selecciona al menos una talla para capturar cantidades.</p>
            ) : (
              <>
              <div className="mt-5 space-y-3">
                {colorRows.map((row, i) => {
                  const rowPieces = sizes.reduce((sum, t) => sum + sizeQtyOf(row, t), 0);
                  const estiloBad = row.color.trim() && (row.estilo || "").trim().length !== 6;
                  return (
                    <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Línea {i + 1}
                          <span className="ml-2 font-mono text-slate-400 normal-case">
                            {rowPieces.toLocaleString()} pzs
                          </span>
                        </span>
                        <div className="flex items-center gap-1">
                          {useItemCodes && (
                            <button type="button" onClick={() => duplicateRow(i)}
                              title="Copiar esta línea para otro item code / destino"
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-200">
                              <Plus size={12} /> Duplicar
                            </button>
                          )}
                          <button type="button" onClick={() => removeColor(i)} disabled={colorRows.length === 1}
                            className="p-1.5 rounded hover:bg-rose-100 text-rose-500 disabled:opacity-30">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>

                      {/* Identity + logistics for this line */}
                      <div className={`grid grid-cols-2 sm:grid-cols-2 gap-2 ${useItemCodes ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
                        <RowField label="Color">
                          <input value={row.color} onChange={(e) => setColor(i, e.target.value)} placeholder="NEG"
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm uppercase tracking-widest
                                       focus:outline-none focus:ring-2 focus:ring-slate-900" />
                        </RowField>
                        <RowField label="Estilo cliente">
                          <input value={row.estilo || ""} onChange={(e) => setEstiloRow(i, e.target.value)} placeholder="FN2808"
                            className={`w-full rounded-lg border px-2 py-1.5 font-mono text-sm uppercase tracking-widest
                                       focus:outline-none focus:ring-2 focus:ring-slate-900
                                       ${estiloBad ? "border-rose-300 bg-rose-50" : "border-slate-300"}`} />
                        </RowField>
                        <RowField label="PO cliente" hint="PO del cliente para esta línea">
                          <input value={row.customerPo || ""} onChange={(e) => setRowField(i, "customerPo", e.target.value)}
                            placeholder="PO cliente"
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm
                                       focus:outline-none focus:ring-2 focus:ring-slate-900" />
                        </RowField>
                        <RowField label="Entrega">
                          <input type="date" value={row.deliveryDate || ""} onChange={(e) => setRowField(i, "deliveryDate", e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm
                                       focus:outline-none focus:ring-2 focus:ring-slate-900" />
                        </RowField>
                        {useItemCodes && (
                          <RowField label="Item code" hint="Item code / destino del cliente para estas cantidades">
                            <input value={row.itemCode || ""} onChange={(e) => setItemCode(i, e.target.value)}
                              placeholder="Item code"
                              className={`w-full rounded-lg border px-2 py-1.5 font-mono text-sm uppercase
                                         focus:outline-none focus:ring-2 focus:ring-slate-900
                                         ${row.color.trim() && !(row.itemCode || "").trim()
                                           ? "border-rose-300 bg-rose-50"
                                           : repeatedItemCodes.includes((row.itemCode || "").trim()) ? "border-amber-400 bg-amber-50" : "border-slate-300"}`} />
                          </RowField>
                        )}
                      </div>

                      {/* Telas: one or more per line, each with its own code and rendimiento.
                          En un CONJUNTO cada prenda lleva sus propias telas: la
                          chamarra y el pantalón casi nunca son la misma. */}
                      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2">
                        {isSet && (
                          <p className="px-0.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-indigo-600">
                            Telas · {compName(components[0], 0)}
                          </p>
                        )}
                        <div className="grid grid-cols-[minmax(0,1fr)_8rem_6rem_2rem] gap-2 px-0.5 pb-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Tela</span>
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Código</span>
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Rend.</span>
                          <span />
                        </div>
                        <div className="space-y-1.5">
                          {row.fabrics.map((f, j) => {
                            const typed = (f.name || "").trim();
                            const isNew = typed && !fabricNames.some((n) => n.toLowerCase() === typed.toLowerCase());
                            return (
                              <div key={j} className="space-y-1">
                                <div className="grid grid-cols-[minmax(0,1fr)_8rem_6rem_2rem] gap-2 items-center">
                                  <input value={f.name} onChange={(e) => setFabricField(i, j, "name", e.target.value)}
                                    list="fabric-names" placeholder="Nombre de la tela"
                                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm
                                               focus:outline-none focus:ring-2 focus:ring-slate-900" />
                                  <input value={f.code} onChange={(e) => setFabricField(i, j, "code", e.target.value.toUpperCase())}
                                    placeholder="Código"
                                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm uppercase
                                               focus:outline-none focus:ring-2 focus:ring-slate-900" />
                                  <input value={f.yield || ""} onChange={(e) => setFabricField(i, j, "yield", e.target.value.replace(/[^0-9.]/g, ""))}
                                    inputMode="decimal" placeholder="0.00" title="Rendimiento de esta tela"
                                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm text-right
                                               focus:outline-none focus:ring-2 focus:ring-slate-900" />
                                  <button type="button" onClick={() => removeFabric(i, j)} disabled={row.fabrics.length === 1}
                                    title="Quitar tela"
                                    className="h-8 w-8 flex items-center justify-center rounded hover:bg-rose-100 text-rose-500 disabled:opacity-30">
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                                {isNew && (
                                  <button type="button" disabled={savingFabric === typed}
                                    onClick={() => saveFabricToCatalog(typed, f.code)}
                                    className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 hover:underline disabled:opacity-50">
                                    <Plus size={11} />
                                    {savingFabric === typed ? "Guardando…" : `Guardar "${typed}" en el catálogo`}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <button type="button" onClick={() => addFabric(i)}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900">
                          <Plus size={12} /> Agregar tela
                        </button>
                      </div>

                      {/* Telas de las demás prendas del conjunto. Mismo color,
                          mismo estilo cliente, misma entrega — otra tela. */}
                      {components.slice(1).map((comp, k) => {
                        const ci = k + 1;
                        const list = fabricsOf(row, ci);
                        return (
                          <div key={comp.id} className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-2">
                            <p className="px-0.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-indigo-600">
                              Telas · {compName(comp, ci)}
                            </p>
                            <div className="grid grid-cols-[minmax(0,1fr)_8rem_6rem_2rem] gap-2 px-0.5 pb-1">
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Tela</span>
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Código</span>
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Rend.</span>
                              <span />
                            </div>
                            <div className="space-y-1.5">
                              {list.map((f, j) => (
                                <div key={j} className="grid grid-cols-[minmax(0,1fr)_8rem_6rem_2rem] gap-2 items-center">
                                  <input value={f.name || ""} onChange={(e) => setFabricFieldFor(i, ci, j, "name", e.target.value)}
                                    list="fabric-names" placeholder="Nombre de la tela"
                                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm
                                               focus:outline-none focus:ring-2 focus:ring-slate-900" />
                                  <input value={f.code || ""} onChange={(e) => setFabricFieldFor(i, ci, j, "code", e.target.value.toUpperCase())}
                                    placeholder="Código"
                                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm uppercase
                                               focus:outline-none focus:ring-2 focus:ring-slate-900" />
                                  <input value={f.yield || ""} onChange={(e) => setFabricFieldFor(i, ci, j, "yield", e.target.value.replace(/[^0-9.]/g, ""))}
                                    inputMode="decimal" placeholder="0.00" title="Rendimiento de esta tela"
                                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm text-right
                                               focus:outline-none focus:ring-2 focus:ring-slate-900" />
                                  <button type="button" onClick={() => removeFabricFor(i, ci, j)} disabled={list.length === 1}
                                    title="Quitar tela"
                                    className="h-8 w-8 flex items-center justify-center rounded hover:bg-rose-100 text-rose-500 disabled:opacity-30">
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              ))}
                            </div>
                            <button type="button" onClick={() => addFabricFor(i, ci)}
                              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900">
                              <Plus size={12} /> Agregar tela
                            </button>
                          </div>
                        );
                      })}

                      {/* Cantidad por talla = packing + SKU (ambas en piezas).
                          En un conjunto se captura UNA vez: es la cantidad del
                          CONJUNTO, y cada prenda la multiplica por su ratio. */}
                      <div className="mt-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            Cantidad por talla
                          </span>
                          <span className="text-[10px] text-slate-400 normal-case">· packing + SKU = cantidad de la talla</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {sizes.map((s) => {
                            const packingV = row.packing?.[s] || "";
                            const skuV = row.sku?.[s] || "";
                            const total = sizeQtyOf(row, s);
                            return (
                              <div key={s} className="w-20 rounded-lg border border-slate-200 bg-white p-1.5">
                                <span className="block text-center text-[10px] text-slate-400 leading-tight">
                                  <span className="block font-mono text-[11px] font-bold text-slate-700">{s}</span>
                                  {sizeLabel(s)}
                                </span>
                                <label className="block mt-1">
                                  <span className="block text-[9px] font-semibold uppercase tracking-wide text-slate-400">Packing</span>
                                  <input value={packingV} onChange={(e) => setPacking(i, s, e.target.value)}
                                    inputMode="numeric" placeholder="0" title="Piezas en packing (surtido)"
                                    className="mt-0.5 w-full rounded-md border border-slate-300 px-1.5 py-1 font-mono text-sm text-center
                                               focus:outline-none focus:ring-2 focus:ring-slate-900" />
                                </label>
                                <label className="block mt-1">
                                  <span className="block text-[9px] font-semibold uppercase tracking-wide text-slate-400">SKU</span>
                                  <input value={skuV} onChange={(e) => setSku(i, s, e.target.value)}
                                    inputMode="numeric" placeholder="0" title="Piezas en SKU (talla sólida)"
                                    className="mt-0.5 w-full rounded-md border border-slate-300 px-1.5 py-1 font-mono text-sm text-center
                                               focus:outline-none focus:ring-2 focus:ring-slate-900" />
                                </label>
                                <div className="mt-1 border-t border-dashed border-slate-200 pt-1">
                                  <span className="block text-[9px] font-semibold uppercase tracking-wide text-slate-400">Cant.</span>
                                  <span className={`block text-center font-mono text-sm ${total > 0 ? "text-slate-900 font-bold" : "text-slate-300"}`}>
                                    {total.toLocaleString()}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}

                <datalist id="fabric-names">
                  {fabricNames.map((n) => <option key={n} value={n} />)}
                </datalist>
                <button type="button" onClick={addColor}
                  className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-slate-900">
                  <Plus size={14} /> Agregar línea
                </button>
                <p className="text-xs text-slate-500 mt-3">
                  {cells.length} combinación(es) · {orderedQty.toLocaleString()} piezas · {poPlan.length} orden(es) de producción · {new Set(cells.map((c) => `${c.talla}|${c.color}|${c.estilo}`)).size} código(s) maestro(s)
                </p>
                {repeatedItemCodes.length > 0 && (
                  <p className="text-xs text-amber-700 mt-1 flex items-start gap-1">
                    <AlertCircle size={12} className="mt-0.5 shrink-0" />
                    Item code repetido en la misma orden ({repeatedItemCodes.join(", ")}): sus cantidades se van a sumar.
                  </p>
                )}
                {poPlan.length > 1 && (
                  <p className="text-xs text-slate-500 mt-1 flex items-start gap-1">
                    <AlertCircle size={12} className="mt-0.5 shrink-0" />
                    Se crearán {poPlan.length} órdenes (números automáticos): una orden por cada combinación de color + estilo + PO cliente + fecha de entrega{useItemCodes ? " + item code" : ""}.
                  </p>
                )}
              </div>
              </>
            )}
          </SectionCard>
        )}

        {/* Step 3 — Customer */}
        {step === 3 && (
          <SectionCard icon={Users} title="3 · Cliente" subtitle="Cliente de la orden (el estilo cliente se define por color en el paso 2)">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">Cliente</label>
                <select value={customerId} onChange={(e) => onCustomer(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900">
                  <option value="">Selecciona un cliente…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">Código cliente</label>
                <input value={clienteCode} onChange={(e) => setClienteCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3))}
                  placeholder="INV"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-slate-900" />
                <p className="text-[11px] text-slate-400 mt-1">3 letras · del cliente</p>
              </div>
            </div>
          </SectionCard>
        )}

        {/* Step 4 — Details + logistics */}
        {step === 4 && (
          <div className="space-y-6">
            {/* Descripción, SAM, foto, stock y extras son POR PRENDA: el SAM de
                una chamarra no es el de un pantalón, y el stock de una no puede
                descontar piezas de la otra. */}
            {components.map((c, ci) => (
              <SectionCard
                key={c.id}
                icon={FileText}
                title={isSet ? `4 · Detalles · ${compName(c, ci)}` : "4 · Detalles del estilo"}
                subtitle="Descripción y SAM (requeridos para el código maestro)"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">Descripción</label>
                    <textarea value={c.description} onChange={(e) => setComp(ci, { description: e.target.value })} rows={3}
                      placeholder="Pantalón dama invierno, tela franela, color negro…"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-slate-900" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">SAM (minutos)</label>
                    <input type="number" min="0" step="0.01" value={c.sam} onChange={(e) => setComp(ci, { sam: e.target.value })} placeholder="12.50"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">Foto (opcional)</label>
                    <input ref={ci === 0 ? fileRef : null} type="file" accept="image/*"
                      onChange={(e) => handlePhoto(e, ci)} className="hidden" id={`wiz-photo-${c.id}`} />
                    <label htmlFor={`wiz-photo-${c.id}`}
                      className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-3 py-3 cursor-pointer text-slate-500 hover:border-slate-500">
                      {c.photo ? <img src={c.photo.url} alt="" className="h-16 object-contain rounded" /> : (<><Camera size={16} /><span className="text-sm">Subir foto</span></>)}
                    </label>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 uppercase">Stock almacén</label>
                    <input value={c.warehouseStock} onChange={(e) => setComp(ci, { warehouseStock: e.target.value.replace(/[^0-9.]/g, "") })}
                      inputMode="decimal" placeholder="0"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 uppercase">Extras</label>
                    <input value={c.extraQuantity} onChange={(e) => setComp(ci, { extraQuantity: e.target.value.replace(/[^0-9.]/g, "") })}
                      inputMode="decimal" placeholder="0"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                  </div>
                </div>
              </SectionCard>
            ))}

            <SectionCard icon={CalendarClock} title="Logística" subtitle="Temporada (entrega y tela se capturan por línea en el paso 2; stock y extras, por prenda)">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">Temporada</label>
                  <div className="flex gap-2">
                    <select value={seasonCode} onChange={(e) => setSeasonCode(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900">
                      <option value="">Temporada…</option>
                      {SEASONS.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.label}</option>)}
                    </select>
                    <input value={seasonYear}
                      onChange={(e) => setSeasonYear(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                      inputMode="numeric" placeholder="26"
                      className="w-16 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-center focus:outline-none focus:ring-2 focus:ring-slate-900" />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">{season ? `= ${season}` : "código + año (ej. SU26)"}</p>
                </div>
                {/* Stock y extras ahora viven en la tarjeta de cada prenda. */}
              </div>
            </SectionCard>
          </div>
        )}

        {/* Step 5 — Review */}
        {step === 5 && (
          <SectionCard icon={ClipboardList} title="5 · Revisar y crear"
            subtitle={isSet
              ? `Conjunto de ${components.length} prendas — se crearán ${totalPos} órdenes de producción, una por prenda × color × estilo × PO cliente × entrega`
              : `Se creará${totalPos === 1 ? "" : "n"} ${totalPos} orden(es) de producción — una por color + estilo + PO cliente + fecha de entrega${useItemCodes ? " + item code" : ""}`}>

            {/* CONJUNTO: lo que el cliente compra (una unidad) vs. lo que la
                planta produce (una PO por prenda). Verlo junto aquí evita la
                sorpresa de "pedí 500 y salieron 1,000 piezas". */}
            {isSet && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 mb-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-indigo-500">Conjunto</span>
                  <span className="text-[11px] text-indigo-500">N° automático (SET####)</span>
                </div>
                <p className="mt-1 font-mono text-lg font-bold text-indigo-900">
                  {components.map((c, i) => compName(c, i)).join(" + ")}
                </p>
                <p className="mt-1 text-xs text-indigo-800">
                  <b>{setsQty.toLocaleString()} conjuntos</b> ·{" "}
                  {components.map((c, i) => (
                    <span key={c.id}>
                      {i > 0 && " + "}
                      {compName(c, i)} {(setsQty * ratioNum(c.ratio)).toLocaleString()} pzs
                    </span>
                  ))}
                  {" = "}
                  <b>{piecesTotal.toLocaleString()} piezas</b> a producir
                </p>
              </div>
            )}

            <div className="rounded-lg bg-slate-900 text-white px-4 py-3 mb-4">
              <span className="text-[11px] uppercase tracking-widest text-slate-400">
                {totalPos === 1 ? "N° de orden" : `${totalPos} órdenes de producción`}
              </span>
              <div className="mt-1 space-y-3">
                {totalPos === 0 ? (
                  <p className="font-mono text-lg font-bold">—</p>
                ) : (
                  components.map((c, ci) => (
                    <div key={c.id}>
                      {isSet && (
                        <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-300 mb-1">
                          {compName(c, ci)} · {c.tipo}{c.modelo}{c.correlativo} · SAM {c.sam || "—"}
                        </p>
                      )}
                      <div className="space-y-1.5">
                        {(plans[ci] || []).map((p, i) => (
                          <div key={i} className="flex items-center justify-between gap-3">
                            <p className="font-mono text-sm font-bold">
                              PO {i + 1} <span className="text-slate-400 font-normal">· N° automático</span>
                            </p>
                            <span className="text-xs text-slate-300">
                              <b className="font-mono text-white">{p.colors}</b> · {p.estilos} · {p.pieces.toLocaleString()} pzs
                              {" · "}
                              <span className="text-slate-400">
                                entrega {p.date || "—"}
                                {" · PO "}{p.customerPos || "—"}
                                {p.itemCodes && <>{" · item "}{p.itemCodes}</>}
                                {" · tela "}{p.fabrics || "—"}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <Info label={isSet ? "Estilos" : "Estilo"}
                value={components.map((c) => `${c.tipo}${c.modelo}${c.correlativo}`).filter((v) => v.length === 8).join(" · ") || "—"} />
              <Info label="Cliente" value={customers.find((c) => String(c.id) === String(customerId))?.name || "—"} />
              <Info label="Estilos cliente" value={[...new Set(cells.map((c) => c.estilo))].join(", ") || "—"} />
              <Info label="Tallas" value={sizes.join(", ") || "—"} />
              <Info label="Colores" value={[...new Set(cells.map((c) => c.color))].join(", ") || "—"} />
              <Info label="Códigos maestros" value={String(new Set(cells.map((c) => `${c.talla}|${c.color}|${c.estilo}`)).size)} />
              <Info label={isSet ? "Conjuntos pedidos" : "Cantidad pedida"} value={setsQty.toLocaleString()} />
              <Info label="SAM"
                value={components.map((c, i) => (isSet ? `${compName(c, i)} ${c.sam || "—"}` : `${c.sam || "—"} min`)).join(" · ")} />
              <Info label="Temporada" value={season || "—"} />
              <Info label="Total a producir" value={totalToProduce.toLocaleString()} />
            </div>

            {/* Color → estilo mapping (each color = its own estilo cliente) */}
            {colorList.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Estilo por color</p>
                <div className="flex flex-wrap gap-2">
                  {activeColorRows.map((r, i) => (
                    <span key={`${r.color}|${r.estilo}|${i}`} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                      <span className="font-mono text-sm font-bold text-slate-800">{r.color}</span>
                      <span className="text-slate-300">→</span>
                      <span className={`font-mono text-sm font-bold ${(r.estilo || "").length === 6 ? "text-slate-800" : "text-rose-500"}`}>
                        {r.estilo || "—"}
                      </span>
                      {useItemCodes && (r.itemCode || "").trim() && (
                        <span className="font-mono text-xs text-indigo-600">· item {r.itemCode.trim()}</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {preOrder?.notes && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                  Notas de {preOrder.pre_order_no}
                </p>
                <p className="text-xs text-slate-600 whitespace-pre-wrap">{preOrder.notes}</p>
              </div>
            )}

            {/* Conversión incremental: crear solo las POs cuya tela llegó y dejar
                el resto de la pre-orden pendiente en el tablero. */}
            {preOrder && (
              <label className="mt-4 flex items-start gap-3 rounded-lg border border-violet-200 bg-violet-50 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-violet-600"
                  checked={keepRemaining}
                  onChange={(e) => setKeepRemaining(e.target.checked)}
                />
                <span className="text-xs text-violet-800 leading-relaxed">
                  <b>Quedan POs de cliente por llegar.</b>{" "}
                  Crea solo esta(s) PO ({orderedQty.toLocaleString()} pzs) y deja{" "}
                  <b>{preOrder.pre_order_no}</b> como <b>parcial</b> en el tablero, con{" "}
                  {Math.max(preOrderPieces - orderedQty, 0).toLocaleString()} pzs restantes.
                  Ábrela de nuevo cuando llegue la siguiente tela.
                  {preOrder.status === "partially_converted" && preOrder.work_order_nos && (
                    <span className="block mt-1 text-violet-600">
                      Ya convertidas: <span className="font-mono">{preOrder.work_order_nos}</span>
                    </span>
                  )}
                </span>
              </label>
            )}

            {missing.length > 0 && (
              <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 p-3">
                <p className="text-xs font-semibold text-rose-700 flex items-center gap-1 mb-1">
                  <AlertCircle size={14} /> Falta completar:
                </p>
                <ul className="text-xs text-rose-600 list-disc pl-5 space-y-0.5">
                  {missing.map((m) => <li key={m}>{m}</li>)}
                </ul>
              </div>
            )}
          </SectionCard>
        )}

        {/* Footer nav */}
        <div className="flex items-center justify-between">
          <button type="button" onClick={back} disabled={step === 1}
            className="inline-flex items-center gap-1 rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed">
            <ChevronLeft size={16} /> Atrás
          </button>

          {step < 5 ? (
            <button type="button" onClick={next} disabled={!stepValid(step)}
              className={`inline-flex items-center gap-1 rounded-lg px-5 py-2 text-sm font-semibold transition-all
                ${stepValid(step) ? "bg-slate-900 text-white hover:bg-slate-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>
              Siguiente <ChevronRight size={16} />
            </button>
          ) : (
            <button type="button" onClick={handleCreate} disabled={!canCreate}
              className={`inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold transition-all
                ${canCreate ? "bg-slate-900 text-white hover:bg-slate-700 shadow-lg" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>
              {saving ? (<><RefreshCw size={16} className="animate-spin" /> Creando…</>) : (<><Plus size={16} /> {poPlan.length > 1 ? `Crear ${poPlan.length} órdenes` : "Crear código maestro y PO"}</>)}
            </button>
          )}
        </div>
      </main>

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 text-sm px-4 py-2 rounded-full shadow-lg flex items-center gap-2
          ${toast.isError ? "bg-rose-600 text-white" : "bg-slate-900 text-white"}`}>
          {toast.isError ? <AlertCircle size={14} /> : <Check size={14} className="text-emerald-400" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="font-mono text-sm font-bold text-slate-800 break-words">{value}</p>
    </div>
  );
}