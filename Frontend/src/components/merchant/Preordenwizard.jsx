import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Layers, Users, Scissors, Check, X, AlertCircle, RefreshCw,
  ChevronLeft, ChevronRight, Plus, ClipboardList,
} from "lucide-react";
import { API_URL, TIPOS, MODELOS } from "../../lib/masterCodeCatalog";
import MerchantNavbar from "../../components/merchant/MerchantNavbar";

/* -----------------------------------------------------------------------
 *  PRE-ORDEN: el pedido en lo mínimo indispensable — estilo, cliente y
 *  piezas, más el SAM si ya se conoce (opcional; alimenta la carga
 *  equivalente de la ficha en el tablero). Tallas, colores, telas y entregas
 *  llegan después, cuando la pre-orden se completa en NuevaOrdenWizard y se
 *  convierte en PO(s).
 *  Número: PRE#### (lo asigna el backend).
 * --------------------------------------------------------------------- */

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const STEPS = [
  { n: 1, label: "Estilo", icon: Layers },
  { n: 2, label: "Cliente", icon: Users },
  { n: 3, label: "Piezas", icon: Scissors },
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

function Info({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="font-mono text-sm font-bold text-slate-800 break-words">{value}</p>
    </div>
  );
}

export default function PreOrdenWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // catálogos
  const [customers, setCustomers] = useState([]);
  const [preSeq, setPreSeq] = useState("");

  // paso 1 — estilo
  const [tipo, setTipo] = useState("");
  const [modelo, setModelo] = useState("");
  const [correlativo, setCorrelativo] = useState("");
  const [autoFilling, setAutoFilling] = useState(false);
  const [estilo, setEstilo] = useState("");            // estilo cliente (opcional)
  const [description, setDescription] = useState("");  // opcional

  // paso 2 — cliente
  const [customerId, setCustomerId] = useState("");
  const [clienteCode, setClienteCode] = useState("");
  const [customerPo, setCustomerPo] = useState("");

  // paso 3 — piezas
  const [pieces, setPieces] = useState("");
  const [sam, setSam] = useState("");            // SAM en minutos (opcional)
  const [targetDate, setTargetDate] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  };

  // catálogo de clientes + siguiente número PRE####
  useEffect(() => {
    (async () => {
      try {
        const [custRes, seqRes] = await Promise.all([
          fetch(`${API_URL}/api/customers`, { headers: authHeaders() }),
          fetch(`${API_URL}/api/pre-orders/next-number`, { headers: authHeaders() }),
        ]);
        if (custRes.ok) setCustomers((await custRes.json()).customers || []);
        if (seqRes.ok) setPreSeq((await seqRes.json()).sequence || "");
      } catch {
        showToast("No se pudieron cargar los catálogos", true);
      }
    })();
  }, []);

  // El correlativo se sugiere solo, igual que en la orden completa: así la
  // pre-orden ya nace con el mismo estilo que después llevará la PO.
  useEffect(() => {
    (async () => {
      if (tipo && modelo && !correlativo) {
        setAutoFilling(true);
        try {
          const res = await fetch(
            `${API_URL}/api/master-codes/next-correlativo?type=${tipo}&modelo=${modelo}`,
            { headers: authHeaders() }
          );
          if (res.ok) {
            const data = await res.json();
            if (data.success) setCorrelativo(data.nextCorrelativo);
          }
        } catch { /* se captura a mano */ }
        finally { setAutoFilling(false); }
      }
    })();
  }, [tipo, modelo]); // eslint-disable-line react-hooks/exhaustive-deps

  const styleBase = `${tipo}${modelo}${correlativo}`;
  const piecesNum = parseInt(pieces, 10) || 0;
  const samNum = parseFloat(sam) || 0;   // opcional; 0 = todavía sin dato

  const onCustomer = (id) => {
    setCustomerId(id);
    const c = customers.find((x) => String(x.id) === String(id));
    if (c?.code) setClienteCode(c.code.toUpperCase());
  };

  const stepValid = (s) => {
    if (s === 1) return tipo && modelo && correlativo.length === 2;
    if (s === 2) return customerId && clienteCode.length === 3;
    if (s === 3) return piecesNum > 0;
    return true;
  };
  const canCreate = [1, 2, 3].every(stepValid) && !saving;

  const missing = [
    !tipo && "Tipo (paso 1)",
    !modelo && "Modelo (paso 1)",
    correlativo.length !== 2 && "Correlativo de 2 dígitos (paso 1)",
    !customerId && "Cliente (paso 2)",
    clienteCode.length !== 3 && "Código de cliente de 3 letras (paso 2)",
    !(piecesNum > 0) && "Piezas mayor a 0 (paso 3)",
  ].filter(Boolean);

  const next = () => { if (stepValid(step)) setStep((s) => Math.min(3, s + 1)); };
  const back = () => setStep((s) => Math.max(1, s - 1));

  const handleCreate = async () => {
    if (!canCreate) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/pre-orders`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          tipo, modelo, correlativo,
          estilo: estilo || null,
          styleDescription: description.trim() || null,
          customerId: Number(customerId),
          clienteCode,
          customerPo: customerPo.trim() || null,
          pieces: piecesNum,
          samMinutes: samNum,
          targetDate: targetDate || null,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo crear la pre-orden");

      showToast(`Pre-orden ${data.preOrder.pre_order_no} creada`);
      // El siguiente paso natural es verla en el listado, donde vive el botón
      // "Completar a PO".
      setTimeout(() => navigate("/pre-ordenes"), 900);
    } catch (err) {
      showToast(err.message, true);
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <MerchantNavbar title="Nueva pre-orden" showRefresh={false} />

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Qué es esto, en una línea */}
        <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <ClipboardList size={16} className="mt-0.5 shrink-0 text-slate-500" />
          <p className="text-xs text-slate-600">
            Captura el pedido con lo que ya sabes: <b>estilo, cliente y piezas</b> (y el
            <b> SAM</b> si ya lo tienes, para ver la carga comprometida en el tablero). Tallas,
            colores, telas y entregas se agregan después, al completarla y convertirla
            en orden de producción.
            {preSeq && <> El número será <span className="font-mono font-bold text-slate-800">{preSeq}</span>.</>}
          </p>
        </div>

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

        {/* Paso 1 — Estilo */}
        {step === 1 && (
          <SectionCard icon={Layers} title="1 · Estilo" subtitle="Tipo y modelo — el correlativo se genera solo">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Tipo</p>
            <ChipGrid options={TIPOS} value={tipo} onChange={(v) => { setTipo(v); setCorrelativo(""); }} />
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mt-5 mb-2">Modelo</p>
            <ChipGrid options={MODELOS} value={modelo} onChange={(v) => { setModelo(v); setCorrelativo(""); }} />

            <div className="mt-5 flex items-end gap-4 flex-wrap">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">Correlativo</label>
                <input
                  value={correlativo}
                  onChange={(e) => setCorrelativo(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                  placeholder="01"
                  className="w-24 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tracking-widest text-center
                             focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                <p className="text-[11px] text-slate-400 mt-1">{autoFilling ? "Cargando…" : "2 dígitos · auto"}</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  Estilo cliente <span className="text-slate-400 normal-case font-normal">· opcional</span>
                </label>
                <input
                  value={estilo}
                  onChange={(e) => setEstilo(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
                  placeholder="A1B2C3"
                  className="w-32 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tracking-widest
                             focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                <p className="text-[11px] text-slate-400 mt-1">6 caracteres · se confirma en la PO</p>
              </div>
              {styleBase.length === 8 && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                  <span className="text-[11px] text-slate-500 uppercase tracking-wide">Estilo</span>
                  <p className="font-mono text-sm font-bold text-slate-800">{styleBase}</p>
                </div>
              )}
            </div>

            <div className="mt-5">
              <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                Descripción <span className="text-slate-400 normal-case font-normal">· opcional</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Pantalón dama invierno, tela franela…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </SectionCard>
        )}

        {/* Paso 2 — Cliente */}
        {step === 2 && (
          <SectionCard icon={Users} title="2 · Cliente" subtitle="Para quién es el pedido">
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
                <input value={clienteCode}
                  onChange={(e) => setClienteCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3))}
                  placeholder="INV"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-slate-900" />
                <p className="text-[11px] text-slate-400 mt-1">3 letras · del cliente</p>
              </div>
              <div className="sm:col-span-3">
                <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  PO cliente <span className="text-slate-400 normal-case font-normal">· opcional</span>
                </label>
                <input value={customerPo} onChange={(e) => setCustomerPo(e.target.value.slice(0, 60))}
                  placeholder="PO-88421"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                <p className="text-[11px] text-slate-400 mt-1">Si el cliente ya mandó su número de compra</p>
              </div>
            </div>
          </SectionCard>
        )}

        {/* Paso 3 — Piezas + revisión */}
        {step === 3 && (
          <div className="space-y-6">
            <SectionCard icon={Scissors} title="3 · Piezas" subtitle="Cuántas piezas comprometió el cliente en total">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">Piezas totales</label>
                  <input value={pieces}
                    onChange={(e) => setPieces(e.target.value.replace(/[^0-9]/g, "").slice(0, 9))}
                    inputMode="numeric" placeholder="1200"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-lg font-bold focus:outline-none focus:ring-2 focus:ring-slate-900" />
                  <p className="text-[11px] text-slate-400 mt-1">Se reparte por talla y color al convertirla</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                    SAM (minutos) <span className="text-slate-400 normal-case font-normal">· opcional</span>
                  </label>
                  <input value={sam}
                    onChange={(e) => setSam(e.target.value.replace(/[^0-9.]/g, "").slice(0, 8))}
                    inputMode="decimal" placeholder="12.50"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-lg font-bold focus:outline-none focus:ring-2 focus:ring-slate-900" />
                  <p className="text-[11px] text-slate-400 mt-1">Da la carga comprometida en el tablero · se confirma en la PO</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                    Fecha objetivo <span className="text-slate-400 normal-case font-normal">· opcional</span>
                  </label>
                  <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                    Notas <span className="text-slate-400 normal-case font-normal">· opcional</span>
                  </label>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                    placeholder="Cliente confirma colores la próxima semana…"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-slate-900" />
                </div>
              </div>
            </SectionCard>

            <SectionCard icon={ClipboardList} title="Revisar y crear" subtitle="Así queda la pre-orden">
              <div className="rounded-lg bg-slate-900 text-white px-4 py-3 mb-4 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <span className="text-[11px] uppercase tracking-widest text-slate-400">N° de pre-orden</span>
                  <p className="font-mono text-lg font-bold">{preSeq || "PRE—"}</p>
                </div>
                <div className="text-right">
                  <span className="text-[11px] uppercase tracking-widest text-slate-400">Piezas</span>
                  <p className="font-mono text-lg font-bold">{piecesNum.toLocaleString()}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <Info label="Estilo" value={styleBase || "—"} />
                <Info label="Estilo cliente" value={estilo || "—"} />
                <Info label="Cliente" value={customers.find((c) => String(c.id) === String(customerId))?.name || "—"} />
                <Info label="Código cliente" value={clienteCode || "—"} />
                <Info label="PO cliente" value={customerPo || "—"} />
                <Info label="SAM" value={samNum > 0 ? `${samNum} min` : "—"} />
                <Info label="Fecha objetivo" value={targetDate || "—"} />
              </div>

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
          </div>
        )}

        {/* Navegación */}
        <div className="flex items-center justify-between">
          <button type="button" onClick={back} disabled={step === 1}
            className="inline-flex items-center gap-1 rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed">
            <ChevronLeft size={16} /> Atrás
          </button>

          {step < 3 ? (
            <button type="button" onClick={next} disabled={!stepValid(step)}
              className={`inline-flex items-center gap-1 rounded-lg px-5 py-2 text-sm font-semibold transition-all
                ${stepValid(step) ? "bg-slate-900 text-white hover:bg-slate-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>
              Siguiente <ChevronRight size={16} />
            </button>
          ) : (
            <button type="button" onClick={handleCreate} disabled={!canCreate}
              className={`inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold transition-all
                ${canCreate ? "bg-slate-900 text-white hover:bg-slate-700 shadow-lg" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>
              {saving ? (<><RefreshCw size={16} className="animate-spin" /> Creando…</>) : (<><Plus size={16} /> Crear pre-orden</>)}
            </button>
          )}
        </div>
      </main>

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 text-sm px-4 py-2 rounded-full shadow-lg flex items-center gap-2
          ${toast.isError ? "bg-rose-600 text-white" : "bg-slate-900 text-white"}`}>
          {toast.isError ? <X size={14} /> : <Check size={14} className="text-emerald-400" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}