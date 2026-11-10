import { useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import NavVerificador, { VERIFICADOR_TABS } from "./NavVerificador";
// Ojo con mayúsculas: el archivo se llama Verificadorpage.jsx. En Linux
// (build de producción) "./VerificadorPage" no lo encontraría.
import VerificadorPage from "../../pages/VerificadorPage";
import ReporteSemanasBloqueadas from "./ReporteSemanasBloqueadas";

// Misma lista que ALLOWED_ROLES en Verificadorpage.jsx y que requireVerificador
// en server.js (normalizada: sin guiones bajos).
const ALLOWED_ROLES = new Set([
  "verificador", "planner", "engineer", "supervisor", "soporteit",
  "skyrina", "master", "inspector", "qualityhead", "admin",
]);
const normalizeRole = (r) => String(r || "").toLowerCase().trim().replace(/[\s_-]/g, "");

// La pestaña activa vive en la URL (?tab=reportes) para que un recargo o un
// enlace compartido abra la misma pestaña.
export default function VerificadorSection() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  }, []);
  const allowed = !!localStorage.getItem("token") && !!user && ALLOWED_ROLES.has(normalizeRole(user.role));

  // La pestaña de reportes no tiene su propio chequeo de sesión: se hace aquí
  // para las dos.
  useEffect(() => {
    if (!allowed) navigate("/", { replace: true });
  }, [allowed, navigate]);

  const requested = params.get("tab");
  const activeTab = VERIFICADOR_TABS.some((t) => t.key === requested)
    ? requested
    : VERIFICADOR_TABS[0].key;

  const changeTab = (key) => {
    const next = new URLSearchParams(params);
    next.set("tab", key);
    setParams(next, { replace: true });
  };

  if (!allowed) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavVerificador tabs={VERIFICADOR_TABS} activeTab={activeTab} onTabChange={changeTab} />
      <main role="tabpanel">
        {activeTab === "correccion" && <VerificadorPage />}
        {activeTab === "reportes" && <ReporteSemanasBloqueadas />}
      </main>
    </div>
  );
}