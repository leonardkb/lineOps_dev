// [file name]: PlanningSummary.jsx
export default function PlanningSummary({
  workOrderData,
  selectedRun,
  calculatedDays,
  onSave,
  isSaving,
}) {
  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <div className="px-5 py-4 border-b">
        <h2 className="font-semibold text-gray-900">Resumen de Planificación</h2>
        <p className="text-sm text-gray-600">
          Revise los detalles antes de guardar
        </p>
      </div>

      <div className="p-5">
        {/* Work Order Summary */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Orden de Trabajo</h3>
          <div className="bg-gray-50 rounded-xl p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Número:</span>
              <span className="text-sm font-medium">{workOrderData.workOrderNo}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Cliente:</span>
              <span className="text-sm font-medium">{workOrderData.customerName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Cantidad:</span>
              <span className="text-sm font-medium">{workOrderData.quantity} piezas</span>
            </div>
            {workOrderData.color && (
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Color:</span>
                <span className="text-sm font-medium">{workOrderData.color}</span>
              </div>
            )}
            {workOrderData.fabricSupplier && (
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Proveedor:</span>
                <span className="text-sm font-medium">{workOrderData.fabricSupplier}</span>
              </div>
            )}
          </div>
        </div>

        {/* Line Assignment Summary */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Asignación a Línea</h3>
          <div className="bg-gray-50 rounded-xl p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Línea:</span>
              <span className="text-sm font-medium">{selectedRun.line_no}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Estilo:</span>
              <span className="text-sm font-medium">{selectedRun.style}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Fecha de corrida:</span>
              <span className="text-sm font-medium">
                {new Date(selectedRun.run_date).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        {/* Production Timeline */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Cronograma de Producción</h3>
          <div className="bg-blue-50 rounded-xl p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-blue-600 mb-1">Inicio</div>
                <div className="text-sm font-medium text-blue-900">
                  {calculatedDays.startDate}
                </div>
              </div>
              <div>
                <div className="text-xs text-blue-600 mb-1">Fin estimado</div>
                <div className="text-sm font-medium text-blue-900">
                  {calculatedDays.endDate}
                </div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-blue-200">
              <div className="flex justify-between text-sm">
                <span className="text-blue-700">Días necesarios:</span>
                <span className="font-semibold text-blue-900">
                  {calculatedDays.daysNeeded} días
                </span>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span className="text-blue-700">Meta diaria:</span>
                <span className="font-semibold text-blue-900">
                  {calculatedDays.targetPerDay} pzas/día
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <button
          onClick={onSave}
          disabled={isSaving}
          className="w-full rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {isSaving ? "Guardando..." : "Guardar Planificación"}
        </button>

        <p className="mt-3 text-xs text-gray-500 text-center">
          Al guardar, se creará la orden de trabajo y se asignará a la línea seleccionada
        </p>
      </div>
    </div>
  );
}