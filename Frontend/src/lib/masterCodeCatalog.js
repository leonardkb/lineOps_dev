// src/lib/masterCodeCatalog.js

// API_URL is intentionally an empty string, not removed. Turns out this
// export is depended on by several components (PlanningDashboard,
// WorkOrderList, StyleSelectorModal, MasterCodeSelectorModal,
// WorkOrderForm, LineAssignmentForm, PlanBoard, MerchantPage) that build
// request URLs like `${API_URL}/api/...`. Since nginx now reverse-proxies
// /api/* on the same origin as the frontend, an empty string makes every
// one of those turn into a plain relative "/api/..." path without having
// to touch each file individually. Do not hardcode a host here again
// (e.g. 'http://localhost:5000') — that breaks in production.
export const API_URL = 'http://localhost:5000';

export const TIPOS = [
  { code: "DAM", label: "Dama" },
  { code: "CAB", label: "Caballero" },
  { code: "NNA", label: "Niña" },
  { code: "NNO", label: "Niño" },
  { code: "ACC", label: "Accesorios" },
];

export const MODELOS = [
  { code: "PAN", label: "Pantalón" },
  { code: "CHA", label: "Chaqueta" },
  { code: "SHO", label: "Short" },
  { code: "BKR", label: "Biker" },
  { code: "LEG", label: "Legging" },
  { code: "TSH", label: "T-Shirt" },
  { code: "POL", label: "Polo" },
  { code: "BOD", label: "Body" },
  { code: "BLS", label: "Blusa" },
  { code: "PTS", label: "Pants Set" },
];

export const TALLAS = [
  { code: "130", label: "XXXS" },
  { code: "132", label: "XXS" },
  { code: "134", label: "XS" },
  { code: "136", label: "S" },
  { code: "138", label: "M" },
  { code: "140", label: "L" },
  { code: "142", label: "XL" },
  { code: "144", label: "XXL" },
  { code: "146", label: "XXXL" },
  { code: "148", label: "S-T" },
  { code: "150", label: "M-T" },
  { code: "152", label: "L-T" },
  { code: "154", label: "XL-T" },
  { code: "156", label: "2XL-T" },
  { code: "004", label: "I-XS" },
  { code: "006", label: "S" },
  { code: "008", label: "M" },
  { code: "010", label: "L" },
];

export const SEGMENTS = [
  { key: "type", len: 3, label: "Tipo", color: "text-sky-600" },
  { key: "modelo", len: 3, label: "Modelo", color: "text-violet-600" },
  { key: "correlativo", len: 2, label: "Corr.", color: "text-amber-600" },
  { key: "talla", len: 3, label: "Talla", color: "text-emerald-600" },
  { key: "cliente", len: 3, label: "Cliente", color: "text-rose-600" },
  { key: "color", len: 3, label: "Color", color: "text-fuchsia-600" },
  { key: "estilo", len: 6, label: "Estilo cliente", color: "text-slate-700" },
];

export const tipoLabel = (code) => {
  const found = TIPOS.find(t => t.code === code);
  return found ? found.label : code;
};

export const modeloLabel = (code) => {
  const found = MODELOS.find(m => m.code === code);
  return found ? found.label : code;
};

export const tallaLabel = (code) => {
  const found = TALLAS.find(t => t.code === code);
  return found ? found.label : code;
};

export const parseMasterCode = (code) => {
  // Expected format: TYPEMODELOCORRTALLACLIENT-COLOR-STYLE
  // Example: DAMPAN01130INV-NEG-FN2808
  if (!code) return {};
  
  const parts = code.split('-');
  if (parts.length !== 3) return {};
  
  const firstPart = parts[0]; // DAMPAN01130INV
  const color = parts[1];     // NEG
  const estilo = parts[2];    // FN2808
  
  // Parse first part
  if (firstPart.length < 14) return {};
  
  return {
    type: firstPart.substring(0, 3),
    modelo: firstPart.substring(3, 6),
    correlativo: firstPart.substring(6, 8),
    talla: firstPart.substring(8, 11),
    cliente: firstPart.substring(11, 14),
    color: color || '',
    estilo: estilo || '',
  };
};