import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import PlannerPage from "./pages/PlannerPage";
import LoginPage from "./components/LoginPage";
import LineInfo from "./pages/LineInfo";
import AdminDashboard from "./pages/AdminDashboard";
import LineLeaderPage from "./pages/LineLeaderPage";
import Dashboard from "./pages/Dashboard";
import LineBalancing from "./pages/LineBalancing";
import LineTvDashboard from "./pages/LineTvDashboard";
import SkyrinaDashboard from "./pages/SkyrinaDashboard";
import AdvancedPlanningPage from "./pages/AdvancedPlanningPage";
import Overview from "./pages/Overview";
import ActualEfficiency from "./pages/ActualEfficiency";
import QualityInspectorPage from "./pages/QualityInspectorPage";
import QualityAnalytics from "./pages/QualityAnalytics";
import EditOperationPlanner from "./pages/EditOperationPlanner";
import ITControlPanel from "./components/IT/ITControlPanel";
import MerchantDashboard from "./pages/merchant/MerchantDashboard";
import MerchantPage from "./pages/merchant/MerchantPage";
import MechanicsDashboard from "./pages/MechanicsDashboard";
import NuevaOrdenWizard from "./components/merchant/NuevaOrdenWizard";
import CuttingApp from "./pages/Corte/CuttingApp";
import FinishedWarehouse from "./pages/FWHS/FinishedWarehouse";
import FabricWarehouse from "./pages/FabricWH/FabricWarehouse";
import QualityHead from "./pages/quality_head/QualityHead";
import MerchantAnalytics from "./pages/MerchantAnalytics";
import CutOrderAnalytics from "./pages/Corte/CutOrderAnalytics";
import FinishedWarehouseAnalytics from "./pages/FWHS/FinishedWarehouseAnalytics";
import PreOrdenesPage from "./components/merchant/PreOrdenesPage";
import PreOrdenWizard from "./components/merchant/PreOrdenWizard";
import TicketCard from "./components/cutting/TicketCard";
import SupermarketPage from "./pages/supermarket/SupermarketPage";
import PlannerAnalytics from "./components/planner/PlannerAnalytics";
import VerificadorPage from "./pages/Verificadorpage";
import ClientCatalogPage from "./pages/merchant/ClientCatalogPage";
import ProductCatalogPage from "./pages/merchant/ProductCatalogPage";
import BillOfMaterialsPage from "./pages/merchant/Billofmaterialspage";
import StyleOrderWizard from "./components/merchant/StyleOrderWizard";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/planner" element={<PlannerPage />} />                    {/*planner route */}
        <Route path="/line_info" element={<LineInfo />} />                     {/*line info route */}
        <Route path="/" element={<LoginPage />} />                             {/* login route */}
        <Route path="/admin-dashboard" element={<AdminDashboard />} />         {/*operator insight dashboard route */}
         <Route path="/admin" element={<Dashboard />} />                       {/* admin dashboard route */}
        <Route path="/lineleader" element={<LineLeaderPage />} />              {/*line leader dashboard route */}
        <Route path="/line-balancing" element={<LineBalancing />} />           {/*line balancing route */}
        <Route path="/line-tv" element={<LineTvDashboard />} />                {/*line tv dashboard route */}
        <Route path="/skyrina" element={<SkyrinaDashboard />}/>                {/*skyrina dashboard route */}
        <Route path="/advanced-planning" element={<AdvancedPlanningPage />} /> {/*advanced planning route */}
        <Route path="/overview" element= {<Overview />} /> {/*overview route */ }
        <Route path = "/actual-efficiency" element={<ActualEfficiency />} /> {/*actual efficiency route */}
        <Route path="/quality-inspector" element={<QualityInspectorPage />} />  {/* ← ADD THIS */}
        <Route path="/quality-monitor" element={<QualityAnalytics/>} />  {/*quality monitor route, same component as quality inspector */}
        <Route path="/edit-operation" element={<EditOperationPlanner />} />  {/*edit operation route */}
        <Route path="/merchant-dashboard" element={<MerchantDashboard />} /> {/*merchant dashboard route */}
        <Route path="/merchant" element={<MerchantPage />} /> {/*merchant route */}
        <Route path="/mecanics" element={<MechanicsDashboard/>} />
        <Route path="/nuevo-orden-wizard"  element={<NuevaOrdenWizard/>} /> {/*new work order wizard route */}
        <Route path="/cutting" element={<CuttingApp />} /> {/*cutting app route */}
        <Route path="/fws" element={<FinishedWarehouse />} /> {/*finished warehouse route */}

        <Route path="/fabric-warehouse" element={<FabricWarehouse />} /> {/*fabric warehouse route */}
        <Route path="/fabric-warehouse/:tab" element={<FabricWarehouse />} /> {/*fabric warehouse sections */}


        <Route path="/quality-head" element={<QualityHead />} /> {/*quality head route */}
        <Route path="/merchant-analytics" element={<MerchantAnalytics />} /> {/*merchant analytics route */}
        <Route path="/cut-order-analytics" element={<CutOrderAnalytics />} /> {/*cut order analytics route */}
        <Route path="/fwh-analytics" element={<FinishedWarehouseAnalytics />} /> {/*fwh analytics route */}
        <Route path='/pre-ordenes' element={<PreOrdenesPage/>} /> {/*pre-orders route */}
        <Route path='/pre-orden-wizard' element ={<PreOrdenWizard/>}/>

        <Route path='/supermarket-plan' element={<SupermarketPage/>} /> {/*supermarket plan route */}
        <Route path='/planner-analytics' element={<PlannerAnalytics/>} /> {/*planner analytics route */}
        <Route path='/verificador' element={<VerificadorPage/>} /> {/*verificador route */}
        <Route path='/clientes'  element={<ClientCatalogPage/>} /> {/*clientes route */}
        <Route path='/products' element={<ProductCatalogPage/>} /> {/*products route */}
        <Route path='/bom' element={<BillOfMaterialsPage/>} /> {/*bom route */}

        <Route path='/it-control' element={<ITControlPanel />} /> {/*admin dashboard route */}

        <Route path='/style-order' element={<StyleOrderWizard/>} /> {/*style order wizard route */}


        <Route path="/corte/ticket" element={<TicketCard />} />
      </Routes>
    </Router>
  );
}