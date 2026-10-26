// components/cutting/TicketCard.jsx
//
// TARJETA DEL TICKET — lo que se abre al escanear el QR con la cámara del
// celular. Montar en TICKET_CARD_PATH ("/corte/ticket", ver ticketCode.js),
// de preferencia FUERA del layout principal (sin menú lateral) para que se vea
// como una tarjeta sola en el teléfono.
//
// Lee el ticket de la URL (?t=…), así que se muestra al instante aunque no haya
// sesión: talla, panel n de N, piezas, WO, color y marcada vienen en el QR.
// Si hay sesión, completa con la orden de corte (cliente, PO, estilo, tela,
// si la marcada está verificada y si cambió después de imprimir).
//
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle, Layers, XCircle } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";
import { parseTicketCode } from "./ticketCode";

const num = (v) => Number(v) || 0;
const rnd = (v) => Math.round(num(v)).toLocaleString();
const norm = (s) => String(s ?? "").trim().toUpperCase();
const cutNo = (id) => `CORTE-${String(id).padStart(4, "0")}`;

const SIZE_LABELS = {
  "130": "XXXS", "132": "XXS", "134": "XS", "136": "S", "138": "M",
  "140": "L", "142": "XL", "144": "XXL",
  "146": "XXXL", "148": "S-T", "150": "M-T", "152": "L-T", "154": "XL-T", "156": "2XL-T",
  "004": "I-XS", "006": "S", "008": "M", "010": "L",
};
const tallaLabel = (t) => SIZE_LABELS[norm(t)] || "";

export default function TicketCard({ code: codeProp }) {
  const code = codeProp ?? new URLSearchParams(window.location.search).get("t") ?? "";
  const p = useMemo(() => parseTicketCode(code), [code]);
  const [co, setCo] = useState(null);
  const [lookup, setLookup] = useState("idle"); // idle | loading | done | notfound | nosession

  useEffect(() => {
    if (!p) return;
    const token = localStorage.getItem("token");
    if (!token) { setLookup("nosession"); return; }
    let alive = true;
    setLookup("loading");
    fetch(`${API_URL}/api/cut-orders`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.status === 401 || r.status === 403 ? { auth: false } : r.json()))
      .then((data) => {
        if (!alive) return;
        if (data.auth === false || !data.success) return setLookup("nosession");
        const found = (data.cutOrders || []).find((o) => Number(o.id) === p.cutId);
        setCo(found || null);
        setLookup(found ? "done" : "notfound");
      })
      .catch(() => alive && setLookup("nosession"));
    return () => { alive = false; };
  }, [p]);

  if (!p) {
    return (
      <Shell>
        <div className="px-5 py-6 text-center">
          <XCircle className="w-8 h-8 text-red-500 mx-auto" />
          <p className="mt-2 font-semibold text-gray-900">Este código no es un ticket de corte</p>
          <p className="mt-1 text-xs text-gray-500 break-all font-mono">{code || "Sin código"}</p>
        </div>
      </Shell>
    );
  }

  // Datos en vivo de la orden (si hay sesión); si no, lo que trae el QR.
  const markers = Array.isArray(co?.markers) ? co.markers : [];
  const mi = markers.findIndex((m, i) =>
    (p.markerId && m?.id === p.markerId) || (!p.markerId && norm(m?.name || `Marcada ${i + 1}`) === norm(p.marker)));
  const marker = mi >= 0 ? markers[mi] : null;
  const line = marker ? (marker.lines || []).find((l) => norm(l.talla) === norm(p.talla)) : null;

  const panelCount = (line && Math.round(num(line.panels))) || p.panelCount || 0;
  const pieces = (line && num(line.perPanel)) || p.pieces || 0;
  const estilo = co ? co.modelo_code || co.style_no || co.style_code || co.estilo || "" : "";
  const tela = [marker?.fabricCode, marker?.fabricName].filter(Boolean).join(" ")
    || (co ? [co.fabric_code, co.fabric].filter(Boolean).join(" ") : "");

  const warnings = [];
  if (lookup === "notfound") warnings.push(`${cutNo(p.cutId)} ya no existe.`);
  if (co && p.marker && !marker) warnings.push("La marcada ya no existe en la orden. Pida reimprimir.");
  if (co && marker && !line) warnings.push(`La talla ${p.talla} ya no está en esta marcada.`);
  if (line && p.panelCount && p.panelCount !== panelCount)
    warnings.push(`El ticket dice ${p.panelCount} paneles; la marcada ahora tiene ${panelCount}. Pida reimprimir.`);
  if (co?.status === "cancelled") warnings.push("La orden de corte está cancelada.");

  const status = warnings.length
    ? { icon: AlertTriangle, cls: "bg-amber-400 text-amber-950", label: "Revisar ticket" }
    : marker && !marker.done
    ? { icon: AlertTriangle, cls: "bg-amber-400 text-amber-950", label: "Marcada sin verificar" }
    : marker?.done
    ? { icon: CheckCircle, cls: "bg-green-600 text-white", label: "Marcada verificada" }
    : null;
  const StatusIcon = status?.icon;

  return (
    <Shell>
      {status && (
        <div className={`${status.cls} px-4 py-2 flex items-center gap-2 text-sm font-semibold`}>
          <StatusIcon className="w-4 h-4" /> {status.label}
        </div>
      )}

      <div className="px-4 pt-3 pb-4">
        {/* Orden */}
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="font-mono font-semibold text-gray-900">{cutNo(p.cutId)}</span>
          <span className="text-gray-500 truncate">{co?.work_order_no || p.workOrderNo}</span>
        </div>
        {co?.customer_name && (
          <div className="mt-0.5 text-sm font-semibold text-gray-900 truncate">
            {co.customer_name}{co.customer_po ? <span className="font-normal text-gray-500"> · PO {co.customer_po}</span> : null}
          </div>
        )}

        {/* Talla + panel */}
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-[11px] text-gray-500">Talla</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-3xl font-extrabold tabular-nums leading-none text-gray-900">{p.talla || "—"}</span>
              {tallaLabel(p.talla) && (
                <span className="text-lg font-bold border-2 border-gray-900 rounded-md px-1.5 leading-tight">{tallaLabel(p.talla)}</span>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-gray-500">Panel</div>
            <div className="mt-0.5 leading-none">
              <span className="text-4xl font-extrabold tabular-nums text-gray-900">{p.panelNo ?? "—"}</span>
              <span className="text-lg font-bold text-gray-400 tabular-nums"> de {panelCount || "?"}</span>
            </div>
          </div>
        </div>

        {/* Posición del panel dentro de la talla */}
        {panelCount > 0 && panelCount <= 60 && (
          <div className="mt-3 flex gap-0.5" role="img" aria-label={`Panel ${p.panelNo} de ${panelCount}`}>
            {Array.from({ length: panelCount }, (_, i) => (
              <span key={i} className={`flex-1 h-2 rounded-sm ${i + 1 === p.panelNo ? "bg-gray-900" : "bg-gray-200"}`} />
            ))}
          </div>
        )}

        {/* Cantidades */}
        <div className="mt-3 grid grid-cols-2 rounded-lg border border-gray-200 divide-x divide-gray-200">
          <div className="px-3 py-2">
            <div className="text-[11px] text-gray-500">Piezas en el panel</div>
            <div className="text-2xl font-extrabold tabular-nums text-gray-900">{pieces ? rnd(pieces) : "—"}</div>
          </div>
          <div className="px-3 py-2">
            <div className="text-[11px] text-gray-500">Piezas de la talla</div>
            <div className="text-2xl font-bold tabular-nums text-gray-800">{pieces && panelCount ? rnd(pieces * panelCount) : "—"}</div>
          </div>
        </div>

        {/* Detalle */}
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Item label="Color">{co?.color || p.color || "—"}</Item>
          <Item label="Marcada">
            <span className="inline-flex items-center gap-1"><Layers className="w-3.5 h-3.5 text-gray-400" />{marker?.name || p.marker || "—"}</span>
          </Item>
          {estilo && <Item label="Estilo">{estilo}</Item>}
          {tela && <Item label="Tela">{tela}</Item>}
        </dl>

        {warnings.length > 0 && (
          <ul className="mt-3 space-y-1">
            {warnings.map((w) => (
              <li key={w} className="text-xs rounded-md bg-amber-50 text-amber-900 px-2.5 py-1.5">{w}</li>
            ))}
          </ul>
        )}

        {lookup === "nosession" && (
          <p className="mt-3 text-[11px] text-gray-400">Inicie sesión en la app para ver cliente, PO y estado de la marcada.</p>
        )}
        {lookup === "loading" && <p className="mt-3 text-[11px] text-gray-400">Consultando la orden…</p>}
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-100 flex items-start sm:items-center justify-center p-4">
      <div className="w-full max-w-xs rounded-2xl bg-white shadow-sm border border-gray-200 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function Item({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900 truncate">{children}</dd>
    </div>
  );
}