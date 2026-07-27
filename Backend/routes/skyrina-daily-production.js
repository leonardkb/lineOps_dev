/* ============================================================================
 *  skyrina-daily-production.js
 *  ----------------------------------------------------------------------------
 *  Register-style module. Dependencies are passed IN from server1.js so nothing
 *  depends on module.exports timing (which was the 500 cause).
 *
 *  In server1.js (after authenticateToken / pool / setSchema exist, ~line 740):
 *      const registerDailyProduction = require("./skyrina-daily-production");
 *      registerDailyProduction(app, authenticateToken, pool, setSchema);
 *
 *  Mounted route:  GET /api/skyrina/daily-production
 *      ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&style=<style|all>&lineNo=<lineNo|all>
 * ==========================================================================*/

const express = require("express");

module.exports = function registerDailyProduction(app, authenticateToken, pool, setSchema) {
  if (!pool || typeof setSchema !== "function") {
    throw new Error(
      "registerDailyProduction: pool and setSchema must be passed in — " +
      "call registerDailyProduction(app, authenticateToken, pool, setSchema)"
    );
  }

  const router = express.Router();

  router.get("/daily-production", authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
      await setSchema(client);

      const { startDate, endDate, style, lineNo } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: "startDate and endDate parameters required",
        });
      }

      if (!["master", "skyrina", "engineer", "supervisor", "soporte_it"].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: "Access denied" });
      }

      const params = [startDate, endDate];
      let paramIndex = 3;
      let runFilters = "";

      if (style && style !== "all") {
        runFilters += ` AND lr.style = $${paramIndex++}`;
        params.push(style);
      }
      if (lineNo && lineNo !== "all") {
        runFilters += ` AND lr.line_no = $${paramIndex++}`;
        params.push(lineNo);
      }

      const query = `
        WITH daily_runs AS (
          SELECT lr.id AS run_id, lr.run_date, lr.target_pcs
          FROM line_runs lr
          WHERE lr.run_date BETWEEN $1 AND $2${runFilters}
        ),
        day_target AS (
          SELECT run_date, SUM(target_pcs) AS target
          FROM daily_runs
          GROUP BY run_date
        ),
        day_produced AS (
          SELECT dr.run_date, COALESCE(SUM(se.sewed_qty), 0) AS produced
          FROM daily_runs dr
          JOIN run_operators ro        ON dr.run_id = ro.run_id
          JOIN operator_operations oo  ON ro.id = oo.run_operator_id
          LEFT JOIN operation_sewed_entries se ON oo.id = se.operation_id
          WHERE (oo.operation_name ILIKE '%pack%' OR oo.operation_name ILIKE '%emp%')
          GROUP BY dr.run_date
        )
        SELECT
          t.run_date              AS date,
          t.target                AS target,
          COALESCE(p.produced, 0) AS produced
        FROM day_target t
        LEFT JOIN day_produced p ON t.run_date = p.run_date
        ORDER BY t.run_date
      `;

      const result = await client.query(query, params);

      const days = result.rows.map((row) => ({
        date:
          row.date instanceof Date
            ? row.date.toISOString().slice(0, 10)
            : String(row.date).slice(0, 10),
        target: Math.round((parseFloat(row.target) || 0) * 100) / 100,
        produced: Math.round((parseFloat(row.produced) || 0) * 100) / 100,
      }));

      res.json({ success: true, period: { startDate, endDate }, days });
    } catch (err) {
      console.error("❌ Error fetching daily production:", err.message);
      res.status(500).json({ success: false, error: err.message });
    } finally {
      client.release();
    }
  });

  app.use("/api/skyrina", router);
};