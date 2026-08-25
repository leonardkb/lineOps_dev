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
import QualityAnalytics from "./pages/Qualityanalytics";
import MechanicsDashboard from "./pages/MechanicsDashboard";
import MerchantDashboard from "./pages/merchant/MerchantDashboard";
import MerchantPage from "./pages/merchant/MerchantPage";
import WorkOrderForm from "./components/merchant/WorkOrderForm";
import NuevaOrdenWizard from "./components/merchant/NuevaOrdenWizard";
import CuttingApp from "./pages/Corte/CuttingApp";
import FinishedWarehouse from "./pages/FWHS/FinishedWarehouse";
import AdminUsers from "./pages/AdminUsers";
import QualityHead from "./pages/quality_head/QualityHead";
import MerchantAnalytics from "./pages/MerchantAnalytics";
import CutOrderAnalytics from "./pages/Corte/CutOrderAnalytics";
import FinishedWarehouseAnalytics from "./pages/FWHS/FinishedWarehouseAnalytics";
import PreOrdenesPage from "./components/merchant/PreOrdenesPage";
import PreOrdenWizard from "./components/merchant/Preordenwizard";
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
        <Route path="/mecanics"        element={<MechanicsDashboard/>} />
        <Route path="/merchant-dashboard" element={<MerchantDashboard />} /> {/*merchant dashboard route */}
        <Route path="/merchant"      element={<MerchantPage />} /> {/*merchant dashboard route */}
        <Route path="/work-order-form" element={<WorkOrderForm />} /> {/*work order form route */}
        <Route path="/nuevo-orden-wizard"  element={<NuevaOrdenWizard/>} /> {/*new work order wizard route */}
        <Route path="/cutting" element={<CuttingApp />} /> {/*cutting app route */}
        <Route path="/users" element={<AdminUsers />} /> {/*users route */}
        <Route path="/fws" element={<FinishedWarehouse />} /> {/*finished warehouse route */}
        <Route path="/quality-head" element={<QualityHead />} /> {/*quality head route */}
        <Route path ="merchant-analytics" element={<MerchantAnalytics/>} /> {/*merchant analytics route */}
        <Route path='/cut-order-analytics' element={<CutOrderAnalytics/>} /> {/*cut order analytics route */}
        <Route path='/fwh-analytics' element={<FinishedWarehouseAnalytics/>} /> {/*finished warehouse analytics route */}
        <Route path='/pre-ordenes' element={<PreOrdenesPage/>} /> {/*pre-orders route */}
        <Route path='/pre-orden-wizard' element ={<PreOrdenWizard/>}/>
      </Routes>
    </Router>
  );
}