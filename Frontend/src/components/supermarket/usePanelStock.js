// components/supermarket/usePanelStock.js
//
// Stock de paneles por orden + color (GET /api/panel-stock/summary), refrescado
// solo. Lo usa el Plan Board del supermercado para pintar cuánto del plan ya
// está cubierto por paneles recibidos.

import { useState, useEffect, useCallback, useRef } from "react";
import { API_URL } from "../../lib/masterCodeCatalog";

export const stockColor = (v) => String(v ?? "").trim().toUpperCase();

export function usePanelStock({ pollMs = 30000 } = {}) {
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/panel-stock/summary`, {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) throw new Error(j?.error || `Error ${res.status}`);
      if (alive.current) { setOrders(j.orders || []); setError(null); }
    } catch (e) {
      if (alive.current) setError(e.message);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    reload();
    const t = setInterval(reload, pollMs);
    const onVis = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive.current = false; clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [reload, pollMs]);

  return { orders, error, reload };
}