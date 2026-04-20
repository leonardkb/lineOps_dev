// [file name]: LineDetailsCard.jsx
export default function LineDetailsCard({ lineRun }) {
  const metrics = [
    {
      label: "Línea",
      value: lineRun.line_no,
      icon: "🔧",
    },
    {
      label: "Fecha",
      value: new Date(lineRun.run_date).toLocaleDateString(),
      icon: "📅",
    },
    {
      label: "Estilo",
      value: lineRun.style,
      icon: "👕",
    },
    {
      label: "Operadores",
      value: lineRun.operators_count,
      icon: "👥",
    },
    {
      label: "SAM",
      value: `${lineRun.sam_minutes} min/pieza`,
      icon: "⏱️",
    },
    {
      label: "Horas",
      value: `${lineRun.working_hours} hrs`,
      icon: "⏰",
    },
    {
      label: "Eficiencia",
      value: `${Math.round(lineRun.efficiency * 100)}%`,
      icon: "📊",
    },
    {
      label: "Meta Diaria",
      value: `${Math.round(lineRun.target_pcs)} piezas`,
      icon: "🎯",
    },
  ];

  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <div className="px-5 py-4 border-b">
        <h2 className="font-semibold text-gray-900">Detalles de la Línea Seleccionada</h2>
        <p className="text-sm text-gray-600">
          Capacidad y métricas actuales
        </p>
      </div>

      <div className="p-5">
        <div className="grid grid-cols-2 gap-4">
          {metrics.map((metric, index) => (
            <div
              key={index}
              className="bg-gray-50 rounded-xl p-3 border border-gray-100"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{metric.icon}</span>
                <span className="text-xs text-gray-500">{metric.label}</span>
              </div>
              <div className="text-sm font-semibold text-gray-900 mt-1">
                {metric.value}
              </div>
            </div>
          ))}
        </div>

        {/* Capacity Visualization */}
        <div className="mt-4 pt-4 border-t">
          <div className="text-xs text-gray-500 mb-2">Capacidad por Hora</div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full"
              style={{
                width: `${Math.min(
                  (lineRun.target_per_hour / (lineRun.target_pcs / lineRun.working_hours)) * 100,
                  100
                )}%`,
              }}
            />
          </div>
          <div className="flex justify-between mt-1 text-xs">
            <span className="text-gray-600">0</span>
            <span className="font-medium text-gray-900">
              {Math.round(lineRun.target_per_hour)} pzas/h
            </span>
            <span className="text-gray-600">
              {Math.round(lineRun.target_pcs / lineRun.working_hours)} pzas/h (max)
            </span>
          </div>
        </div>

        {/* Production Rate */}
        <div className="mt-4 text-sm">
          <div className="flex justify-between py-1">
            <span className="text-gray-600">Piezas por operador/hora:</span>
            <span className="font-medium">
              {Math.round(lineRun.target_per_hour / lineRun.operators_count)} pzas
            </span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-gray-600">Minutos por pieza:</span>
            <span className="font-medium">
              {((lineRun.working_hours * 60) / lineRun.target_pcs).toFixed(2)} min
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}