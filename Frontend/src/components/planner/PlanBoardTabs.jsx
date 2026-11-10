// components/planner/PlanBoardTabs.jsx
//
// Two boards, one screen:
//   • Plan Board        — the real plan (POs + merchant pre-orders)
//   • Tablero pronóstico — the customer's forecast (FC#### created here)
//
// Use it where <PlanBoard /> is rendered today:
//     import PlanBoardTabs from "./PlanBoardTabs";
//     <PlanBoardTabs onOpenCutOrders={...} canLockWeeks={...} />
// Every prop is passed straight to the Plan Board tab. The forecast tab is a
// separate PlanBoard instance in mode="forecast" (own data, own endpoints).
import { useState } from "react";
import { CalendarDays, TrendingUp } from "lucide-react";
import PlanBoard from "./PlanBoard";

const TABS = [
  { key: "plan", label: "Plan Board", icon: CalendarDays },
  { key: "forecast", label: "Tablero de pronóstico", icon: TrendingUp },
];

export default function PlanBoardTabs(props) {
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem("planboard.tab") === "forecast" ? "forecast" : "plan"; } catch { return "plan"; }
  });
  const pick = (k) => {
    setTab(k);
    try { localStorage.setItem("planboard.tab", k); } catch { /* ignore */ }
  };

  return (
    <div>
      <div role="tablist" aria-label="Tableros" className="mb-3 inline-flex rounded-xl border border-gray-200 bg-gray-100 p-1">
        {TABS.map(({ key, label, icon: Icon }) => {
          const on = tab === key;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={on}
              onClick={() => pick(key)}
              className={`h-9 inline-flex items-center gap-2 rounded-lg px-4 text-sm font-medium transition ${
                on
                  ? key === "forecast" ? "bg-teal-600 text-white shadow-sm" : "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          );
        })}
      </div>

      {/* Only the active board is mounted: each one polls its own data and
          registers window listeners, so the hidden one must not keep running. */}
      {tab === "plan" ? (
        <PlanBoard key="plan" {...props} />
      ) : (
        <PlanBoard
          key="forecast"
          mode="forecast"
          onOpenCutOrders={null}
          canLockWeeks={false}
          heading={props.forecastHeading || "Tablero de pronóstico"}
          subheading={props.forecastSubheading}
        />
      )}
    </div>
  );
}