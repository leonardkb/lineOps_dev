// components/warehouse/FinishedWarehouse.jsx
// Shell for the Almacén de Producto Terminado module: renders the navbar and
// switches between its sections. Point your router/menu at <FinishedWarehouse />.
import { useState } from "react";
import FinishedWarehouseNav from "../../components/FWH/FinishedWarehouseNav";
import PrePacking from "../../components/FWH/PrePacking";
import FinishedWarehouseDashboard from "../../components/FWH/Finishedwarehousedashboard";
import FinishedWarehouseScan from "../../components/FWH/Finishedwarehousescan";
import FinishedWarehouseInventory from "../../components/FWH/FinishedWarehouseInventory";
// When they exist, drop these in and replace the placeholders below:
// import FinishedWarehouseDashboard from "./FinishedWarehouseDashboard";
// import FinishedInventory from "./FinishedInventory";

export default function FinishedWarehouse() {
  const [tab, setTab] = useState("pre-empaque");

  return (
    <div className="min-h-screen bg-gray-50">
      <FinishedWarehouseNav active={tab} onNavigate={setTab} />

      {tab === "pre-empaque" && <PrePacking />}

      {tab === "escaneo"    && <FinishedWarehouseScan onNavigate={setTab} />} 

      {tab === "dashboard" && (
        <FinishedWarehouseDashboard active ={tab} onNavigate={setTab} />
      )}

      {tab === "inventario" && (
        <FinishedWarehouseInventory active ={tab} onNavigate={setTab} />
      )}
    </div>
  );
}