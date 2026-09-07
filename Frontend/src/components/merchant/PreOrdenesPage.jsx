import { useState } from "react";
import MerchantNavbar from "../../components/merchant/MerchantNavbar";
import PreOrdenesPanel from "../../components/merchant/PreOrdenesPanel";

/* -----------------------------------------------------------------------
 *  Página /pre-ordenes: el mismo listado que vive en la pestaña
 *  "Pre-órdenes" del dashboard, con su propio marco. Es a donde regresa
 *  NuevaOrdenWizard después de convertir una pre-orden en PO.
 * --------------------------------------------------------------------- */

export default function PreOrdenesPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    setRefreshing(true);
    setRefreshKey((n) => n + 1);
    setTimeout(() => setRefreshing(false), 600);
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <MerchantNavbar title="Pre-órdenes" onRefresh={refresh} isRefreshing={refreshing} />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <PreOrdenesPanel refreshKey={refreshKey} />
      </main>
    </div>
  );
}