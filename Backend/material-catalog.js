// ==========================================================================
// material-catalog.js  (catálogo de avíos y empaque con código por tipo)
//
// Every trim and packaging item used in a style BOM gets a catalog code made
// of a 3-letter TYPE prefix + a 3-digit sequence within that type:
//     CIE001  cierre        BOT004  botón        CAJ001  caja
// Fabrics stay in the existing `fabrics` table (/api/fabrics) — the BOM takes
// the fabric code from there.
//
// SETUP  (server1.js)
//   1. const registerMaterialCatalog = require("./material-catalog");
//   2. await registerMaterialCatalog.initSchema({ pool, setSchema });   // with the other initSchema calls
//   3. registerMaterialCatalog(app, { authenticateToken, pool, setSchema });
//
// Endpoints
//   GET  /api/materials/types?group=trim|packaging          -> { types }
//   POST /api/materials/types   { code, label, group, defaultUnit } -> { type }
//   GET  /api/materials?group=&type=&q=                     -> { materials }
//   POST /api/materials   { typeCode, name, unit?, supplier?, spec?, color? }
//                                                           -> { material }  (code auto: CIE001…)
//   PUT  /api/materials/:id { name, unit, supplier, spec, color, active } -> { material }
// ==========================================================================

const UNITS = ["pzs", "unid", "mts", "yds", "kg"];
const GROUPS = ["trim", "packaging"];

// Seed types. Codes are global (one prefix = one type), so a trim and a
// packaging type never share a prefix.
const DEFAULT_TYPES = [
  // avíos (trims)
  ["CIE", "Cierre", "trim", "pzs"],
  ["BOT", "Botón", "trim", "pzs"],
  ["BRO", "Broche", "trim", "pzs"],
  ["ETQ", "Etiqueta", "trim", "pzs"],
  ["HIL", "Hilo", "trim", "mts"],
  ["ELA", "Elástico", "trim", "mts"],
  ["CIN", "Cinta / reata", "trim", "mts"],
  ["VEL", "Velcro", "trim", "mts"],
  ["OJI", "Ojillo / remache", "trim", "pzs"],
  ["TRA", "Transfer / estampado", "trim", "pzs"],
  ["ENT", "Entretela", "trim", "mts"],
  ["COR", "Cordón", "trim", "mts"],
  // empaque (packaging)
  ["CAJ", "Caja", "packaging", "pzs"],
  ["BOL", "Bolsa", "packaging", "pzs"],
  ["GAN", "Gancho", "packaging", "pzs"],
  ["COL", "Colgante / hangtag", "packaging", "pzs"],
  ["SUJ", "Sujetador de talla", "packaging", "pzs"],
  ["UPC", "Etiqueta UPC / RFID", "packaging", "pzs"],
  ["PAP", "Papel tissue", "packaging", "pzs"],
  ["CAD", "Cinta adhesiva", "packaging", "mts"],
];

const txt = (v, n) => (v == null ? null : String(v).trim().slice(0, n || 200) || null);
const unitOf = (v, fallback = "pzs") => (UNITS.includes(String(v || "").toLowerCase()) ? String(v).toLowerCase() : fallback);
const typeCodeOf = (v) => {
  const c = String(v || "").toUpperCase().replace(/[^A-Z]/g, "");
  return c.length === 3 ? c : null;
};

async function initSchema({ pool, setSchema }) {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query(`
      CREATE TABLE IF NOT EXISTS material_types(
        code          VARCHAR(3)  PRIMARY KEY,
        label         VARCHAR(80) NOT NULL,
        grp           VARCHAR(16) NOT NULL CHECK (grp IN ('trim','packaging')),
        default_unit  VARCHAR(8)  NOT NULL DEFAULT 'pzs',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS material_catalog(
        id          BIGSERIAL PRIMARY KEY,
        code        VARCHAR(12)  NOT NULL UNIQUE,
        type_code   VARCHAR(3)   NOT NULL REFERENCES material_types(code),
        seq         INTEGER      NOT NULL,
        name        VARCHAR(200) NOT NULL,
        unit        VARCHAR(8)   NOT NULL DEFAULT 'pzs',
        supplier    VARCHAR(150),
        spec        VARCHAR(300),
        color       VARCHAR(60),
        active      BOOLEAN      NOT NULL DEFAULT true,
        created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        UNIQUE (type_code, seq)
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_material_catalog_type ON material_catalog(type_code);");
    for (const [code, label, grp, unit] of DEFAULT_TYPES) {
      await client.query(
        `INSERT INTO material_types(code, label, grp, default_unit) VALUES ($1,$2,$3,$4)
         ON CONFLICT (code) DO NOTHING`,
        [code, label, grp, unit]
      );
    }
    console.log("\u2705 material_types / material_catalog ready in prod_db_schema");
  } finally {
    client.release();
  }
}

function registerMaterialCatalog(app, { authenticateToken, pool, setSchema }) {
  const shapeType = (r) => ({ code: r.code, label: r.label, group: r.grp, defaultUnit: r.default_unit, count: Number(r.count || 0) });
  const shapeMat = (r) => ({
    id: Number(r.id),
    code: r.code,
    typeCode: r.type_code,
    typeLabel: r.type_label || null,
    group: r.grp || null,
    name: r.name,
    unit: r.unit,
    supplier: r.supplier,
    spec: r.spec,
    color: r.color,
    active: r.active,
  });

  app.get("/api/materials/types", authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
      await setSchema(client);
      const params = [];
      let where = "";
      if (GROUPS.includes(req.query.group)) { params.push(req.query.group); where = "WHERE t.grp = $1"; }
      const { rows } = await client.query(
        `SELECT t.*, (SELECT COUNT(*) FROM material_catalog m WHERE m.type_code = t.code) AS count
           FROM material_types t ${where}
          ORDER BY t.grp, t.label`,
        params
      );
      res.json({ success: true, types: rows.map(shapeType), units: UNITS });
    } catch (err) {
      console.error("\u274c GET /api/materials/types:", err.message);
      res.status(500).json({ success: false, error: err.message });
    } finally { client.release(); }
  });

  app.post("/api/materials/types", authenticateToken, async (req, res) => {
    const code = typeCodeOf(req.body?.code);
    const label = txt(req.body?.label, 80);
    const grp = GROUPS.includes(req.body?.group) ? req.body.group : null;
    if (!code || !label || !grp) {
      return res.status(400).json({ success: false, error: "Tipo inválido: código de 3 letras, nombre y grupo (avío o empaque)." });
    }
    const client = await pool.connect();
    try {
      await setSchema(client);
      const { rows } = await client.query(
        `INSERT INTO material_types(code, label, grp, default_unit) VALUES ($1,$2,$3,$4) RETURNING *`,
        [code, label, grp, unitOf(req.body?.defaultUnit)]
      );
      res.json({ success: true, type: shapeType(rows[0]) });
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ success: false, error: `El prefijo ${code} ya existe.` });
      console.error("\u274c POST /api/materials/types:", err.message);
      res.status(500).json({ success: false, error: err.message });
    } finally { client.release(); }
  });

  app.get("/api/materials", authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
      await setSchema(client);
      const where = ["m.active"];
      const params = [];
      if (GROUPS.includes(req.query.group)) { params.push(req.query.group); where.push(`t.grp = $${params.length}`); }
      const tc = typeCodeOf(req.query.type);
      if (tc) { params.push(tc); where.push(`m.type_code = $${params.length}`); }
      const q = txt(req.query.q, 100);
      if (q) { params.push(`%${q}%`); where.push(`(m.code ILIKE $${params.length} OR m.name ILIKE $${params.length} OR m.supplier ILIKE $${params.length})`); }
      const { rows } = await client.query(
        `SELECT m.*, t.label AS type_label, t.grp
           FROM material_catalog m JOIN material_types t ON t.code = m.type_code
          WHERE ${where.join(" AND ")}
          ORDER BY m.type_code, m.seq
          LIMIT 1000`,
        params
      );
      res.json({ success: true, materials: rows.map(shapeMat) });
    } catch (err) {
      console.error("\u274c GET /api/materials:", err.message);
      res.status(500).json({ success: false, error: err.message });
    } finally { client.release(); }
  });

  // Create an item; the code is the type prefix + the next 3-digit sequence.
  app.post("/api/materials", authenticateToken, async (req, res) => {
    const typeCode = typeCodeOf(req.body?.typeCode);
    const name = txt(req.body?.name, 200);
    if (!typeCode || !name) return res.status(400).json({ success: false, error: "Elige el tipo y escribe el nombre del material." });
    const client = await pool.connect();
    try {
      await setSchema(client);
      await client.query("BEGIN");
      const t = await client.query("SELECT * FROM material_types WHERE code=$1", [typeCode]);
      if (!t.rows.length) { await client.query("ROLLBACK"); return res.status(400).json({ success: false, error: `No existe el tipo ${typeCode}.` }); }
      // serialize numbering per type
      await client.query("SELECT pg_advisory_xact_lock(hashtext('material_catalog:' || $1))", [typeCode]);
      const n = await client.query("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM material_catalog WHERE type_code=$1", [typeCode]);
      const seq = Number(n.rows[0].next);
      const code = `${typeCode}${String(seq).padStart(3, "0")}`;
      const { rows } = await client.query(
        `INSERT INTO material_catalog(code, type_code, seq, name, unit, supplier, spec, color, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [code, typeCode, seq, name, unitOf(req.body?.unit, t.rows[0].default_unit), txt(req.body?.supplier, 150),
         txt(req.body?.spec, 300), txt(req.body?.color, 60), req.user?.id ?? null]
      );
      await client.query("COMMIT");
      res.json({ success: true, material: shapeMat({ ...rows[0], type_label: t.rows[0].label, grp: t.rows[0].grp }) });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("\u274c POST /api/materials:", err.message);
      res.status(500).json({ success: false, error: err.message });
    } finally { client.release(); }
  });

  app.put("/api/materials/:id", authenticateToken, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ success: false, error: "id inválido" });
    const b = req.body || {};
    const client = await pool.connect();
    try {
      await setSchema(client);
      const { rows } = await client.query(
        `UPDATE material_catalog SET
            name = COALESCE($2, name), unit = COALESCE($3, unit), supplier = $4, spec = $5, color = $6,
            active = COALESCE($7, active), updated_at = now()
          WHERE id = $1 RETURNING *`,
        [id, txt(b.name, 200), b.unit ? unitOf(b.unit) : null, txt(b.supplier, 150), txt(b.spec, 300), txt(b.color, 60),
         typeof b.active === "boolean" ? b.active : null]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: "Material no encontrado" });
      res.json({ success: true, material: shapeMat(rows[0]) });
    } catch (err) {
      console.error("\u274c PUT /api/materials/:id:", err.message);
      res.status(500).json({ success: false, error: err.message });
    } finally { client.release(); }
  });
}

registerMaterialCatalog.initSchema = initSchema;
module.exports = registerMaterialCatalog;