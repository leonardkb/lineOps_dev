// routes/production.routes.js
//
// Rutas de PRODUCCIÓN por orden de trabajo.
// El líder de línea captura lo producido; el planeador lo ve en Estado de Órdenes.
//
// Montaje en server1.js:
//   const productionRoutes = require("./routes/production.routes");
//   app.use("/api/work-orders", productionRoutes);
//
// Si ya montas otro router en "/api/work-orders", monta este ANTES del que
// tenga un `router.get("/:id")`, o Express nunca llegará a "/:id/production".
//
const express = require("express");
const router = express.Router();

// --- Ajusta estas dos rutas a tu proyecto -----------------------------------
const pool = require("../db");                              // tu Pool de pg
const { authenticateToken } = require("../middleware/auth"); // tu middleware JWT
// ---------------------------------------------------------------------------

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Recalcula produced_quantity / rejected_quantity desde el ledger y ajusta el
 * status. Se recalcula (en vez de incrementar) para que reintentos o borrados
 * nunca dejen el total desfasado.
 */
async function recalcWorkOrder(client, workOrderId) {
  const { rows } = await client.query(
    `UPDATE work_orders w
        SET produced_quantity = COALESCE(agg.total, 0),
            rejected_quantity = COALESCE(agg.rejects, 0),
            status = CASE
              WHEN w.status = 'cancelled' THEN 'cancelled'
              WHEN COALESCE(agg.total, 0) >= COALESCE(w.total_to_produce, w.quantity, 0)
                   AND COALESCE(w.total_to_produce, w.quantity, 0) > 0 THEN 'completed'
              WHEN COALESCE(agg.total, 0) > 0 THEN 'in_progress'
              ELSE w.status
            END,
            updated_at = NOW()
       FROM (
         SELECT SUM(produced_qty) AS total, SUM(rejected_qty) AS rejects
           FROM work_order_production
          WHERE work_order_id = $1
       ) agg
      WHERE w.id = $1
      RETURNING w.*`,
    [workOrderId]
  );
  return rows[0];
}

/**
 * POST /api/work-orders/:id/production
 * Body: { produced_qty, line_id?, rejected_qty?, production_date?, shift?, notes? }
 */
router.post("/:id/production", authenticateToken, async (req, res) => {
  const workOrderId = toNumber(req.params.id);
  const {
    produced_qty,
    line_id = null,
    rejected_qty = 0,
    production_date = null,
    shift = null,
    notes = null,
  } = req.body || {};

  if (!workOrderId) {
    return res.status(400).json({ success: false, error: "ID de orden inválido" });
  }

  const qty = toNumber(produced_qty);
  const rejects = toNumber(rejected_qty) ?? 0;

  if (qty === null || qty <= 0) {
    return res
      .status(400)
      .json({ success: false, error: "La cantidad producida debe ser mayor a cero" });
  }
  if (rejects < 0) {
    return res.status(400).json({ success: false, error: "El rechazo no puede ser negativo" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const wo = await client.query(
      "SELECT id, status, total_to_produce, quantity FROM work_orders WHERE id = $1 FOR UPDATE",
      [workOrderId]
    );

    if (wo.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Orden no encontrada" });
    }
    if (wo.rows[0].status === "cancelled") {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({ success: false, error: "No se puede capturar producción en una orden cancelada" });
    }

    const entry = await client.query(
      `INSERT INTO work_order_production
         (work_order_id, line_id, produced_qty, rejected_qty, production_date, shift, notes, created_by)
       VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6, $7, $8)
       RETURNING *`,
      [
        workOrderId,
        toNumber(line_id),
        qty,
        rejects,
        production_date,
        shift,
        notes,
        req.user?.id ?? null,
      ]
    );

    const workOrder = await recalcWorkOrder(client, workOrderId);

    await client.query("COMMIT");
    res.status(201).json({ success: true, entry: entry.rows[0], workOrder });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /:id/production error:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/work-orders/:id/production
 * Historial de capturas de una orden, con nombre de línea si existe la tabla.
 */
router.get("/:id/production", authenticateToken, async (req, res) => {
  const workOrderId = toNumber(req.params.id);
  if (!workOrderId) {
    return res.status(400).json({ success: false, error: "ID de orden inválido" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT p.*, l.name AS line_name
         FROM work_order_production p
         LEFT JOIN lines l ON l.id = p.line_id
        WHERE p.work_order_id = $1
        ORDER BY p.production_date DESC, p.created_at DESC`,
      [workOrderId]
    );

    const total = rows.reduce((s, r) => s + Number(r.produced_qty || 0), 0);
    res.json({ success: true, entries: rows, total_produced: total });
  } catch (err) {
    console.error("GET /:id/production error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/work-orders/:id/production/:entryId
 * Corrige una captura equivocada y recalcula el total.
 */
router.delete("/:id/production/:entryId", authenticateToken, async (req, res) => {
  const workOrderId = toNumber(req.params.id);
  const entryId = toNumber(req.params.entryId);

  if (!workOrderId || !entryId) {
    return res.status(400).json({ success: false, error: "Parámetros inválidos" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const del = await client.query(
      "DELETE FROM work_order_production WHERE id = $1 AND work_order_id = $2 RETURNING id",
      [entryId, workOrderId]
    );

    if (del.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Captura no encontrada" });
    }

    const workOrder = await recalcWorkOrder(client, workOrderId);

    await client.query("COMMIT");
    res.json({ success: true, workOrder });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("DELETE /:id/production/:entryId error:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;