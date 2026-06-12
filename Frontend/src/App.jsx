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

      </Routes>
    </Router>
  );
}