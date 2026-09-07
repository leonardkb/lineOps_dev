// components/supermarket/SupermarketStates.jsx
//
// Estados de carga / error / vacío compartidos por las pestañas, para que las
// tres pantallas intermedias se vean como una sola cosa y no como tres
// improvisaciones distintas.

import { Loader2, RefreshCw } from "lucide-react";

export function LoadingState({ label = "Cargando..." }) {
  return (
    <div className="flex items-center justify-center h-72 gap-2 text-gray-500">
      <Loader2 className="w-5 h-5 animate-spin" />
      {label}
    </div>
  );
}

export function Notice({ icon: Icon, tone = "gray", title, children, onRetry }) {
  const tones = { gray: "text-gray-300", amber: "text-amber-500" };
  return (
    <div className="bg-white rounded-xl border shadow-sm py-16 px-4 text-center">
      <Icon className={`w-10 h-10 mx-auto ${tones[tone]}`} />
      <p className="text-gray-900 font-semibold mt-3">{title}</p>
      <p className="text-sm text-gray-600 mt-1 max-w-md mx-auto">{children}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-5 px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 inline-flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" /> Reintentar
        </button>
      )}
    </div>
  );
}