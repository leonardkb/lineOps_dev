// components/warehouse/FinishedWarehouse.jsx
// Shell for the Almacén de Producto Terminado module: renders the navbar and
// switches between its sections. Point your router/menu at <FinishedWarehouse />.
import { useState } from "react";
import FinishedWarehouseNav from "../../components/FWH/FinishedWarehouseNav";
import PrePacking from "../../components/FWH/PrePacking";
// When they exist, drop these in and replace the placeholders below:
// import FinishedWarehouseDashboard from "./FinishedWarehouseDashboard";
// import FinishedInventory from "./FinishedInventory";

export default function FinishedWarehouse() {
  const [tab, setTab] = useState("pre-empaque");

  return (
    <div className="min-h-screen bg-gray-50">
      <FinishedWarehouseNav active={tab} onNavigate={setTab} />

      {tab === "pre-empaque" && <PrePacking />}

      {tab === "dashboard" && (
        <div className="max-w-6xl mx-auto p-10 text-center text-gray-400">Dashboard — próximamente</div>
      )}

      {tab === "inventario" && (
        <div className="max-w-6xl mx-auto p-10 text-center text-gray-400">Inventario — próximamente</div>
      )}
    </div>
  );
}