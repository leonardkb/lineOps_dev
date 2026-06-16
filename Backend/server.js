require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const bcrypt = require("bcrypt");


const app = express();
app.use(cors());
app.use(express.json());


const pool = new Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT),
  database: process.env.PG_DB,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  ssl: false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Helper function to set schema for a client connection
const setSchema = async (client) => {
  await client.query("SET search_path TO prod_db_schema");
};

// Create all tables with correct constraints in prod_db_schema
const createAllTables = async () => {
  const client = await pool.connect();
  try {
    console.log("🔄 Creating/verifying database tables in prod_db_schema...");

    await setSchema(client);

    // 0. Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users(
        id BIGSERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'line_leader',
        line_number INT NULL,
        full_name VARCHAR(100) NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT chk_role CHECK (role IN ('engineer', 'line_leader', 'supervisor',
         'soporte_it','skyrina','planner','master', 'quality_inspector')),
        CONSTRAINT chk_line_number CHECK (line_number IS NULL OR (line_number >= 1 AND line_number <= 26))
      );
    `);
    console.log("✅ users table ready in prod_db_schema");

    // 1. Create line_runs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS line_runs(
        id BIGSERIAL PRIMARY KEY,
        line_no TEXT NOT NULL,
        run_date DATE NOT NULL,
        style TEXT NOT NULL,
        operators_count INT NOT NULL DEFAULT 0,
        working_hours NUMERIC(6,2) NOT NULL,
        sam_minutes NUMERIC(10,2) NOT NULL,
        efficiency NUMERIC(4,3) NOT NULL,
        target_pcs NUMERIC(12,2) NOT NULL DEFAULT 0,
        target_per_hour NUMERIC(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_line_run UNIQUE (line_no, run_date, style),
        CONSTRAINT chk_efficiency_range CHECK (efficiency > 0 AND efficiency <= 1),
        CONSTRAINT chk_working_hours_positive CHECK (working_hours > 0),
        CONSTRAINT chk_sam_positive CHECK (sam_minutes > 0)
      );
    `);
    console.log("✅ line_runs table ready in prod_db_schema");

    // 2. Create shift_slots table
    await client.query(`
      CREATE TABLE IF NOT EXISTS shift_slots(
        id BIGSERIAL PRIMARY KEY,
        run_id BIGINT NOT NULL REFERENCES line_runs(id) ON DELETE CASCADE,
        slot_order INT NOT NULL,
        slot_label TEXT NOT NULL,
        slot_start TIME NULL,
        slot_end TIME NULL,
        planned_hours NUMERIC(6,3) NOT NULL,
        UNIQUE (run_id, slot_order),
        UNIQUE (run_id, slot_label),
        CONSTRAINT chk_planned_hours_nonnegative CHECK (planned_hours >= 0)
      );
    `);
    console.log("✅ shift_slots table ready in prod_db_schema");

    // 3. Create run_operators table
    await client.query(`
      CREATE TABLE IF NOT EXISTS run_operators(
        id BIGSERIAL PRIMARY KEY,
        run_id BIGINT NOT NULL REFERENCES line_runs(id) ON DELETE CASCADE,
        operator_no INT NOT NULL,
        operator_name TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (run_id, operator_no),
        CONSTRAINT chk_operator_no_positive CHECK (operator_no > 0)
      );
    `);
    console.log("✅ run_operators table ready in prod_db_schema");

    // 4. Create operator_operations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS operator_operations(
        id BIGSERIAL PRIMARY KEY,
        run_id BIGINT NOT NULL REFERENCES line_runs(id) ON DELETE CASCADE,
        run_operator_id BIGINT NOT NULL REFERENCES run_operators(id) ON DELETE CASCADE,
        operation_name TEXT NOT NULL,
        t1_sec NUMERIC(10,2) NULL,
        t2_sec NUMERIC(10,2) NULL,
        t3_sec NUMERIC(10,2) NULL,
        t4_sec NUMERIC(10,2) NULL,
        t5_sec NUMERIC(10,2) NULL,
        capacity_per_hour NUMERIC(12,3) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (run_operator_id, operation_name)
      );
    `);
    console.log("✅ operator_operations table ready in prod_db_schema");

    // 5. Create operation_hourly_entries table
    await client.query(`
      CREATE TABLE IF NOT EXISTS operation_hourly_entries(
        id BIGSERIAL PRIMARY KEY,
        run_id BIGINT NOT NULL REFERENCES line_runs(id) ON DELETE CASCADE,
        operation_id BIGINT NOT NULL REFERENCES operator_operations(id) ON DELETE CASCADE,
        slot_id BIGINT NOT NULL REFERENCES shift_slots(id) ON DELETE CASCADE,
        stitched_qty NUMERIC(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (operation_id, slot_id),
        CONSTRAINT chk_stitched_qty_nonnegative CHECK (stitched_qty >= 0)
      );
    `);
    console.log("✅ operation_hourly_entries table ready in prod_db_schema");

    // 5.5 Create operation_sewed_entries table (Line Leader actuals)
    await client.query(`
      CREATE TABLE IF NOT EXISTS operation_sewed_entries(
        id BIGSERIAL PRIMARY KEY,
        run_id BIGINT NOT NULL REFERENCES line_runs(id) ON DELETE CASCADE,
        operation_id BIGINT NOT NULL REFERENCES operator_operations(id) ON DELETE CASCADE,
        slot_id BIGINT NOT NULL REFERENCES shift_slots(id) ON DELETE CASCADE,
        sewed_qty NUMERIC(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (operation_id, slot_id),
        CONSTRAINT chk_sewed_qty_nonnegative CHECK (sewed_qty >= 0)
      );
    `);
    console.log("✅ operation_sewed_entries table ready in prod_db_schema");
// 7 Create line_balancing_assignments table
await client.query(`
  CREATE TABLE IF NOT EXISTS line_balancing_assignments (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES line_runs(id) ON DELETE CASCADE,
    source_operator_id BIGINT NOT NULL REFERENCES run_operators(id) ON DELETE CASCADE,
    target_operator_id BIGINT NOT NULL REFERENCES run_operators(id) ON DELETE CASCADE,
    operation_id BIGINT NOT NULL REFERENCES operator_operations(id) ON DELETE CASCADE,
    assigned_quantity_per_hour NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, source_operator_id, target_operator_id, operation_id)
  );
`);
console.log("✅ line_balancing_assignments table ready in prod_db_schema");
    // 6. Create slot_targets table
    await client.query(`
      CREATE TABLE IF NOT EXISTS slot_targets(
        id BIGSERIAL PRIMARY KEY,
        run_id BIGINT NOT NULL REFERENCES line_runs(id) ON DELETE CASCADE,
        slot_id BIGINT NOT NULL REFERENCES shift_slots(id) ON DELETE CASCADE,
        slot_target NUMERIC(12,2) NOT NULL DEFAULT 0,
        cumulative_target NUMERIC(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (run_id, slot_id)
      );
      
    `);
    console.log("✅ slot_targets table ready in prod_db_schema");

    // 7. Add to createAllTables function after other table creations
await client.query(`
  CREATE TABLE IF NOT EXISTS operator_capacity_history (
    id BIGSERIAL PRIMARY KEY,
    operation_id BIGINT NOT NULL REFERENCES operator_operations(id) ON DELETE CASCADE,
    old_capacity NUMERIC(12,3) NOT NULL,
    new_capacity NUMERIC(12,3) NOT NULL,
    changed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_capacity_positive CHECK (new_capacity >= 0)
  );
`);
console.log("✅ operator_capacity_history table ready in prod_db_schema");


// Update the work_orders table schema to include new fields
await client.query(`
  CREATE TABLE IF NOT EXISTS work_orders(
    id BIGSERIAL PRIMARY KEY,
    work_order_no VARCHAR(50) UNIQUE NOT NULL,
    quantity NUMERIC(12,2) NOT NULL,
    customer_name VARCHAR(100) NOT NULL,
    style_description TEXT NOT NULL,
    color VARCHAR(50),
    fabric_supplier VARCHAR(100),
    style_code VARCHAR(50),
    line_no VARCHAR(20),
    run_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    CONSTRAINT chk_quantity_positive CHECK (quantity > 0),
    CONSTRAINT chk_status CHECK (status IN ('pending', 'assigned', 'in_progress', 'completed'))
  );
`);console.log("✅ work_orders table ready in prod_db_schema");

// 9. Create line_assignments table (junction between work_orders and line_runs)
await client.query(`
  CREATE TABLE IF NOT EXISTS line_assignments(
    id BIGSERIAL PRIMARY KEY,
    work_order_id BIGINT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    line_run_id BIGINT REFERENCES line_runs(id) ON DELETE SET NULL,
    line_no TEXT NOT NULL,
    assigned_date DATE NOT NULL,
    assigned_quantity NUMERIC(12,2) NOT NULL,
    available_minutes NUMERIC(12,2) NOT NULL,
    required_production_rate NUMERIC(12,2) NOT NULL,
    planned_start_date DATE,
    planned_end_date DATE,
    priority INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status VARCHAR(20) NOT NULL DEFAULT 'planned',
    CONSTRAINT chk_assigned_quantity_positive CHECK (assigned_quantity > 0),
    CONSTRAINT chk_assignment_status CHECK (status IN ('planned', 'released', 'completed', 'cancelled'))
  );
`);
console.log("✅ line_assignments table ready in prod_db_schema");

// Add after the line_balancing_assignments table creation

// 8. Create quality_inspections table
await client.query(`
  CREATE TABLE IF NOT EXISTS quality_inspections(
    id BIGSERIAL PRIMARY KEY,
    line_no TEXT NOT NULL,
    style TEXT,
    inspector_name VARCHAR(100) NOT NULL,
    inspection_date DATE NOT NULL DEFAULT CURRENT_DATE,
    shift_slot VARCHAR(50),
    total_defects INT DEFAULT 0,
    total_checked_quantity NUMERIC(12,2) DEFAULT 0,
    bad_type TEXT,
    bad_reason TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`);
// Add bad_type / bad_reason columns to existing databases (no-op if already present)
await client.query("ALTER TABLE quality_inspections ADD COLUMN IF NOT EXISTS bad_type TEXT;");
await client.query("ALTER TABLE quality_inspections ADD COLUMN IF NOT EXISTS bad_reason TEXT;");
await client.query("ALTER TABLE quality_inspections ADD COLUMN IF NOT EXISTS style TEXT;");
console.log("✅ quality_inspections table ready");

// 9. Create quality_defect_types table (master data)
await client.query(`
  CREATE TABLE IF NOT EXISTS quality_defect_types(
    id BIGSERIAL PRIMARY KEY,
    defect_code VARCHAR(20) UNIQUE NOT NULL,
    defect_name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INT DEFAULT 0
  );
`);
console.log("✅ quality_defect_types table ready");

// 10. Create quality_defect_reasons table (master data)
await client.query(`
  CREATE TABLE IF NOT EXISTS quality_defect_reasons(
    id BIGSERIAL PRIMARY KEY,
    defect_type_id BIGINT NOT NULL REFERENCES quality_defect_types(id) ON DELETE CASCADE,
    reason_code VARCHAR(20) NOT NULL,
    reason_description TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INT DEFAULT 0,
    UNIQUE(defect_type_id, reason_code)
  );
`);
console.log("✅ quality_defect_reasons table ready");

// 11. Create quality_defect_entries table (actual defects recorded)
await client.query(`
  CREATE TABLE IF NOT EXISTS quality_defect_entries(
    id BIGSERIAL PRIMARY KEY,
    inspection_id BIGINT NOT NULL REFERENCES quality_inspections(id) ON DELETE CASCADE,
    defect_type_id BIGINT NOT NULL REFERENCES quality_defect_types(id),
    defect_reason_id BIGINT REFERENCES quality_defect_reasons(id),
    defect_quantity INT NOT NULL DEFAULT 1,
    operation_name VARCHAR(100),
    operator_no INT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`);
console.log("✅ quality_defect_entries table ready");

// 12. Create indexes for quality tables
await client.query("CREATE INDEX IF NOT EXISTS idx_quality_inspections_line_date ON quality_inspections(line_no, inspection_date);");
await client.query("CREATE INDEX IF NOT EXISTS idx_quality_inspections_inspector ON quality_inspections(inspector_name);");
await client.query("CREATE INDEX IF NOT EXISTS idx_quality_defect_entries_inspection ON quality_defect_entries(inspection_id);");
await client.query("CREATE INDEX IF NOT EXISTS idx_quality_defect_entries_type ON quality_defect_entries(defect_type_id);");


// Create indexes for faster queries
await client.query("CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);");
await client.query("CREATE INDEX IF NOT EXISTS idx_work_orders_wo_no ON work_orders(work_order_no);");
await client.query("CREATE INDEX IF NOT EXISTS idx_line_assignments_line ON line_assignments(line_no, assigned_date);");
await client.query("CREATE INDEX IF NOT EXISTS idx_line_assignments_work_order ON line_assignments(work_order_id);");



    // Create index for faster queries
    await client.query("CREATE INDEX IF NOT EXISTS idx_capacity_history_operation ON operator_capacity_history(operation_id);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_capacity_history_changed_at ON operator_capacity_history(changed_at);");
    // Create indexes
    await client.query("CREATE INDEX IF NOT EXISTS idx_sewed_run ON operation_sewed_entries(run_id);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_sewed_slot ON operation_sewed_entries(slot_id);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE is_active = TRUE;");
    await client.query("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role, line_number);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_line_runs_line_date ON line_runs (line_no, run_date);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_shift_slots_run ON shift_slots(run_id);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_run_operators_run ON run_operators(run_id);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_operator_ops_run ON operator_operations(run_id);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_operator_ops_operator ON operator_operations(run_operator_id);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_hourly_entries_run ON operation_hourly_entries(run_id);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_hourly_entries_operation ON operation_hourly_entries(operation_id);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_hourly_entries_slot ON operation_hourly_entries(slot_id);");

    console.log("✅ All tables and indexes created successfully in prod_db_schema");

    const initQualityMasterData = async (client) => {
  try {
    console.log("🔄 Initializing quality master data...");
    
    // Defect Types
    const defectTypes = [
      { code: "FD", name: "Fabric Defect", category: "fabric", sort: 1 },
      { code: "WD", name: "Workmanship Defect", category: "workmanship", sort: 2 },
      { code: "SD", name: "Size Defect", category: "size", sort: 3 },
      { code: "TD", name: "Trim Defect", category: "trim", sort: 4 },
      { code: "HTD", name: "Heat Transfer/Pad Print Defect", category: "printing", sort: 5 },
      { code: "LD", name: "Label Defect", category: "label", sort: 6 },
      { code: "CD", name: "Cleaning/External Defect", category: "cleaning", sort: 7 },
      { code: "PD", name: "Packing Defect", category: "packing", sort: 8 }
    ];
    
    for (const dt of defectTypes) {
      await client.query(`
        INSERT INTO quality_defect_types (defect_code, defect_name, category, sort_order)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (defect_code) DO UPDATE SET
          defect_name = EXCLUDED.defect_name,
          category = EXCLUDED.category,
          sort_order = EXCLUDED.sort_order
      `, [dt.code, dt.name, dt.category, dt.sort]);
    }
    
    // Defect Reasons with all detailed reasons from images
    const defectReasons = {
      // 1. Fabric Defect (FD)
      "FD": [
        { code: "FD01", reason: "Thread ends/raw edges" },
        { code: "FD02", reason: "Skip stitches" },
        { code: "FD03", reason: "Needle hole/hole" },
        { code: "FD04", reason: "Start needle/twist" },
        { code: "FD05", reason: "Folding" },
        { code: "FD06", reason: "Burst/pits" },
        { code: "FD07", reason: "Hole in fabric" },
        { code: "FD08", reason: "Stain/mark on fabric" },
        { code: "FD09", reason: "Fabric color variation" },
        { code: "FD10", reason: "Fabric printing misalignment" },
        { code: "FD11", reason: "Thread pulling/running" },
        { code: "FD12", reason: "Wrong fabric composition" },
        { code: "FD13", reason: "Fabric shrinkage" }
      ],
      
      // 2. Workmanship Defect (WD)
      "WD": [
        { code: "WD01", reason: "Stitch length mismatch" },
        { code: "WD02", reason: "Broken threads" },
        { code: "WD03", reason: "Empalme desalineado (Misaligned splice)" },
        { code: "WD04", reason: "Ondulado (Wavy/Curved)" },
        { code: "WD05", reason: "Costura abierta (Open seam)" },
        { code: "WD06", reason: "Margen variado (Varying margin)" },
        { code: "WD07", reason: "Plisado (Pleated/Puckered)" },
        { code: "WD08", reason: "Marcas de aguja (Needle marks)" },
        { code: "WD09", reason: "Corte erroneo (Wrong cut)" },
        { code: "WD10", reason: "Panel incompleto (Incomplete panel)" },
        { code: "WD11", reason: "Uneven stitching" },
        { code: "WD12", reason: "Skipped stitches" },
        { code: "WD13", reason: "Wrong seam allowance" },
        { code: "WD14", reason: "Misaligned panels" },
        { code: "WD15", reason: "Loose threads" },
        { code: "WD16", reason: "Puckering" },
        { code: "WD17", reason: "Tilted stitching" },
        { code: "WD18", reason: "Stitching not on the same line" },
        { code: "WD19", reason: "Exceso de material (Excess material)" },
        { code: "WD20", reason: "Poor stitching quality" }
      ],
      
      // 3. Size Defect (SD)
      "SD": [
        { code: "SD01", reason: "Oversize (Too large)" },
        { code: "SD02", reason: "Undersize (Too small)" },
        { code: "SD03", reason: "Wrong size" },
        { code: "SD04", reason: "Length discrepancy" },
        { code: "SD05", reason: "Width discrepancy" },
        { code: "SD06", reason: "Inconsistent sizing" }
      ],
      
      // 4. Trim Defect (TD)
      "TD": [
        { code: "TD01", reason: "Missing trim" },
        { code: "TD02", reason: "Damaged trim" },
        { code: "TD03", reason: "Wrong trim color" },
        { code: "TD04", reason: "Trim not properly attached" },
        { code: "TD05", reason: "Zipper defect" },
        { code: "TD06", reason: "Button defect/missing" },
        { code: "TD07", reason: "Elastic defect" },
        { code: "TD08", reason: "Broken zipper teeth" },
        { code: "TD09", reason: "Zipper not sliding properly" },
        { code: "TD10", reason: "Missing button" }
      ],
      
      // 5. Heat Transfer/Pad Print Defect (HTD)
      "HTD": [
        { code: "HT01", reason: "Faded print" },
        { code: "HT02", reason: "Misaligned print" },
        { code: "HT03", reason: "Missing print" },
        { code: "HT04", reason: "Smudged print" },
        { code: "HT05", reason: "Wrong color print" },
        { code: "HT06", reason: "Peeling/cracking" },
        { code: "HT07", reason: "Print bleeding" },
        { code: "HT08", reason: "Incomplete transfer" },
        { code: "HT09", reason: "Wrong position" }
      ],
      
      // 6. Label Defect (LD)
      "LD": [
        { code: "LD01", reason: "Missed care label/ID label" },
        { code: "LD02", reason: "Reversed labels/wrong order" },
        { code: "LD03", reason: "Missed waist tag/hangtag, insert tag" },
        { code: "LD04", reason: "Damaged/defective label" },
        { code: "LD05", reason: "Wrong style number" },
        { code: "LD06", reason: "Wrong color code" },
        { code: "LD07", reason: "Wrong item code/composition" },
        { code: "LD08", reason: "Wrong size" },
        { code: "LD09", reason: "Misaligned label" },
        { code: "LD10", reason: "Wrong label position" },
        { code: "LD11", reason: "Label illegible" },
        { code: "LD12", reason: "Wrong country" },
        { code: "LD13", reason: "Wrong brand label" }
      ],
      
      // 7. Cleaning/External Defect (CD)
      "CD": [
        { code: "CD01", reason: "Dirty" },
        { code: "CD02", reason: "Oil stains" },
        { code: "CD03", reason: "Migration (Color bleeding)" },
        { code: "CD04", reason: "Whitening/marks from ironing" },
        { code: "CD05", reason: "Poor stitching" },
        { code: "CD06", reason: "Uneven stitching" },
        { code: "CD07", reason: "Tilted stitching" },
        { code: "CD08", reason: "Stitching not on the same line" },
        { code: "CD09", reason: "Exceso de material (Excess material)" },
        { code: "CD10", reason: "Manchas de corte (Cutting marks/stains)" },
        { code: "CD11", reason: "Dust/dirt on garment" },
        { code: "CD12", reason: "Foreign material embedded" },
        { code: "CD13", reason: "Pen marks" },
        { code: "CD14", reason: "Excess chalk marks" },
        { code: "CD15", reason: "Rust marks" },
        { code: "CD16", reason: "Chemical stains" }
      ],
      
      // 8. Packing Defect (PD)
      "PD": [
        { code: "PD01", reason: "Wrong country" },
        { code: "PD02", reason: "Wrong color" },
        { code: "PD03", reason: "Wrong size" },
        { code: "PD04", reason: "Wrong style" },
        { code: "PD05", reason: "Inconsistent packaging method" },
        { code: "PD06", reason: "Wrong size of packaging bag" },
        { code: "PD07", reason: "Folded on logo" },
        { code: "PD08", reason: "Cantidad incorrecta (Incorrect quantity)" },
        { code: "PD09", reason: "Wrong folding" },
        { code: "PD10", reason: "Damaged packaging" },
        { code: "PD11", reason: "Missing polybag" },
        { code: "PD12", reason: "Wrong carton mark" },
        { code: "PD13", reason: "Wrong hanger" },
        { code: "PD14", reason: "Missing accessories" },
        { code: "PD15", reason: "Wrong polybag size" },
        { code: "PD16", reason: "Damaged carton box" }
      ]
    };
    
    // Get all defect types
    const typesResult = await client.query(`
      SELECT id, defect_code FROM quality_defect_types
    `);
    
    const typeMap = new Map();
    typesResult.rows.forEach(row => {
      typeMap.set(row.defect_code, row.id);
    });
    
    // Insert/Update reasons
    for (const [defectCode, reasons] of Object.entries(defectReasons)) {
      const defectTypeId = typeMap.get(defectCode);
      if (defectTypeId) {
        for (let i = 0; i < reasons.length; i++) {
          const reason = reasons[i];
          await client.query(`
            INSERT INTO quality_defect_reasons (defect_type_id, reason_code, reason_description, sort_order)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (defect_type_id, reason_code) DO UPDATE SET
              reason_description = EXCLUDED.reason_description,
              sort_order = EXCLUDED.sort_order
          `, [defectTypeId, reason.code, reason.reason, i + 1]);
        }
      }
    }
    
    console.log("✅ Quality master data initialized with all defect reasons");
  } catch (err) {
    console.error("❌ Error initializing quality master data:", err.message);
  }
};
// Call this after createAllTables
await initQualityMasterData(client);

    // Create default users if they don't exist
    await createDefaultUsers(client);
  } catch (err) {
    console.error("❌ Error creating tables:", err.message);
    throw err;
  } finally {
    client.release();
  }
};

// Insert default defect types and reasons


// Function to create default users
const createDefaultUsers = async (client) => {
  try {
    console.log("🔄 Creating default users in prod_db_schema...");

    const defaultUsers = [
      {
        username: "engineer",
        password: "engineer",
        role: "engineer",
        full_name: "System Engineer",
      },
    ];

    // Add line leaders 1-26
    for (let i = 1; i <= 26; i++) {
      defaultUsers.push({
        username: `line${i}`,
        password: `line${i}`,
        role: "line_leader",
        line_number: i,
        full_name: `Line ${i} Leader`,
      });
    }

    // Add soporte_it user
defaultUsers.push({
  username: "soporte_it",
  password: "soporte123",
  role: "soporte_it",
  full_name: "Soporte IT",
});

// Add skyrina user with password skyrina26
    defaultUsers.push({
      username: "skyrina",
      password: "skyrina26",
      role: "skyrina",
      full_name: "Skyrina Dashboard User",
    });
// Add this after the skyrina user:
defaultUsers.push({
  username: "planner",
  password: "planner123",
  role: "planner",
  full_name: "Production Planner",
});
    // Add a supervisor
    defaultUsers.push({
      username: "supervisor",
      password: "supervisor123",
      role: "supervisor",
      full_name: "Production Supervisor",
    });

    // In createDefaultUsers function, add:
defaultUsers.push({
  username: "quality_inspector",
  password: "quality123",
  role: "quality_inspector",
  full_name: "Quality Inspector",
});

// In the role validation, update validRoles:

    defaultUsers.push({
  username: "Salvador",
  password: "Cassab",
  role: "master",  // or 'engineer', 'supervisor', 'planner' depending on what access you want
  full_name: "Salvador Cassab",
});

    let createdCount = 0;
    let updatedCount = 0;

    for (const user of defaultUsers) {
      // Check if user exists
      const existingUser = await client.query("SELECT id FROM users WHERE username = $1", [user.username]);

      if (existingUser.rows.length === 0) {
        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(user.password, saltRounds);

        // Insert new user
        await client.query(
          `
          INSERT INTO users (username, password_hash, role, line_number, full_name, is_active)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
          [user.username, passwordHash, user.role, user.line_number || null, user.full_name || user.username, true]
        );
        createdCount++;
        console.log(`✅ Created user: ${user.username} (${user.role})`);
      } else {
        // Update existing user's password if needed
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(user.password, saltRounds);

        await client.query(
          `
          UPDATE users 
          SET password_hash = $1, updated_at = NOW()
          WHERE username = $2
        `,
          [passwordHash, user.username]
        );
        updatedCount++;
        console.log(`✅ Updated user: ${user.username}`);
      }
    }

    console.log(`✅ Users ready: ${createdCount} created, ${updatedCount} updated`);
  } catch (err) {
    console.error("❌ Error creating default users:", err.message);
  }
};

// ✅ Login endpoint
app.post("/api/login", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Username and password are required",
      });
    }

    // Find user
    const userResult = await client.query(
      `
      SELECT id, username, password_hash, role, line_number, full_name, is_active
      FROM users 
      WHERE username = $1 AND is_active = TRUE
    `,
      [username]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: "Invalid username or password",
      });
    }

    const user = userResult.rows[0];

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: "Invalid username or password",
      });
    }

    // Remove password hash from response
    delete user.password_hash;

    // Generate a simple token (in production, use JWT)
    const token = Buffer.from(`${user.id}:${Date.now()}`).toString("base64");

    res.json({
      success: true,
      message: "Login successful",
      user: user,
      token: token,
    });
  } catch (err) {
    console.error("❌ Login error:", err.message);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  } finally {
    client.release();
  }
});

// ✅ Middleware to verify authentication
const authenticateToken = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    // Simple token validation
    const decoded = Buffer.from(token, "base64").toString("ascii");
    const [userId, timestamp] = decoded.split(":");

    // Check if token is not too old (24 hours)
    const tokenAge = Date.now() - parseInt(timestamp);
    const MAX_TOKEN_AGE = 24 * 60 * 60 * 1000; // 24 hours

    if (tokenAge > MAX_TOKEN_AGE) {
      return res.status(401).json({
        success: false,
        error: "Session expired",
      });
    }

    // Verify user exists and is active
    const userResult = await client.query(
      `
      SELECT id, username, role, line_number, full_name
      FROM users 
      WHERE id = $1 AND is_active = TRUE
    `,
      [parseInt(userId)]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: "User not found or inactive",
      });
    }

    req.user = userResult.rows[0];
    next();
  } catch (err) {
    console.error("❌ Authentication error:", err.message);
    res.status(401).json({
      success: false,
      error: "Invalid authentication token",
    });
  } finally {
    client.release();
  }
};

// ✅ Get current user info
app.get("/api/me", authenticateToken, async (req, res) => {
  res.json({
    success: true,
    user: req.user,
  });
});

// ✅ Logout endpoint
app.post("/api/logout", (req, res) => {
  res.json({
    success: true,
    message: "Logged out successfully",
  });
});

// ✅ Save line inputs and shift slots together (Step 1)
app.post("/api/save-production", async (req, res) => {
  const client = await pool.connect();

  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { line, date, style, operators, workingHours, sam, efficiency, target, targetPerHour, slots } = req.body;

    // Validate required fields
    if (!line || !date || !style || !operators || !workingHours || !sam) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
      });
    }

    // Insert into line_runs table
    const lineRunQuery = `
      INSERT INTO line_runs (
        line_no, 
        run_date, 
        style, 
        operators_count, 
        working_hours, 
        sam_minutes, 
        efficiency, 
        target_pcs,
        target_per_hour,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING id;
    `;

    const lineRunResult = await client.query(lineRunQuery, [
      line,
      date,
      style,
      parseInt(operators) || 0,
      parseFloat(workingHours),
      parseFloat(sam),
      parseFloat(efficiency) || 0.7,
      parseFloat(target) || 0,
      parseFloat(targetPerHour) || 0,
    ]);

    const runId = lineRunResult.rows[0].id;
    console.log(`✅ Line run saved with ID: ${runId} in prod_db_schema`);

    // Insert shift slots
    const slotIds = {};
    if (slots && slots.length > 0) {
      const slotQuery = `
        INSERT INTO shift_slots (
          run_id,
          slot_order,
          slot_label,
          slot_start,
          slot_end,
          planned_hours
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, slot_label;
      `;

      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const slotResult = await client.query(slotQuery, [
          runId,
          i + 1,
          slot.label,
          slot.startTime || null,
          slot.endTime || null,
          parseFloat(slot.hours) || 0,
        ]);

        slotIds[slot.label] = slotResult.rows[0].id;
      }
      console.log(`✅ ${slots.length} shift slots saved for line run ${runId}`);
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Production data saved successfully in prod_db_schema",
      lineRunId: runId,
      slotIds,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error saving production data:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Save operators and operations (Step 2)
app.post("/api/save-operations", async (req, res) => {
  const client = await pool.connect();

  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId, operations, slotTargets, cumulativeTargets } = req.body;

    if (!runId || !operations || !Array.isArray(operations)) {
      return res.status(400).json({
        success: false,
        error: "Missing required data",
      });
    }

    // Verify run exists
    const runCheck = await client.query("SELECT id FROM line_runs WHERE id = $1", [runId]);

    if (runCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Line run not found",
      });
    }

    // Get slot IDs for this run
    const slotsResult = await client.query(
      "SELECT id, slot_label FROM shift_slots WHERE run_id = $1 ORDER BY slot_order",
      [runId]
    );

    const slotMap = {};
    slotsResult.rows.forEach((slot) => {
      slotMap[slot.slot_label] = slot.id;
    });

    // Process each operation row
    const operatorMap = {};
    let savedOperations = 0;

    for (const operation of operations) {
      const { operatorNo, operatorName, operation: operationName, t1, t2, t3, t4, t5, capacityPerHour } = operation;

      // Skip if no operator number
      if (!operatorNo) {
        console.log("⚠️ Skipping operation without operator number");
        continue;
      }

      const opNo = parseInt(operatorNo);

      try {
        // Insert or get existing operator
        if (!operatorMap[opNo]) {
          const operatorQuery = `
            INSERT INTO run_operators (run_id, operator_no, operator_name, created_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (run_id, operator_no) 
            DO UPDATE SET operator_name = EXCLUDED.operator_name
            RETURNING id;
          `;

          const operatorResult = await client.query(operatorQuery, [runId, opNo, operatorName || null]);

          operatorMap[opNo] = operatorResult.rows[0].id;
          console.log(`✅ Operator ${opNo} saved/updated: ID ${operatorMap[opNo]}`);
        }

        // Insert operation
        const operationQuery = `
          INSERT INTO operator_operations (
            run_id,
            run_operator_id,
            operation_name,
            t1_sec,
            t2_sec,
            t3_sec,
            t4_sec,
            t5_sec,
            capacity_per_hour,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
          ON CONFLICT (run_operator_id, operation_name)
          DO UPDATE SET 
            t1_sec = EXCLUDED.t1_sec,
            t2_sec = EXCLUDED.t2_sec,
            t3_sec = EXCLUDED.t3_sec,
            t4_sec = EXCLUDED.t4_sec,
            t5_sec = EXCLUDED.t5_sec,
            capacity_per_hour = EXCLUDED.capacity_per_hour
          RETURNING id;
        `;

        const opResult = await client.query(operationQuery, [
          runId,
          operatorMap[opNo],
          operationName || "Unnamed Operation",
          t1 ? parseFloat(t1) : null,
          t2 ? parseFloat(t2) : null,
          t3 ? parseFloat(t3) : null,
          t4 ? parseFloat(t4) : null,
          t5 ? parseFloat(t5) : null,
          capacityPerHour || 0,
        ]);

        savedOperations++;
        console.log(`✅ Operation "${operationName || "Unnamed"}" saved for operator ${opNo}: ID ${opResult.rows[0].id}`);
      } catch (opErr) {
        console.error(`❌ Error saving operation for operator ${opNo}:`, opErr.message);
        continue;
      }
    }

    // Save slot targets (hourly plan targets)
    if (slotTargets && cumulativeTargets && slotsResult.rows.length > 0) {
      let savedTargets = 0;
      for (let i = 0; i < slotsResult.rows.length; i++) {
        const slot = slotsResult.rows[i];
        const slotTarget = slotTargets[i] || 0;
        const cumulativeTarget = cumulativeTargets[i] || 0;

        const slotTargetQuery = `
          INSERT INTO slot_targets (run_id, slot_id, slot_target, cumulative_target, created_at, updated_at)
          VALUES ($1, $2, $3, $4, NOW(), NOW())
          ON CONFLICT (run_id, slot_id)
          DO UPDATE SET 
            slot_target = EXCLUDED.slot_target,
            cumulative_target = EXCLUDED.cumulative_target,
            updated_at = NOW();
        `;

        await client.query(slotTargetQuery, [runId, slot.id, parseFloat(slotTarget), parseFloat(cumulativeTarget)]);
        savedTargets++;
      }
      console.log(`✅ ${savedTargets} slot targets saved for run ${runId}`);
    }

    await client.query("COMMIT");

    console.log(`✅ Operations saved for run ${runId}: ${savedOperations} operations`);

    res.json({
      success: true,
      message: "Operations data saved successfully",
      operationsCount: savedOperations,
      operatorCount: Object.keys(operatorMap).length,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error saving operations data:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ User management endpoints (for engineers/supervisors only)
const requireEngineerOrSupervisor = (req, res, next) => {
  if (req.user.role !== "engineer" && req.user.role !== "supervisor" 
    && req.user.role !== "soporte_it" && req.user.role !== "skyrina" && req.user.role !== "planner"
    && req.user.role !== "master" && req.user.role !== "quality_inspector"
  ) {
    return res.status(403).json({
      success: false,
      error: "Access denied. Engineer or supervisor role required.",
    });
  }
  next();
};

// Get all users
app.get("/api/users", authenticateToken, requireEngineerOrSupervisor, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const result = await client.query(`
      SELECT id, username, role, line_number, full_name, is_active, created_at, updated_at
      FROM users
      ORDER BY 
        CASE role 
          WHEN 'engineer' THEN 1
          WHEN 'supervisor' THEN 2
          WHEN 'line_leader' THEN 3
          WHEN 'soporte_it' THEN 4
          WHEN 'skyrina' THEN 5
          WHEN 'quality_inspector' THEN 6
          ELSE 7
        END,
        line_number NULLS FIRST,
        username
    `);

    res.json({
      success: true,
      users: result.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching users:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// Create new users
app.post("/api/users", authenticateToken, requireEngineerOrSupervisor, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { username, password, role, line_number, full_name } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({
        success: false,
        error: "Username, password, and role are required",
      });
    }

    // Validate role
    const validRoles = ["engineer", "line_leader", "supervisor", "soporte_it", "skyrina", "planner", "master", "quality_inspector"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: "Invalid role. Must be 'engineer', 'line_leader', 'supervisor', 'soporte_it', 'skyrina', 'planner', 'master', or 'quality_inspector'",
      });
    }

    // Validate line_number for line leaders
    if (role === "line_leader") {
      if (!line_number || line_number < 1 || line_number > 26) {
        return res.status(400).json({
          success: false,
          error: "Line leaders must have a line number between 1 and 26",
        });
      }

      // Check if line number is already assigned
      const existingLineUser = await client.query(
        `
        SELECT username FROM users 
        WHERE role = 'line_leader' AND line_number = $1 AND is_active = TRUE
      `,
        [line_number]
      );

      if (existingLineUser.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Line ${line_number} is already assigned to user: ${existingLineUser.rows[0].username}`,
        });
      }
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const result = await client.query(
      `
      INSERT INTO users (username, password_hash, role, line_number, full_name, is_active)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, username, role, line_number, full_name, is_active, created_at
    `,
      [username, passwordHash, role, line_number || null, full_name || username, true]
    );

    res.json({
      success: true,
      message: "User created successfully",
      user: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Error creating user:", err.message);

    if (err.code === "23505") {
      // Unique violation
      res.status(400).json({
        success: false,
        error: "Username already exists",
      });
    } else {
      res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  } finally {
    client.release();
  }
});

// Update user
app.put("/api/users/:id", authenticateToken, requireEngineerOrSupervisor, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { id } = req.params;
    const { username, password, role, line_number, full_name, is_active } = req.body;

    // Build update query dynamically
    const updates = [];
    const values = [];
    let valueIndex = 1;

    if (username !== undefined) {
      updates.push(`username = $${valueIndex++}`);
      values.push(username);
    }

    if (password !== undefined) {
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(password, saltRounds);
      updates.push(`password_hash = $${valueIndex++}`);
      values.push(passwordHash);
    }

    if (role !== undefined) {
      updates.push(`role = $${valueIndex++}`);
      values.push(role);
    }

    if (line_number !== undefined) {
      updates.push(`line_number = $${valueIndex++}`);
      values.push(line_number);
    }

    if (full_name !== undefined) {
      updates.push(`full_name = $${valueIndex++}`);
      values.push(full_name);
    }

    if (is_active !== undefined) {
      updates.push(`is_active = $${valueIndex++}`);
      values.push(is_active);
    }

    updates.push(`updated_at = NOW()`);

    if (updates.length === 1) {
      // Only updated_at was added
      return res.status(400).json({
        success: false,
        error: "No fields to update",
      });
    }

    values.push(id);

    const query = `
      UPDATE users 
      SET ${updates.join(", ")}
      WHERE id = $${valueIndex}
      RETURNING id, username, role, line_number, full_name, is_active, created_at, updated_at
    `;

    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    res.json({
      success: true,
      message: "User updated successfully",
      user: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Error updating user:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// Delete user (soft delete)
app.delete("/api/users/:id", authenticateToken, requireEngineerOrSupervisor, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { id } = req.params;

    // Prevent deleting yourself
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        error: "Cannot delete your own account",
      });
    }

    const result = await client.query(
      `
      UPDATE users 
      SET is_active = FALSE, updated_at = NOW()
      WHERE id = $1 AND is_active = TRUE
      RETURNING id, username
    `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found or already inactive",
      });
    }

    res.json({
      success: true,
      message: "User deactivated successfully",
    });
  } catch (err) {
    console.error("❌ Error deleting user:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});


/**
 * lines with multiple runs endpoint
 */

/**
 * POST /api/multi-style/create-group
 * Create a style group with multiple styles for the same line and date
 */
app.post("/api/multi-style/create-group", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { line, date, styles } = req.body;

    if (!line || !date || !styles || !Array.isArray(styles) || styles.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: line, date, and at least one style",
      });
    }

    // Create the first style as the "parent" run
    const firstStyle = styles[0];
    const parentResult = await client.query(
      `INSERT INTO line_runs (
        line_no, run_date, style, operators_count, working_hours,
        sam_minutes, efficiency, target_pcs, target_per_hour,
        created_at, updated_at, style_group_name
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW(), $10)
      RETURNING id`,
      [
        line,
        date,
        firstStyle.styleCode,
        firstStyle.operatorsCount,
        firstStyle.workingHours,
        firstStyle.sam,
        firstStyle.efficiency || 0.7,
        firstStyle.targetPcs,
        firstStyle.targetPerHour,
        `Group_${line}_${date}_${firstStyle.styleCode}`
      ]
    );

    const groupId = parentResult.rows[0].id;
    const savedStyles = [{ id: groupId, style_code: firstStyle.styleCode }];

    // Create additional styles as child runs linked to the parent
    for (let i = 1; i < styles.length; i++) {
      const style = styles[i];
      const childResult = await client.query(
        `INSERT INTO line_runs (
          line_no, run_date, style, operators_count, working_hours,
          sam_minutes, efficiency, target_pcs, target_per_hour,
          style_group_id, style_group_name, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
        RETURNING id`,
        [
          line,
          date,
          style.styleCode,
          style.operatorsCount,
          style.workingHours,
          style.sam,
          style.efficiency || 0.7,
          style.targetPcs,
          style.targetPerHour,
          groupId,
          `Group_${line}_${date}_${firstStyle.styleCode}`
        ]
      );

      savedStyles.push({ id: childResult.rows[0].id, style_code: style.styleCode });
    }

    // Save slots for each style
    for (let i = 0; i < styles.length; i++) {
      const style = styles[i];
      const runId = savedStyles[i].id;

      if (style.slots && style.slots.length > 0) {
        for (let j = 0; j < style.slots.length; j++) {
          const slot = style.slots[j];
          await client.query(
            `INSERT INTO shift_slots (
              run_id, slot_order, slot_label, slot_start, slot_end, planned_hours
            )
            VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              runId,
              j + 1,
              slot.label,
              slot.startTime || null,
              slot.endTime || null,
              parseFloat(slot.hours) || 0,
            ]
          );
        }
      }
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Style group created successfully",
      groupId,
      styles: savedStyles,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error creating style group:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

/**
 * GET /api/multi-style/group-runs?line=8&date=2024-03-27
 * Get all styles for a line on a specific date
 */
app.get("/api/multi-style/group-runs", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { line, date } = req.query;
    if (!line || !date) {
      return res.status(400).json({
        success: false,
        error: "line and date parameters are required",
      });
    }

    // Find runs on this line and date
    const runs = await client.query(
      `SELECT * FROM line_runs
       WHERE line_no = $1 AND run_date = $2
       ORDER BY style_group_id NULLS FIRST, id`,
      [line, date]
    );

    if (runs.rows.length === 0) {
      return res.json({
        success: false,
        error: `No runs found for line ${line} on ${date}`,
      });
    }

    // Group by style_group_id
    const grouped = {};
    for (const run of runs.rows) {
      const groupKey = run.style_group_id || run.id;
      if (!grouped[groupKey]) {
        grouped[groupKey] = {
          groupId: groupKey,
          groupName: run.style_group_name || run.style,
          line_no: run.line_no,
          run_date: run.run_date,
          styles: [],
        };
      }
      
      // Get slots for this run
      const slots = await client.query(
        `SELECT * FROM shift_slots
         WHERE run_id = $1
         ORDER BY slot_order`,
        [run.id]
      );
      
      grouped[groupKey].styles.push({
        ...run,
        slots: slots.rows,
      });
    }

    res.json({
      success: true,
      groups: Object.values(grouped),
    });
  } catch (err) {
    console.error("❌ Error fetching style groups:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

/**
 * GET /api/multi-style/latest-group?line=8
 * Get the latest style group for a line
 */
app.get("/api/multi-style/latest-group", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const line = String(req.query.line || "").trim();
    if (!line) {
      return res.status(400).json({ success: false, error: "line is required" });
    }

    // Get the latest run date for this line
    const latestDate = await client.query(
      `SELECT DISTINCT run_date FROM line_runs
       WHERE line_no = $1
       ORDER BY run_date DESC
       LIMIT 1`,
      [line]
    );

    if (latestDate.rows.length === 0) {
      return res.json({
        success: false,
        error: `No runs found for line ${line}`,
      });
    }

    const date = latestDate.rows[0].run_date;

    // Now get all runs for that date
    const runs = await client.query(
      `SELECT * FROM line_runs
       WHERE line_no = $1 AND run_date = $2
       ORDER BY style_group_id NULLS FIRST, id`,
      [line, date]
    );

    // Group by style_group_id
    const styles = [];
    for (const run of runs.rows) {
      // Get slots
      const slots = await client.query(
        `SELECT * FROM shift_slots
         WHERE run_id = $1
         ORDER BY slot_order`,
        [run.id]
      );
      
      // Get operators
      const operators = await client.query(
        `SELECT * FROM run_operators
         WHERE run_id = $1
         ORDER BY operator_no`,
        [run.id]
      );
      
      // Get slot targets
      const slotTargets = await client.query(
        `SELECT s.slot_label, t.slot_target, t.cumulative_target
         FROM slot_targets t
         JOIN shift_slots s ON t.slot_id = s.id
         WHERE t.run_id = $1
         ORDER BY s.slot_order`,
        [run.id]
      );
      
      styles.push({
        run,
        slots: slots.rows,
        operators: operators.rows,
        slotTargets: slotTargets.rows,
      });
    }

    res.json({
      success: true,
      date,
      styles,
    });
  } catch (err) {
    console.error("❌ Error fetching latest style group:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});


// ✅ Save hourly stitched data separately
app.post("/api/save-hourly-data", async (req, res) => {
  const client = await pool.connect();

  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { entries } = req.body;

    if (!entries || !Array.isArray(entries)) {
      return res.status(400).json({
        success: false,
        error: "Missing hourly data entries",
      });
    }

    let savedCount = 0;
    let skippedCount = 0;

    for (const entry of entries) {
      const { runId, operatorNo, operationName, slotLabel, stitchedQty } = entry;

      if (!runId || !operatorNo || !operationName || !slotLabel) {
        skippedCount++;
        continue;
      }

      try {
        // Get operator and operation IDs
        const opResult = await client.query(
          `
          SELECT o.id as op_id, ro.id as operator_id
          FROM operator_operations o
          JOIN run_operators ro ON o.run_operator_id = ro.id
          WHERE o.run_id = $1 
            AND ro.operator_no = $2 
            AND o.operation_name = $3
          LIMIT 1
        `,
          [runId, parseInt(operatorNo), operationName]
        );

        let operationId;

        if (opResult.rows.length === 0) {
          console.warn(`⚠️ Operation not found: ${operatorNo} - ${operationName}. Creating it now...`);

          // Try to create the operation if it doesn't exist
          const createOpResult = await client.query(
            `
            WITH new_operator AS (
              INSERT INTO run_operators (run_id, operator_no, operator_name, created_at)
              VALUES ($1, $2, $3, NOW())
              ON CONFLICT (run_id, operator_no) 
              DO UPDATE SET operator_name = EXCLUDED.operator_name
              RETURNING id
            )
            INSERT INTO operator_operations (
              run_id,
              run_operator_id,
              operation_name,
              capacity_per_hour,
              created_at
            )
            SELECT $1, id, $4, 0, NOW()
            FROM new_operator
            RETURNING id;
          `,
            [runId, parseInt(operatorNo), `Operator ${operatorNo}`, operationName]
          );

          if (createOpResult.rows.length === 0) {
            console.warn(`❌ Failed to create operation: ${operatorNo} - ${operationName}`);
            skippedCount++;
            continue;
          }

          operationId = createOpResult.rows[0].id;
          console.log(`✅ Created missing operation: ${operatorNo} - ${operationName} (ID: ${operationId})`);
        } else {
          operationId = opResult.rows[0].op_id;
        }

        // Get slot ID
        const slotResult = await client.query("SELECT id FROM shift_slots WHERE run_id = $1 AND slot_label = $2", [
          runId,
          slotLabel,
        ]);

        if (slotResult.rows.length === 0) {
          console.warn(`⚠️ Slot not found: ${slotLabel} for run ${runId}`);
          skippedCount++;
          continue;
        }

        const slotId = slotResult.rows[0].id;

        // Save hourly entry
        const hourlyQuery = `
          INSERT INTO operation_hourly_entries (
            run_id,
            operation_id,
            slot_id,
            stitched_qty,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, NOW(), NOW())
          ON CONFLICT (operation_id, slot_id)
          DO UPDATE SET 
            stitched_qty = EXCLUDED.stitched_qty,
            updated_at = NOW();
        `;

        await client.query(hourlyQuery, [runId, operationId, slotId, parseFloat(stitchedQty) || 0]);

        savedCount++;
      } catch (entryErr) {
        console.error(`❌ Error saving hourly entry for ${operatorNo}-${operationName}:`, entryErr.message);
        skippedCount++;
      }
    }

    await client.query("COMMIT");

    console.log(`✅ Hourly data saved: ${savedCount} entries, ${skippedCount} skipped`);

    res.json({
      success: true,
      message: "Hourly data saved",
      savedCount,
      skippedCount,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error saving hourly data:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Line leader update sewed entries
app.post("/api/lineleader/update-sewed/:runId", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId } = req.params;
    const { entries } = req.body;

    if (!entries || !Array.isArray(entries)) {
      return res.status(400).json({
        success: false,
        error: "Missing entries array",
      });
    }

    let updatedCount = 0;

    for (const entry of entries) {
      const { operatorNo, operationName, slotLabel, sewedQty } = entry;

      if (!operatorNo || !operationName || !slotLabel) continue;

      // 1) find operation id
      const opResult = await client.query(
        `
        SELECT o.id as op_id
        FROM operator_operations o
        JOIN run_operators ro ON o.run_operator_id = ro.id
        WHERE o.run_id = $1
          AND ro.operator_no = $2
          AND o.operation_name = $3
        LIMIT 1
        `,
        [runId, parseInt(operatorNo), operationName]
      );

      if (opResult.rows.length === 0) continue;
      const operationId = opResult.rows[0].op_id;

      // 2) find slot id
      const slotResult = await client.query(`SELECT id FROM shift_slots WHERE run_id = $1 AND slot_label = $2 LIMIT 1`, [
        runId,
        slotLabel,
      ]);

      if (slotResult.rows.length === 0) continue;
      const slotId = slotResult.rows[0].id;

      // 3) upsert into operation_sewed_entries
      await client.query(
        `
        INSERT INTO operation_sewed_entries (run_id, operation_id, slot_id, sewed_qty, created_at, updated_at)
        VALUES ($1, $2, $3, $4, now(), now())
        ON CONFLICT (operation_id, slot_id)
        DO UPDATE SET sewed_qty = EXCLUDED.sewed_qty, updated_at = now()
        `,
        [runId, operationId, slotId, Number(sewedQty || 0)]
      );

      updatedCount++;
    }

    await client.query("COMMIT");
    return res.json({ success: true, updatedCount });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("❌ update-sewed error:", e);
    return res.status(500).json({ success: false, error: e.message });
  } finally {
    client.release();
  }
});

// ✅ Get saved data for a run
app.get("/api/get-run-data/:runId", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { runId } = req.params;

    // 1) Get line run data
    const runResult = await client.query("SELECT * FROM line_runs WHERE id = $1", [runId]);

    if (runResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Run not found",
      });
    }

    const runData = runResult.rows[0];

    // 2) Get shift slots
    const slotsResult = await client.query(
      `SELECT id, slot_order, slot_label, slot_start, slot_end, planned_hours
       FROM shift_slots
       WHERE run_id = $1
       ORDER BY slot_order`,
      [runId]
    );

    // 3) Get operators
    const operatorsResult = await client.query(
      `SELECT id, operator_no, operator_name
       FROM run_operators
       WHERE run_id = $1
       ORDER BY operator_no`,
      [runId]
    );

    // 4) Get slot targets
    const slotTargetsResult = await client.query(
      `SELECT s.slot_label, t.slot_target, t.cumulative_target
       FROM slot_targets t
       JOIN shift_slots s ON t.slot_id = s.id
       WHERE t.run_id = $1
       ORDER BY s.slot_order`,
      [runId]
    );

    // 5) Get operations with stitched_data + sewed_data
    const operationsData = [];

    for (const operator of operatorsResult.rows) {
      const operationsResult = await client.query(
        `SELECT 
          o.id,
          o.operation_name,
          o.t1_sec,
          o.t2_sec,
          o.t3_sec,
          o.t4_sec,
          o.t5_sec,
          o.capacity_per_hour,

          json_object_agg(
            COALESCE(s.slot_label, ''),
            COALESCE(h.stitched_qty, 0)
          ) FILTER (WHERE s.slot_label IS NOT NULL) as stitched_data,

          json_object_agg(
            COALESCE(s2.slot_label, ''),
            COALESCE(se.sewed_qty, 0)
          ) FILTER (WHERE s2.slot_label IS NOT NULL) as sewed_data

         FROM operator_operations o

         LEFT JOIN operation_hourly_entries h ON o.id = h.operation_id
         LEFT JOIN shift_slots s ON h.slot_id = s.id

         LEFT JOIN operation_sewed_entries se ON o.id = se.operation_id
         LEFT JOIN shift_slots s2 ON se.slot_id = s2.id

         WHERE o.run_operator_id = $1 AND o.run_id = $2
         GROUP BY o.id
         ORDER BY o.id`,
        [operator.id, runId]
      );

      operationsData.push({
        operator,
        operations: operationsResult.rows,
      });
    }

    return res.json({
      success: true,
      run: runData,
      slots: slotsResult.rows,
      operators: operatorsResult.rows,
      operations: operationsData,
      slotTargets: slotTargetsResult.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching run data:", err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Get all saved line runs (for dropdown)
app.get("/api/line-runs", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const result = await client.query(`
      SELECT 
        id,
        line_no,
        run_date,
        style,
        operators_count,
        working_hours,
        sam_minutes,
        efficiency,
        target_pcs,
        target_per_hour,
        created_at
      FROM line_runs
      ORDER BY run_date DESC, line_no
    `);

    res.json({
      success: true,
      runs: result.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching line runs:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Get line runs by line number
app.get("/api/line-runs/:lineNo", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { lineNo } = req.params;

    const result = await client.query(
      `
      SELECT 
        id,
        line_no,
        run_date,
        style,
        operators_count,
        working_hours,
        sam_minutes,
        efficiency,
        target_pcs,
        target_per_hour,
        created_at
      FROM line_runs
      WHERE line_no = $1
      ORDER BY run_date DESC
    `,
      [lineNo]
    );

    res.json({
      success: true,
      runs: result.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching line runs by line:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Get line leader latest run
app.get("/api/lineleader/latest-run", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const line = String(req.query.line || "").trim();
    if (!line) return res.json({ success: false, error: "line is required" });

    // ✅ latest run for that line
    const runQ = await client.query(
      `
      SELECT *
      FROM line_runs
      WHERE line_no = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [line]
    );

    if (runQ.rowCount === 0) {
      return res.json({ success: false, error: `No runs found for line ${line}` });
    }

    const run = runQ.rows[0];

    // ✅ slots for that run
    const slotsQ = await client.query(
      `
      SELECT *
      FROM shift_slots
      WHERE run_id = $1
      ORDER BY slot_order ASC
      `,
      [run.id]
    );

    return res.json({
      success: true,
      run,
      slots: slotsQ.rows,
    });
  } catch (e) {
    console.error("❌ /api/lineleader/latest-run error:", e);
    return res.status(500).json({ success: false, error: e.message });
  } finally {
    client.release();
  }
});

// ✅ Get complete run data for editing
// In server.js, update the /api/run/:runId endpoint to include sewed_data

app.get("/api/run/:runId", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { runId } = req.params;

    // Get line run data
    const runResult = await client.query("SELECT * FROM line_runs WHERE id = $1", [runId]);

    if (runResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Run not found",
      });
    }

    const runData = runResult.rows[0];

    // Get shift slots
    const slotsResult = await client.query(
      `SELECT id, slot_order, slot_label, slot_start, slot_end, planned_hours 
       FROM shift_slots 
       WHERE run_id = $1 
       ORDER BY slot_order`,
      [runId]
    );

    // Get operators
    const operatorsResult = await client.query(
      `SELECT id, operator_no, operator_name 
       FROM run_operators 
       WHERE run_id = $1 
       ORDER BY operator_no`,
      [runId]
    );

    // Get slot targets
    const slotTargetsResult = await client.query(
      `SELECT s.slot_label, t.slot_target, t.cumulative_target
       FROM slot_targets t
       JOIN shift_slots s ON t.slot_id = s.id
       WHERE t.run_id = $1
       ORDER BY s.slot_order`,
      [runId]
    );

    // Get operations with their hourly data (both stitched and sewed)
    const operationsData = [];

    for (const operator of operatorsResult.rows) {
      const operationsResult = await client.query(
        `SELECT 
          o.id,
          o.operation_name,
          o.t1_sec,
          o.t2_sec,
          o.t3_sec,
          o.t4_sec,
          o.t5_sec,
          o.capacity_per_hour,
          COALESCE(
            jsonb_object_agg(
              COALESCE(s.slot_label, ''),
              COALESCE(h.stitched_qty, 0)
            ) FILTER (WHERE s.slot_label IS NOT NULL),
            '{}'::jsonb
          ) as stitched_data,
          COALESCE(
            jsonb_object_agg(
              COALESCE(s2.slot_label, ''),
              COALESCE(se.sewed_qty, 0)
            ) FILTER (WHERE s2.slot_label IS NOT NULL),
            '{}'::jsonb
          ) as sewed_data
         FROM operator_operations o
         LEFT JOIN operation_hourly_entries h ON o.id = h.operation_id
         LEFT JOIN shift_slots s ON h.slot_id = s.id
         LEFT JOIN operation_sewed_entries se ON o.id = se.operation_id
         LEFT JOIN shift_slots s2 ON se.slot_id = s2.id
         WHERE o.run_operator_id = $1 AND o.run_id = $2
         GROUP BY o.id
         ORDER BY o.created_at`,
        [operator.id, runId]
      );

      operationsData.push({
        operator,
        operations: operationsResult.rows,
      });
    }

    res.json({
      success: true,
      run: runData,
      slots: slotsResult.rows,
      operators: operatorsResult.rows,
      operations: operationsData,
      slotTargets: slotTargetsResult.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching run data:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Update hourly stitched data for a specific run
app.post("/api/update-hourly-data/:runId", async (req, res) => {
  const client = await pool.connect();

  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId } = req.params;
    const { entries } = req.body;

    if (!entries || !Array.isArray(entries)) {
      return res.status(400).json({
        success: false,
        error: "Missing hourly data entries",
      });
    }

    let savedCount = 0;
    let updatedCount = 0;

    for (const entry of entries) {
      const { operatorNo, operationName, slotLabel, stitchedQty } = entry;

      if (!operatorNo || !operationName || !slotLabel) {
        continue;
      }

      // Get operation ID
      const opResult = await client.query(
        `
        SELECT o.id as op_id
        FROM operator_operations o
        JOIN run_operators ro ON o.run_operator_id = ro.id
        WHERE o.run_id = $1 
          AND ro.operator_no = $2 
          AND o.operation_name = $3
        LIMIT 1
      `,
        [runId, parseInt(operatorNo), operationName]
      );

      if (opResult.rows.length === 0) {
        console.warn(`⚠️ Operation not found: ${operatorNo} - ${operationName}`);
        continue;
      }

      const operationId = opResult.rows[0].op_id;

      // Get slot ID
      const slotResult = await client.query("SELECT id FROM shift_slots WHERE run_id = $1 AND slot_label = $2", [
        runId,
        slotLabel,
      ]);

      if (slotResult.rows.length === 0) {
        console.warn(`⚠️ Slot not found: ${slotLabel}`);
        continue;
      }

      const slotId = slotResult.rows[0].id;

      // Check if entry already exists
      const existingResult = await client.query(
        "SELECT id FROM operation_hourly_entries WHERE operation_id = $1 AND slot_id = $2",
        [operationId, slotId]
      );

      // Save/update hourly entry
      const hourlyQuery =
        existingResult.rows.length > 0
          ? `
        UPDATE operation_hourly_entries 
        SET stitched_qty = $1, updated_at = NOW()
        WHERE operation_id = $2 AND slot_id = $3
        RETURNING id
      `
          : `
        INSERT INTO operation_hourly_entries (
          run_id,
          operation_id,
          slot_id,
          stitched_qty,
          created_at,
          updated_at
        )
        VALUES ($4, $2, $3, $1, NOW(), NOW())
        RETURNING id
      `;

      const params =
        existingResult.rows.length > 0
          ? [parseFloat(stitchedQty) || 0, operationId, slotId]
          : [parseFloat(stitchedQty) || 0, operationId, slotId, runId];

      await client.query(hourlyQuery, params);

      if (existingResult.rows.length > 0) {
        updatedCount++;
      } else {
        savedCount++;
      }
    }

    await client.query("COMMIT");

    console.log(`✅ Hourly data updated for run ${runId}: ${savedCount} new, ${updatedCount} updated`);

    res.json({
      success: true,
      message: "Hourly data updated",
      savedCount,
      updatedCount,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error updating hourly data:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Add operation to existing run
app.post("/api/add-operation/:runId", async (req, res) => {
  const client = await pool.connect();

  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId } = req.params;
    const { operatorNo, operatorName, operationName, t1, t2, t3, t4, t5, capacityPerHour } = req.body;

    if (!operatorNo || !operationName) {
      return res.status(400).json({
        success: false,
        error: "Missing operator number or operation name",
      });
    }

    // Get or create operator
    const operatorResult = await client.query(
      `
      INSERT INTO run_operators (run_id, operator_no, operator_name, created_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (run_id, operator_no) 
      DO UPDATE SET operator_name = EXCLUDED.operator_name
      RETURNING id
    `,
      [runId, parseInt(operatorNo), operatorName || null]
    );

    const operatorId = operatorResult.rows[0].id;

    // Add operation
    const operationResult = await client.query(
      `
      INSERT INTO operator_operations (
        run_id,
        run_operator_id,
        operation_name,
        t1_sec,
        t2_sec,
        t3_sec,
        t4_sec,
        t5_sec,
        capacity_per_hour,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (run_operator_id, operation_name)
      DO UPDATE SET 
        t1_sec = EXCLUDED.t1_sec,
        t2_sec = EXCLUDED.t2_sec,
        t3_sec = EXCLUDED.t3_sec,
        t4_sec = EXCLUDED.t4_sec,
        t5_sec = EXCLUDED.t5_sec,
        capacity_per_hour = EXCLUDED.capacity_per_hour
      RETURNING id
    `,
      [
        runId,
        operatorId,
        operationName,
        t1 ? parseFloat(t1) : null,
        t2 ? parseFloat(t2) : null,
        t3 ? parseFloat(t3) : null,
        t4 ? parseFloat(t4) : null,
        t5 ? parseFloat(t5) : null,
        capacityPerHour || 0,
      ]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Operation added successfully",
      operationId: operationResult.rows[0].id,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error adding operation:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Duplicate an existing run to a new date
app.post("/api/duplicate-run/:runId", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId } = req.params;
    const { newDate } = req.body;            // required: YYYY-MM-DD
    const newLineNo = req.body.newLineNo;    // optional – if omitted, same line_no is used

    if (!newDate) {
      return res.status(400).json({ success: false, error: "newDate is required" });
    }

    // 1. Get source run
    const sourceRunRes = await client.query(
      `SELECT line_no, style, operators_count, working_hours,
              sam_minutes, efficiency, target_pcs, target_per_hour
       FROM line_runs WHERE id = $1`,
      [runId]
    );
    if (sourceRunRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Source run not found" });
    }
    const src = sourceRunRes.rows[0];

    // 2. Insert new line_run
    const newRunRes = await client.query(
      `INSERT INTO line_runs
         (line_no, run_date, style, operators_count, working_hours,
          sam_minutes, efficiency, target_pcs, target_per_hour, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       RETURNING id`,
      [
        newLineNo || src.line_no,
        newDate,
        src.style,
        src.operators_count,
        src.working_hours,
        src.sam_minutes,
        src.efficiency,
        src.target_pcs,
        src.target_per_hour,
      ]
    );
    const newRunId = newRunRes.rows[0].id;

    // 3. Copy shift_slots – store mapping old slot_id -> new slot_id
    const slotMap = new Map(); // old slot_id -> new slot_id
    const slotsRes = await client.query(
      `SELECT id, slot_order, slot_label, slot_start, slot_end, planned_hours
       FROM shift_slots WHERE run_id = $1 ORDER BY slot_order`,
      [runId]
    );
    for (const slot of slotsRes.rows) {
      const newSlotRes = await client.query(
        `INSERT INTO shift_slots
           (run_id, slot_order, slot_label, slot_start, slot_end, planned_hours)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [newRunId, slot.slot_order, slot.slot_label, slot.slot_start, slot.slot_end, slot.planned_hours]
      );
      slotMap.set(slot.id, newSlotRes.rows[0].id);
    }

    // 4. Copy run_operators – store mapping old operator_id -> new operator_id
    const operatorMap = new Map();
    const operatorsRes = await client.query(
      `SELECT id, operator_no, operator_name FROM run_operators WHERE run_id = $1`,
      [runId]
    );
    for (const op of operatorsRes.rows) {
      const newOpRes = await client.query(
        `INSERT INTO run_operators (run_id, operator_no, operator_name, created_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id`,
        [newRunId, op.operator_no, op.operator_name]
      );
      operatorMap.set(op.id, newOpRes.rows[0].id);
    }

    // 5. Copy operator_operations (using operatorMap)
    for (const [oldOpId, newOpId] of operatorMap.entries()) {
      const opsRes = await client.query(
        `SELECT operation_name, t1_sec, t2_sec, t3_sec, t4_sec, t5_sec, capacity_per_hour
         FROM operator_operations WHERE run_operator_id = $1`,
        [oldOpId]
      );
      for (const opData of opsRes.rows) {
        await client.query(
          `INSERT INTO operator_operations
             (run_id, run_operator_id, operation_name, t1_sec, t2_sec, t3_sec, t4_sec, t5_sec,
              capacity_per_hour, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
          [
            newRunId,
            newOpId,
            opData.operation_name,
            opData.t1_sec,
            opData.t2_sec,
            opData.t3_sec,
            opData.t4_sec,
            opData.t5_sec,
            opData.capacity_per_hour,
          ]
        );
      }
    }

    // 6. Copy slot_targets (using slotMap)
    const targetsRes = await client.query(
      `SELECT slot_id, slot_target, cumulative_target
       FROM slot_targets WHERE run_id = $1`,
      [runId]
    );
    for (const tgt of targetsRes.rows) {
      const newSlotId = slotMap.get(tgt.slot_id);
      if (newSlotId) {
        await client.query(
          `INSERT INTO slot_targets (run_id, slot_id, slot_target, cumulative_target, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())`,
          [newRunId, newSlotId, tgt.slot_target, tgt.cumulative_target]
        );
      }
    }

    await client.query("COMMIT");
    res.json({ success: true, newRunId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error duplicating run:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// --------------------------------------------------------------
// update the operator count  ENDPOINTS
// --------------------------------------------------------------
// ✅ Update operator count for a run and recalculate target
app.put("/api/update-operator-count/:runId", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId } = req.params;
    const { operatorsCount } = req.body;

    if (!operatorsCount || operatorsCount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Valid operators count is required",
      });
    }

    // Get current run data
    const runResult = await client.query(
      `SELECT working_hours, sam_minutes, efficiency, target_pcs, target_per_hour
       FROM line_runs WHERE id = $1`,
      [runId]
    );

    if (runResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Run not found",
      });
    }

    const run = runResult.rows[0];
    
    // Recalculate target based on new operator count
    const operators = parseFloat(operatorsCount);
    const wh = parseFloat(run.working_hours) || 0;
    const sam = parseFloat(run.sam_minutes) || 0;
    const efficiency = parseFloat(run.efficiency) || 0.7;

    // Calculate new target
    const totalMinutes = operators * wh * 60;
    const piecesAt100 = sam > 0 ? totalMinutes / sam : 0;
    const newTarget = piecesAt100 * efficiency;
    
    // Calculate new target per hour
    const newTargetPerHour = wh > 0 ? newTarget / wh : 0;

    // Update the run with new operator count and recalculated targets
    await client.query(
      `UPDATE line_runs 
       SET operators_count = $1, 
           target_pcs = $2,
           target_per_hour = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [operators, newTarget, newTargetPerHour, runId]
    );

    // Also update slot targets (redistribute target across slots proportionally)
    const slotsResult = await client.query(
      `SELECT id, planned_hours FROM shift_slots WHERE run_id = $1 ORDER BY slot_order`,
      [runId]
    );

    if (slotsResult.rows.length > 0) {
      const totalPlannedHours = slotsResult.rows.reduce((sum, slot) => sum + parseFloat(slot.planned_hours), 0);
      
      let cumulativeTarget = 0;
      for (const slot of slotsResult.rows) {
        const slotHours = parseFloat(slot.planned_hours);
        const slotTarget = totalPlannedHours > 0 ? (slotHours / totalPlannedHours) * newTarget : 0;
        cumulativeTarget += slotTarget;

        await client.query(
          `UPDATE slot_targets 
           SET slot_target = $1, cumulative_target = $2, updated_at = NOW()
           WHERE run_id = $3 AND slot_id = $4`,
          [slotTarget, cumulativeTarget, runId, slot.id]
        );
      }
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Operator count updated successfully",
      newTarget,
      newTargetPerHour,
      operatorsCount: operators
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error updating operator count:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});
// --------------------------------------------------------------
// update the operator number for rearrangem ENDPOINTS
// --------------------------------------------------------------

// ✅ Update operator number for an existing run
app.put("/api/run/:runId/operators/:operatorId", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId, operatorId } = req.params;
    const { operatorNo, operatorName } = req.body;

    if (!operatorNo) {
      return res.status(400).json({
        success: false,
        error: "Operator number is required",
      });
    }

    // Check if the new operator number already exists in this run
    const existingCheck = await client.query(
      `SELECT id FROM run_operators 
       WHERE run_id = $1 AND operator_no = $2 AND id != $3`,
      [runId, parseInt(operatorNo), operatorId]
    );

    if (existingCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Operator number ${operatorNo} already exists in this run`,
      });
    }

    // Get current operator info for logging
    const currentOp = await client.query(
      `SELECT operator_no FROM run_operators WHERE id = $1`,
      [operatorId]
    );

    // Update the operator
    const result = await client.query(
      `UPDATE run_operators 
       SET operator_no = $1, operator_name = COALESCE($2, operator_name)
       WHERE id = $3 AND run_id = $4
       RETURNING id, operator_no, operator_name`,
      [parseInt(operatorNo), operatorName || null, operatorId, runId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Operator not found in this run",
      });
    }

    await client.query("COMMIT");

    console.log(`✅ Operator ${currentOp.rows[0]?.operator_no} → ${operatorNo} updated in run ${runId}`);

    res.json({
      success: true,
      message: `Operator number updated successfully`,
      operator: result.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error updating operator number:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});
// --------------------------------------------------------------
// update the operator capacity ENDPOINTS
// --------------------------------------------------------------

// ✅ Update efficiency for a run and recalculate target
app.put("/api/update-efficiency/:runId", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId } = req.params;
    const { efficiency } = req.body;

    if (!efficiency || efficiency <= 0 || efficiency > 1) {
      return res.status(400).json({
        success: false,
        error: "Valid efficiency between 0 and 1 is required",
      });
    }

    // Get current run data
    const runResult = await client.query(
      `SELECT operators_count, working_hours, sam_minutes, target_pcs, target_per_hour
       FROM line_runs WHERE id = $1`,
      [runId]
    );

    if (runResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Run not found",
      });
    }

    const run = runResult.rows[0];
    
    // Recalculate target based on new efficiency
    const operators = parseFloat(run.operators_count) || 0;
    const sam = parseFloat(run.sam_minutes) || 0;
    const wh = parseFloat(run.working_hours) || 0;
    const eff = parseFloat(efficiency);

    // Calculate new target
    const totalMinutes = operators * wh * 60;
    const piecesAt100 = sam > 0 ? totalMinutes / sam : 0;
    const newTarget = piecesAt100 * eff;
    
    // Calculate new target per hour
    const newTargetPerHour = wh > 0 ? newTarget / wh : 0;

    // Update the run with new efficiency and recalculated targets
    await client.query(
      `UPDATE line_runs 
       SET efficiency = $1, 
           target_pcs = $2,
           target_per_hour = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [eff, newTarget, newTargetPerHour, runId]
    );

    // Also update slot targets (redistribute target across slots proportionally)
    const slotsResult = await client.query(
      `SELECT id, planned_hours FROM shift_slots WHERE run_id = $1 ORDER BY slot_order`,
      [runId]
    );

    if (slotsResult.rows.length > 0) {
      const totalPlannedHours = slotsResult.rows.reduce((sum, slot) => sum + parseFloat(slot.planned_hours), 0);
      
      let cumulativeTarget = 0;
      for (const slot of slotsResult.rows) {
        const slotHours = parseFloat(slot.planned_hours);
        const slotTarget = totalPlannedHours > 0 ? (slotHours / totalPlannedHours) * newTarget : 0;
        cumulativeTarget += slotTarget;

        await client.query(
          `UPDATE slot_targets 
           SET slot_target = $1, cumulative_target = $2, updated_at = NOW()
           WHERE run_id = $3 AND slot_id = $4`,
          [slotTarget, cumulativeTarget, runId, slot.id]
        );
      }
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Efficiency updated successfully",
      newTarget,
      newTargetPerHour,
      efficiency: eff
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error updating efficiency:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// --------------------------------------------------------------
//  Update shift slot planned hours for a run
// --------------------------------------------------------------
app.put("/api/update-shift-slots/:runId", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId } = req.params;
    const { slots } = req.body; // Array of { slotId, plannedHours, slotLabel }

    if (!slots || !Array.isArray(slots)) {
      return res.status(400).json({
        success: false,
        error: "Slots array is required",
      });
    }

    // Get current run data for target recalculation
    const runResult = await client.query(
      `SELECT operators_count, working_hours, sam_minutes, efficiency, target_pcs
       FROM line_runs WHERE id = $1`,
      [runId]
    );

    if (runResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Run not found",
      });
    }

    const run = runResult.rows[0];
    
    // Update each slot's planned hours
    for (const slot of slots) {
      await client.query(
        `UPDATE shift_slots 
         SET planned_hours = $1
         WHERE id = $2 AND run_id = $3`,
        [parseFloat(slot.plannedHours), slot.slotId, runId]
      );
    }

    // Recalculate total working hours from slots
    const slotsResult = await client.query(
      `SELECT planned_hours FROM shift_slots WHERE run_id = $1 ORDER BY slot_order`,
      [runId]
    );

    const totalPlannedHours = slotsResult.rows.reduce(
      (sum, slot) => sum + parseFloat(slot.planned_hours), 
      0
    );

    // Recalculate target based on new total working hours
    const operators = parseFloat(run.operators_count) || 0;
    const sam = parseFloat(run.sam_minutes) || 0;
    const efficiency = parseFloat(run.efficiency) || 0.7;
    const wh = totalPlannedHours;

    const totalMinutes = operators * wh * 60;
    const piecesAt100 = sam > 0 ? totalMinutes / sam : 0;
    const newTarget = piecesAt100 * efficiency;
    const newTargetPerHour = wh > 0 ? newTarget / wh : 0;

    // Update line_runs with new working hours and targets
    await client.query(
      `UPDATE line_runs 
       SET working_hours = $1,
           target_pcs = $2,
           target_per_hour = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [wh, newTarget, newTargetPerHour, runId]
    );

    // Update slot targets (redistribute target across slots proportionally)
    let cumulativeTarget = 0;
    for (const slot of slotsResult.rows) {
      const slotHours = parseFloat(slot.planned_hours);
      const slotTarget = totalPlannedHours > 0 ? (slotHours / totalPlannedHours) * newTarget : 0;
      cumulativeTarget += slotTarget;

      await client.query(
        `UPDATE slot_targets 
         SET slot_target = $1, cumulative_target = $2, updated_at = NOW()
         WHERE run_id = $3 AND slot_id = $4`,
        [slotTarget, cumulativeTarget, runId, slot.id]
      );
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Shift slots updated successfully",
      workingHours: wh,
      newTarget,
      newTargetPerHour,
      slots: slotsResult.rows.map(slot => ({
        ...slot,
        planned_hours: parseFloat(slot.planned_hours)
      }))
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error updating shift slots:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// --------------------------------------------------------------
// update the operator capacity ENDPOINTS
// --------------------------------------------------------------

app.put("/api/update-operation/:runId", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId } = req.params;
    const { operatorNo, operationName, t1, t2, t3, t4, t5, capacityPerHour } = req.body;

    if (!operatorNo || !operationName) {
      return res.status(400).json({
        success: false,
        error: "Operator number and operation name are required",
      });
    }

    // Find the operation ID and get current capacity
    const opResult = await client.query(
      `
      SELECT o.id as op_id, o.capacity_per_hour as old_capacity
      FROM operator_operations o
      JOIN run_operators ro ON o.run_operator_id = ro.id
      WHERE o.run_id = $1 
        AND ro.operator_no = $2 
        AND o.operation_name = $3
      LIMIT 1
      `,
      [runId, parseInt(operatorNo), operationName]
    );

    if (opResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Operation not found",
      });
    }

    const operationId = opResult.rows[0].op_id;
    const oldCapacity = parseFloat(opResult.rows[0].old_capacity) || 0;
    const newCapacity = capacityPerHour || 0;

    // Update the operation - REMOVED updated_at reference
    const updateResult = await client.query(
      `
      UPDATE operator_operations
      SET 
        t1_sec = $1,
        t2_sec = $2,
        t3_sec = $3,
        t4_sec = $4,
        t5_sec = $5,
        capacity_per_hour = $6
      WHERE id = $7
      RETURNING id
      `,
      [
        t1 || null,
        t2 || null,
        t3 || null,
        t4 || null,
        t5 || null,
        newCapacity,
        operationId,
      ]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Failed to update operation",
      });
    }

    // Save to history table if capacity changed
    if (Math.abs(oldCapacity - newCapacity) > 0.001) {
      await client.query(
        `
        INSERT INTO operator_capacity_history 
          (operation_id, old_capacity, new_capacity, changed_by, changed_at)
        VALUES ($1, $2, $3, $4, NOW())
        `,
        [operationId, oldCapacity, newCapacity, req.user.id]
      );
      console.log(`✅ Capacity history recorded for operation ${operationId}: ${oldCapacity} → ${newCapacity}`);
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Operation updated successfully",
      operationId: updateResult.rows[0].id,
      capacityChanged: Math.abs(oldCapacity - newCapacity) > 0.001
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error updating operation:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Get capacity history for an operation
app.get("/api/operation-capacity-history/:operationId", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { operationId } = req.params;
    
    const result = await client.query(
      `
      SELECT 
        h.id,
        h.old_capacity,
        h.new_capacity,
        h.changed_at,
        u.username as changed_by_username,
        u.full_name as changed_by_name
      FROM operator_capacity_history h
      LEFT JOIN users u ON h.changed_by = u.id
      WHERE h.operation_id = $1
      ORDER BY h.changed_at DESC
      `,
      [operationId]
    );
    
    res.json({
      success: true,
      history: result.rows
    });
  } catch (err) {
    console.error("❌ Error fetching capacity history:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Get all capacity changes for a run
app.get("/api/run-capacity-history/:runId", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { runId } = req.params;
    
    const result = await client.query(
      `
      SELECT 
        h.id,
        h.old_capacity,
        h.new_capacity,
        h.changed_at,
        u.username as changed_by_username,
        u.full_name as changed_by_name,
        ro.operator_no,
        ro.operator_name,
        oo.operation_name
      FROM operator_capacity_history h
      JOIN operator_operations oo ON h.operation_id = oo.id
      JOIN run_operators ro ON oo.run_operator_id = ro.id
      LEFT JOIN users u ON h.changed_by = u.id
      WHERE oo.run_id = $1
      ORDER BY h.changed_at DESC
      `,
      [runId]
    );
    
    res.json({
      success: true,
      history: result.rows
    });
  } catch (err) {
    console.error("❌ Error fetching run capacity history:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ========== QUALITY INSPECTOR ROUTES ==========
// Make sure this is AFTER authenticateToken is defined

// Helper middleware for quality inspector access
const requireQualityInspector = (req, res, next) => {
  const allowedRoles = ['quality_inspector', 'engineer', 'supervisor', 'soporte_it', 'master'];
  if (!allowedRoles.includes(req.user?.role)) {
    return res.status(403).json({
      success: false,
      error: "Access denied. Quality inspector role required.",
    });
  }
  next();
};

/**
 * GET /api/quality/lines
 * Returns all lines that have active runs (for line selection)
 */
app.get("/api/quality/lines", authenticateToken, requireQualityInspector, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const result = await client.query(`
      WITH distinct_lines AS (
        SELECT DISTINCT ON (line_no) 
          line_no,
          style as current_style,
          created_at
        FROM line_runs
        WHERE line_no IS NOT NULL AND line_no != ''
        ORDER BY line_no, created_at DESC
      )
      SELECT line_no, current_style
      FROM distinct_lines
      ORDER BY line_no::int
    `);
    
    res.json({
      success: true,
      lines: result.rows.map(row => ({
        line_no: row.line_no,
        current_style: row.current_style,
        has_today_run: false
      })),
    });
  } catch (err) {
    console.error("❌ Error fetching quality lines:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/quality/lines/:lineNo/runs
 * Returns runs for a specific line (distinct by date and style)
 */
app.get("/api/quality/lines/:lineNo/runs", authenticateToken, requireQualityInspector, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { lineNo } = req.params;
    
    // Get distinct runs (remove duplicates if any)
    const result = await client.query(`
      SELECT DISTINCT ON (run_date, style)
        id, 
        line_no, 
        run_date, 
        style, 
        target_pcs, 
        operators_count, 
        working_hours
      FROM line_runs
      WHERE line_no = $1
      ORDER BY run_date DESC, style, id DESC
    `, [lineNo]);
    
    console.log(`✅ Found ${result.rows.length} distinct runs for line ${lineNo}`);
    
    res.json({
      success: true,
      runs: result.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching line runs:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/quality/inspections/:lineNo
 * Returns inspections for a specific line
 */
app.get("/api/quality/inspections/:lineNo", authenticateToken, requireQualityInspector, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { lineNo } = req.params;
    
    const result = await client.query(`
      SELECT i.*, 
             to_char(i.inspection_date, 'YYYY-MM-DD') as inspection_date,
             COUNT(de.id) as total_defect_entries,
             COALESCE(SUM(de.defect_quantity), 0) as total_defects
      FROM quality_inspections i
      LEFT JOIN quality_defect_entries de ON i.id = de.inspection_id
      WHERE i.line_no = $1
      GROUP BY i.id
      ORDER BY i.inspection_date DESC, i.created_at DESC
    `, [lineNo]);
    
    res.json({
      success: true,
      inspections: result.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching inspections:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/quality/inspection/:inspectionId
 * Returns full inspection details
 */
app.get("/api/quality/inspection/:inspectionId", authenticateToken, requireQualityInspector, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { inspectionId } = req.params;
    
    const inspectionResult = await client.query(`
      SELECT * FROM quality_inspections WHERE id = $1
    `, [inspectionId]);
    
    if (inspectionResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Inspection not found" });
    }
    
    const defectsResult = await client.query(`
      SELECT 
        de.*,
        dt.defect_code,
        dt.defect_name,
        dt.category,
        dr.reason_code,
        dr.reason_description
      FROM quality_defect_entries de
      JOIN quality_defect_types dt ON de.defect_type_id = dt.id
      LEFT JOIN quality_defect_reasons dr ON de.defect_reason_id = dr.id
      WHERE de.inspection_id = $1
      ORDER BY de.created_at DESC
    `, [inspectionId]);
    
    res.json({
      success: true,
      inspection: inspectionResult.rows[0],
      defects: defectsResult.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching inspection details:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});


app.get("/api/quality/defect-types", authenticateToken, requireQualityInspector, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const result = await client.query(`
      SELECT 
        dt.id,
        dt.defect_code,
        dt.defect_name,
        dt.category,
        dt.sort_order,
        COALESCE(
          (SELECT json_agg(
            json_build_object(
              'id', dr.id,
              'reason_code', dr.reason_code,
              'reason_description', dr.reason_description
            ) ORDER BY dr.sort_order
          )
          FROM quality_defect_reasons dr
          WHERE dr.defect_type_id = dt.id AND dr.is_active = true),
          '[]'::json
        ) as reasons
      FROM quality_defect_types dt
      WHERE dt.is_active = true
      ORDER BY dt.sort_order
    `);
    
    // Add this debug log
    console.log('Defect types with reasons:');
    result.rows.forEach(row => {
      console.log(`  ${row.sort_order}. ${row.defect_name}: ${row.reasons?.length || 0} reasons`);
    });
    
    res.json({
      success: true,
      defectTypes: result.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching defect types:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/quality/analytics
 * CEO analytical view of the quality_inspections table.
 * Query params: startDate=YYYY-MM-DD, endDate=YYYY-MM-DD (defaults to today),
 *   line (optional), style (optional).
 * Returns aggregated defect data for the selected period.
 */
app.get("/api/quality/analytics", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    if (!['skyrina', 'master', 'engineer', 'supervisor', 'soporte_it', 'quality_inspector'].includes(req.user?.role)) {
      return res.status(403).json({ success: false, error: "Access denied" });
    }

    const today = new Date().toISOString().split('T')[0];
    const startDate = req.query.startDate || today;
    const endDate = req.query.endDate || startDate;
    const { line, style } = req.query;

    // Build the optional line/style filter that applies to the inspections table (alias i)
    const filters = [];
    const params = [startDate, endDate];
    let p = 3;
    if (line && line !== 'all') { filters.push(`i.line_no = $${p++}`); params.push(line); }
    if (style && style !== 'all') { filters.push(`i.style = $${p++}`); params.push(style); }
    const extra = filters.length ? ` AND ${filters.join(' AND ')}` : '';
    const dateWhere = `i.inspection_date BETWEEN $1 AND $2${extra}`;

    // 1. Headline KPIs. Defect totals come from the entries; checked quantity is a
    // per-inspection figure, so it is summed in a separate subquery to avoid the
    // row multiplication caused by joining the entries table.
    const summary = await client.query(`
      SELECT
        COALESCE((
          SELECT SUM(de.defect_quantity)
          FROM quality_defect_entries de
          JOIN quality_inspections i ON de.inspection_id = i.id
          WHERE ${dateWhere}
        ), 0)::int                                AS total_defects,
        COUNT(DISTINCT i.id)::int                  AS total_inspections,
        COUNT(DISTINCT i.line_no)::int             AS active_lines,
        COUNT(DISTINCT i.style)::int               AS active_styles,
        COUNT(DISTINCT i.inspector_name)::int      AS active_inspectors,
        COALESCE(SUM(i.total_checked_quantity), 0)::numeric AS total_checked
      FROM quality_inspections i
      WHERE ${dateWhere}
    `, params);

    // 2. Defects by line
    const byLine = await client.query(`
      SELECT i.line_no,
             COALESCE(SUM(de.defect_quantity), 0)::int AS total_defects,
             COUNT(DISTINCT i.id)::int AS inspections
      FROM quality_inspections i
      LEFT JOIN quality_defect_entries de ON de.inspection_id = i.id
      WHERE ${dateWhere}
      GROUP BY i.line_no
      ORDER BY total_defects DESC
    `, params);

    // 3. Defects by type
    const byType = await client.query(`
      SELECT dt.defect_code, dt.defect_name, dt.category,
             COALESCE(SUM(de.defect_quantity), 0)::int AS total_defects
      FROM quality_defect_entries de
      JOIN quality_inspections i ON de.inspection_id = i.id
      JOIN quality_defect_types dt ON de.defect_type_id = dt.id
      WHERE ${dateWhere}
      GROUP BY dt.id, dt.defect_code, dt.defect_name, dt.category
      ORDER BY total_defects DESC
    `, params);

    // 4. Defects by reason
    const byReason = await client.query(`
      SELECT dr.reason_code, dr.reason_description, dt.defect_name,
             COALESCE(SUM(de.defect_quantity), 0)::int AS total_defects
      FROM quality_defect_entries de
      JOIN quality_inspections i ON de.inspection_id = i.id
      JOIN quality_defect_types dt ON de.defect_type_id = dt.id
      LEFT JOIN quality_defect_reasons dr ON de.defect_reason_id = dr.id
      WHERE ${dateWhere} AND dr.id IS NOT NULL
      GROUP BY dr.id, dr.reason_code, dr.reason_description, dt.defect_name
      ORDER BY total_defects DESC
      LIMIT 15
    `, params);

    // 5. Defects by inspector
    const byInspector = await client.query(`
      SELECT i.inspector_name,
             COALESCE(SUM(de.defect_quantity), 0)::int AS total_defects,
             COUNT(DISTINCT i.id)::int AS inspections
      FROM quality_inspections i
      LEFT JOIN quality_defect_entries de ON de.inspection_id = i.id
      WHERE ${dateWhere}
      GROUP BY i.inspector_name
      ORDER BY total_defects DESC
    `, params);

    // 6. Defects by style
    const byStyle = await client.query(`
      SELECT COALESCE(i.style, 'Sin estilo') AS style,
             COALESCE(SUM(de.defect_quantity), 0)::int AS total_defects
      FROM quality_inspections i
      LEFT JOIN quality_defect_entries de ON de.inspection_id = i.id
      WHERE ${dateWhere}
      GROUP BY i.style
      ORDER BY total_defects DESC
    `, params);

    // 7. Hourly trend (intraday) based on entry creation time
    const hourly = await client.query(`
      SELECT to_char(de.created_at, 'HH24:00') AS hour,
             COALESCE(SUM(de.defect_quantity), 0)::int AS total_defects
      FROM quality_defect_entries de
      JOIN quality_inspections i ON de.inspection_id = i.id
      WHERE ${dateWhere}
      GROUP BY to_char(de.created_at, 'HH24:00')
      ORDER BY hour
    `, params);

    // 8. Detail rows for the table
    const detail = await client.query(`
      SELECT i.id,
             to_char(i.inspection_date, 'YYYY-MM-DD') AS inspection_date,
             i.line_no, i.style, i.inspector_name, i.shift_slot,
             i.bad_type, i.bad_reason,
             to_char(i.created_at AT TIME ZONE 'America/Mexico_City', 'HH24:MI') AS time,
             COALESCE(SUM(de.defect_quantity), 0)::int AS total_defects
      FROM quality_inspections i
      LEFT JOIN quality_defect_entries de ON de.inspection_id = i.id
      WHERE ${dateWhere}
      GROUP BY i.id
      ORDER BY i.created_at DESC
    `, params);

    res.json({
      success: true,
      range: { startDate, endDate },
      summary: summary.rows[0],
      byLine: byLine.rows,
      byType: byType.rows,
      byReason: byReason.rows,
      byInspector: byInspector.rows,
      byStyle: byStyle.rows,
      hourly: hourly.rows,
      detail: detail.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching quality analytics:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/quality/inspection
 * Create a new inspection
 */
app.post("/api/quality/inspection", authenticateToken, requireQualityInspector, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");
    
    const { 
      lineNo, 
      style,
      inspectorName, 
      inspectionDate,
      shiftSlot,
      totalCheckedQuantity,
      notes,
      defects 
    } = req.body;
    
    if (!lineNo || !inspectorName || !defects || !Array.isArray(defects)) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: lineNo, inspectorName, and defects array"
      });
    }
    
    const totalDefects = defects.reduce((sum, d) => sum + (d.quantity || 1), 0);
    
    const inspectionResult = await client.query(`
      INSERT INTO quality_inspections (
        line_no, style, inspector_name, inspection_date, shift_slot, 
        total_defects, total_checked_quantity, notes, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING id
    `, [
      lineNo,
      style || null,
      inspectorName,
      inspectionDate || new Date().toISOString().split('T')[0],
      shiftSlot || null,
      totalDefects,
      totalCheckedQuantity || 0,
      notes || null
    ]);
    
    const inspectionId = inspectionResult.rows[0].id;
    
    for (const defect of defects) {
      await client.query(`
        INSERT INTO quality_defect_entries (
          inspection_id, defect_type_id, defect_reason_id, 
          defect_quantity, operation_name, operator_no, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        inspectionId,
        defect.defectTypeId,
        defect.defectReasonId || null,
        defect.quantity || 1,
        defect.operationName || null,
        defect.operatorNo ? parseInt(defect.operatorNo) : null,
        defect.notes || null
      ]);
    }
    
    // Also save the bad type / bad reason names on the quality_inspections row
    // (aggregated, since one inspection can contain several defect types)
    await client.query(`
      UPDATE quality_inspections qi
      SET bad_type = sub.types,
          bad_reason = sub.reasons,
          updated_at = NOW()
      FROM (
        SELECT
          string_agg(DISTINCT dt.defect_code || ' - ' || dt.defect_name, '; ') AS types,
          string_agg(DISTINCT dr.reason_code || ' - ' || dr.reason_description, '; ') AS reasons
        FROM quality_defect_entries de
        JOIN quality_defect_types dt ON de.defect_type_id = dt.id
        LEFT JOIN quality_defect_reasons dr ON de.defect_reason_id = dr.id
        WHERE de.inspection_id = $1
      ) sub
      WHERE qi.id = $1
    `, [inspectionId]);
    
    await client.query("COMMIT");
    
    res.json({
      success: true,
      message: "Inspection saved successfully",
      inspectionId: inspectionId,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error saving inspection:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/quality/inspection/:inspectionId
 * Delete an inspection
 */
app.delete("/api/quality/inspection/:inspectionId", authenticateToken, requireQualityInspector, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");
    
    const { inspectionId } = req.params;
    
    const checkResult = await client.query(
      `SELECT id FROM quality_inspections WHERE id = $1`,
      [inspectionId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Inspection not found" });
    }
    
    await client.query(`DELETE FROM quality_inspections WHERE id = $1`, [inspectionId]);
    
    await client.query("COMMIT");
    
    res.json({
      success: true,
      message: "Inspection deleted successfully",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error deleting inspection:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/quality/run-operators/:runId
 * Returns operators for a specific run
 */
app.get("/api/quality/run-operators/:runId", authenticateToken, requireQualityInspector, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { runId } = req.params;
    
    const result = await client.query(`
      SELECT ro.id, ro.operator_no, ro.operator_name
      FROM run_operators ro
      WHERE ro.run_id = $1
      ORDER BY ro.operator_no
    `, [runId]);
    
    res.json({
      success: true,
      operators: result.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching run operators:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});


// --------------------------------------------------------------
// SUPERVISOR DASHBOARD ENDPOINTS (FIXED)
// --------------------------------------------------------------

const requireSupervisor = (req, res, next) => {
  if (req.user.role !== "supervisor" && req.user.role !== "skyrina"&& req.user.role !== "admin"
    && req.user.role !== "master"
  ) {
    return res.status(403).json({
      success: false,
      error: "Access denied. Supervisor role required.",
    });
  }
  next();
};

/**
 * GET /api/supervisor/summary?date=YYYY-MM-DD
 * Returns global totals for the selected date
 */

app.get("/api/supervisor/summary", authenticateToken, requireSupervisor, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, error: "date parameter required" });
    }

    // 1) Total target – direct sum
    const targetResult = await client.query(
      `SELECT COALESCE(SUM(target_pcs), 0) as total_target
       FROM line_runs
       WHERE run_date = $1`,
      [date]
    );
    const totalTarget = parseFloat(targetResult.rows[0].total_target) || 0;

    // 2) Total sewed – per operator per line: max of operation totals, then sum across lines
    // In /api/supervisor/summary, after totalTarget calculation:

// 2) Total sewed (finished garments) – sum of packing operation outputs
const sewedResult = await client.query(
  `SELECT COALESCE(SUM(se.sewed_qty), 0) AS total_sewed
   FROM line_runs lr
   JOIN run_operators ro ON lr.id = ro.run_id
   JOIN operator_operations oo ON ro.id = oo.run_operator_id
   JOIN operation_sewed_entries se ON oo.id = se.operation_id
   WHERE lr.run_date = $1
     AND (oo.operation_name ILIKE '%pack%' OR oo.operation_name ILIKE '%emp%')`,
  [date]
);
const totalSewed = parseFloat(sewedResult.rows[0].total_sewed) || 0;

    // 3) Total operators – distinct count
    const operatorsResult = await client.query(
      `SELECT COUNT(DISTINCT ro.operator_no) as total_operators
       FROM run_operators ro
       JOIN line_runs lr ON ro.run_id = lr.id
       WHERE lr.run_date = $1`,
      [date]
    );
    const totalOperators = parseInt(operatorsResult.rows[0].total_operators) || 0;

   // 4) Efficiency – using packing output (finished garments) to count total SAM produced
const efficiencyResult = await client.query(
  `
  WITH run_available_minutes AS (
    SELECT
      id AS run_id,
      (working_hours * operators_count * 60) AS available_minutes
    FROM line_runs
    WHERE run_date = $1
  ),
  run_packing_totals AS (
    SELECT
      lr.id AS run_id,
      lr.sam_minutes,
      COALESCE(SUM(se.sewed_qty), 0) AS packing_total
    FROM line_runs lr
    JOIN run_operators ro ON lr.id = ro.run_id
    JOIN operator_operations oo ON ro.id = oo.run_operator_id
    LEFT JOIN operation_sewed_entries se ON oo.id = se.operation_id
    WHERE lr.run_date = $1
      AND (oo.operation_name ILIKE '%pack%' OR oo.operation_name ILIKE '%emp%')
    GROUP BY lr.id, lr.sam_minutes
  )
  SELECT
    COALESCE(SUM(ram.available_minutes), 0) AS total_available_minutes,
    COALESCE(SUM(rpt.packing_total * rpt.sam_minutes), 0) AS total_sam_output
  FROM run_available_minutes ram
  LEFT JOIN run_packing_totals rpt ON ram.run_id = rpt.run_id;
`,
  [date]
);
    const row = efficiencyResult.rows[0];
    const totalSamOutput = parseFloat(row.total_sam_output) || 0;
    const totalAvailableMinutes = parseFloat(row.total_available_minutes) || 0;
    const overallEfficiency = totalAvailableMinutes > 0 ? (totalSamOutput / totalAvailableMinutes) * 100 : 0;

    // 5) Target achievement
    const targetAchievement = totalTarget > 0 ? (totalSewed / totalTarget) * 100 : 0;

    res.json({
      success: true,
      date,
      summary: {
        totalTarget: Math.round(totalTarget * 100) / 100,
        totalSewed: Math.round(totalSewed * 100) / 100,
        totalOperators,
        targetAchievement: Math.round(targetAchievement * 100) / 100,
        overallEfficiency: Math.round(overallEfficiency * 100) / 100,
      },
    });
  } catch (err) {
    console.error("❌ /api/supervisor/summary error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/supervisor/alert-count?date=YYYY-MM-DD
 * Returns count of operators with production alerts (variance > 10% or production zero)
 */
app.get("/api/supervisor/alert-count", authenticateToken, requireSupervisor, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, error: "date parameter required" });
    }

    const alertQuery = `
      WITH operator_planned AS (
        SELECT 
          ro.operator_no,
          COALESCE(SUM(h.stitched_qty), 0) AS planned_total
        FROM line_runs lr
        JOIN run_operators ro ON lr.id = ro.run_id
        JOIN operator_operations oo ON ro.id = oo.run_operator_id
        LEFT JOIN operation_hourly_entries h ON oo.id = h.operation_id
        WHERE lr.run_date = $1
        GROUP BY ro.operator_no
      ),
      operator_actual AS (
        SELECT 
          ro.operator_no,
          COALESCE(SUM(se.sewed_qty), 0) AS actual_total
        FROM line_runs lr
        JOIN run_operators ro ON lr.id = ro.run_id
        JOIN operator_operations oo ON ro.id = oo.run_operator_id
        LEFT JOIN operation_sewed_entries se ON oo.id = se.operation_id
        WHERE lr.run_date = $1
        GROUP BY ro.operator_no
      )
      SELECT COUNT(*) AS alert_count
      FROM operator_planned p
      JOIN operator_actual a ON p.operator_no = a.operator_no
      WHERE a.actual_total < p.planned_total * 0.9
         OR (p.planned_total > 0 AND a.actual_total = 0);
    `;

    const result = await client.query(alertQuery, [date]);
    const alertCount = parseInt(result.rows[0].alert_count) || 0;

    res.json({ success: true, date, alertCount });
  } catch (err) {
    console.error("❌ /api/supervisor/alert-count error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/supervisor/line-performance?date=YYYY-MM-DD
 * Returns per-line: line_no, totalTarget, totalSewed, achievement, operators
 */
// In server.js, replace the /api/supervisor/line-performance endpoint with this version

app.get("/api/supervisor/line-performance", authenticateToken, requireSupervisor, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, error: "date parameter required" });
    }

    // Current time in the server's timezone (you may want to use client time later)
    const now = new Date();
    const todayStr = date; // YYYY-MM-DD

    const query = `
      WITH line_targets AS (
        SELECT lr.id AS run_id, lr.line_no, lr.target_pcs AS total_target
        FROM line_runs lr
        WHERE lr.run_date = $1
      ),
      -- Get all slots with their targets for each line
      line_slots AS (
        SELECT
          lt.line_no,
          ss.slot_start,
          ss.slot_end,
          st.slot_target
        FROM line_targets lt
        JOIN shift_slots ss ON lt.run_id = ss.run_id
        LEFT JOIN slot_targets st ON ss.id = st.slot_id
        WHERE ss.slot_start IS NOT NULL AND ss.slot_end IS NOT NULL
      ),
      -- Compute real‑time cumulative for each line
      line_realtime AS (
        SELECT
          line_no,
          SUM(
            CASE
              WHEN $2::timestamp AT TIME ZONE 'UTC' >= (($1 || ' ' || slot_end)::timestamp) THEN slot_target
              WHEN $2::timestamp AT TIME ZONE 'UTC' >= (($1 || ' ' || slot_start)::timestamp)
                   AND $2::timestamp AT TIME ZONE 'UTC' < (($1 || ' ' || slot_end)::timestamp)
              THEN slot_target * (
                EXTRACT(EPOCH FROM ($2::timestamp AT TIME ZONE 'UTC' - ($1 || ' ' || slot_start)::timestamp)) /
                EXTRACT(EPOCH FROM (($1 || ' ' || slot_end)::timestamp - ($1 || ' ' || slot_start)::timestamp))
              )
              ELSE 0
            END
          ) AS realtime_target
        FROM line_slots
        GROUP BY line_no
      ),
      operator_production AS (
        SELECT 
          lr.line_no,
          ro.operator_no,
          COALESCE(SUM(se.sewed_qty), 0) AS operator_production
        FROM line_runs lr
        JOIN run_operators ro ON lr.id = ro.run_id
        JOIN operator_operations oo ON ro.id = oo.run_operator_id
        LEFT JOIN operation_sewed_entries se ON oo.id = se.operation_id
        WHERE lr.run_date = $1
          AND (oo.operation_name ILIKE '%pack%' OR oo.operation_name ILIKE '%emp%')
        GROUP BY lr.line_no, ro.operator_no
      ),
      line_sewed AS (
        SELECT line_no, SUM(operator_production) AS total_sewed
        FROM operator_production
        GROUP BY line_no
      ),
      line_operators AS (
        SELECT lr.line_no, COUNT(DISTINCT ro.operator_no) AS operators_count
        FROM line_runs lr
        JOIN run_operators ro ON lr.id = ro.run_id
        WHERE lr.run_date = $1
        GROUP BY lr.line_no
      )
      SELECT 
        lt.line_no,
        lt.total_target,
        COALESCE(ls.total_sewed, 0) AS total_sewed,
        COALESCE(lo.operators_count, 0) AS operators_count,
        COALESCE(lr.realtime_target, 0) AS realtime_target,
        CASE 
          WHEN lt.total_target > 0 
          THEN (COALESCE(ls.total_sewed, 0) / lt.total_target) * 100 
          ELSE 0 
        END AS achievement
      FROM line_targets lt
      LEFT JOIN line_sewed ls ON lt.line_no = ls.line_no
      LEFT JOIN line_operators lo ON lt.line_no = lo.line_no
      LEFT JOIN line_realtime lr ON lt.line_no = lr.line_no
      ORDER BY lt.line_no;
    `;

    const result = await client.query(query, [date, now]);

    const lines = result.rows.map((row) => ({
      lineNo: row.line_no,
      totalTarget: parseFloat(row.total_target) || 0,
      totalSewed: parseFloat(row.total_sewed) || 0,
      operators: parseInt(row.operators_count) || 0,
      realtimeTarget: Math.round(parseFloat(row.realtime_target) * 100) / 100, // two decimals
      achievement: Math.round((parseFloat(row.achievement) || 0) * 100) / 100,
    }));

    res.json({ success: true, date, lines });
  } catch (err) {
    console.error("❌ /api/supervisor/line-performance error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ========== WORK ORDER MANAGEMENT ==========

/**
 * GET /api/work-orders
 * Get all work orders with optional filters
 */
app.get("/api/work-orders", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { status, lineNo, startDate, endDate } = req.query;
    
    let query = `
      SELECT 
        id,
        work_order_no,
        quantity,
        customer_name,
        style_description,
        color,
        fabric_supplier,
        style_code,
        line_no,
        run_date,
        created_at,
        updated_at,
        status
      FROM work_orders
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(status);
    }
    
    if (lineNo) {
      query += ` AND line_no = $${paramIndex++}`;
      params.push(lineNo);
    }
    
    if (startDate) {
      query += ` AND run_date >= $${paramIndex++}`;
      params.push(startDate);
    }
    
    if (endDate) {
      query += ` AND run_date <= $${paramIndex++}`;
      params.push(endDate);
    }
    
    query += ` ORDER BY created_at DESC`;
    
    const result = await client.query(query, params);
    
    res.json({
      success: true,
      workOrders: result.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching work orders:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/work-orders/:id
 * Get a specific work order by ID
 */
app.get("/api/work-orders/:id", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { id } = req.params;
    
    const result = await client.query(
      `
      SELECT 
        wo.*,
        json_agg(
          json_build_object(
            'id', la.id,
            'line_no', la.line_no,
            'assigned_date', la.assigned_date,
            'assigned_quantity', la.assigned_quantity,
            'status', la.status,
            'planned_start_date', la.planned_start_date,
            'planned_end_date', la.planned_end_date
          )
        ) FILTER (WHERE la.id IS NOT NULL) as assignments
      FROM work_orders wo
      LEFT JOIN line_assignments la ON wo.id = la.work_order_id
      WHERE wo.id = $1
      GROUP BY wo.id
      `,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Work order not found",
      });
    }
    
    res.json({
      success: true,
      workOrder: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Error fetching work order:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/work-orders
 * Create a new work order
 */
app.post("/api/work-orders", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const {
      workOrderNo,
      quantity,
      customerName,
      styleDescription,
      color,
      fabricSupplier,
      styleCode,
      lineNo,
      runDate,
    } = req.body;
    
    // Validate required fields
    if (!workOrderNo || !quantity || !customerName || !styleDescription) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: workOrderNo, quantity, customerName, styleDescription",
      });
    }
    
    // Check if work order number already exists
    const existingCheck = await client.query(
      "SELECT id FROM work_orders WHERE work_order_no = $1",
      [workOrderNo]
    );
    
    if (existingCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Work order number already exists",
      });
    }
    
    const result = await client.query(
      `
      INSERT INTO work_orders (
        work_order_no,
        quantity,
        customer_name,
        style_description,
        color,
        fabric_supplier,
        style_code,
        line_no,
        run_date,
        created_at,
        updated_at,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW(), 'pending')
      RETURNING id, work_order_no, quantity, customer_name, style_description, status, created_at
      `,
      [
        workOrderNo,
        parseFloat(quantity),
        customerName,
        styleDescription,
        color || null,
        fabricSupplier || null,
        styleCode || null,
        lineNo || null,
        runDate || null,
      ]
    );
    
    res.json({
      success: true,
      message: "Work order created successfully",
      workOrder: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Error creating work order:", err.message);
    
    if (err.code === "23505") {
      return res.status(400).json({
        success: false,
        error: "Work order number already exists",
      });
    }
    
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/work-orders/:id
 * Update an existing work order
 */
app.put("/api/work-orders/:id", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { id } = req.params;
    const {
      workOrderNo,
      quantity,
      customerName,
      styleDescription,
      color,
      fabricSupplier,
      styleCode,
      lineNo,
      runDate,
      status,
    } = req.body;
    
    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (workOrderNo !== undefined) {
      updates.push(`work_order_no = $${paramIndex++}`);
      values.push(workOrderNo);
    }
    
    if (quantity !== undefined) {
      updates.push(`quantity = $${paramIndex++}`);
      values.push(parseFloat(quantity));
    }
    
    if (customerName !== undefined) {
      updates.push(`customer_name = $${paramIndex++}`);
      values.push(customerName);
    }
    
    if (styleDescription !== undefined) {
      updates.push(`style_description = $${paramIndex++}`);
      values.push(styleDescription);
    }
    
    if (color !== undefined) {
      updates.push(`color = $${paramIndex++}`);
      values.push(color || null);
    }
    
    if (fabricSupplier !== undefined) {
      updates.push(`fabric_supplier = $${paramIndex++}`);
      values.push(fabricSupplier || null);
    }
    
    if (styleCode !== undefined) {
      updates.push(`style_code = $${paramIndex++}`);
      values.push(styleCode || null);
    }
    
    if (lineNo !== undefined) {
      updates.push(`line_no = $${paramIndex++}`);
      values.push(lineNo || null);
    }
    
    if (runDate !== undefined) {
      updates.push(`run_date = $${paramIndex++}`);
      values.push(runDate || null);
    }
    
    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }
    
    updates.push(`updated_at = NOW()`);
    
    if (updates.length === 1) {
      return res.status(400).json({
        success: false,
        error: "No fields to update",
      });
    }
    
    values.push(id);
    
    const query = `
      UPDATE work_orders 
      SET ${updates.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING id, work_order_no, quantity, customer_name, style_description, status, updated_at
    `;
    
    const result = await client.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Work order not found",
      });
    }
    
    res.json({
      success: true,
      message: "Work order updated successfully",
      workOrder: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Error updating work order:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/work-orders/:id/status
 * Update work order status
 */
app.put("/api/work-orders/:id/status", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { id } = req.params;
    const { status } = req.body;
    
    const validStatuses = ['pending', 'assigned', 'in_progress', 'completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status. Must be one of: " + validStatuses.join(', '),
      });
    }
    
    const result = await client.query(
      `
      UPDATE work_orders
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, work_order_no, status
      `,
      [status, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Work order not found" });
    }
    
    res.json({
      success: true,
      message: "Work order status updated",
      workOrder: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Error updating work order status:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/work-orders/:id
 * Soft delete a work order
 */
app.delete("/api/work-orders/:id", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");
    
    const { id } = req.params;
    
    // Check if work order has active assignments
    const assignmentsCheck = await client.query(
      `
      SELECT id FROM line_assignments 
      WHERE work_order_id = $1 AND status IN ('planned', 'released', 'in_progress')
      `,
      [id]
    );
    
    if (assignmentsCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Cannot delete work order with active assignments. Cancel assignments first.",
      });
    }
    
    // Soft delete by setting status to 'cancelled'
    const result = await client.query(
      `
      UPDATE work_orders
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1 AND status != 'completed'
      RETURNING id, work_order_no
      `,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Work order not found or already completed",
      });
    }
    
    await client.query("COMMIT");
    
    res.json({
      success: true,
      message: "Work order cancelled successfully",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error cancelling work order:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ========== overview api endpoints ==========


/**
 * GET /api/skyrina/style-performance?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&style=xxx&lineNo=xxx
 * Returns style performance with SAM-based efficiency (most accurate)
 */
app.get("/api/skyrina/style-performance", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { startDate, endDate, style, lineNo } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        error: "startDate and endDate parameters required" 
      });
    }
    
    if (!['skyrina', 'engineer', 'supervisor', 'soporte_it', 'master'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: "Access denied" });
    }
    
    let query = `
      WITH style_packing_data AS (
        SELECT 
          lr.style,
          lr.sam_minutes,
          lr.operators_count,
          lr.working_hours,
          lr.target_pcs,
          lr.line_no,
          COALESCE(SUM(se.sewed_qty), 0) as total_sewed
        FROM line_runs lr
        JOIN run_operators ro ON lr.id = ro.run_id
        JOIN operator_operations oo ON ro.id = oo.run_operator_id
        LEFT JOIN operation_sewed_entries se ON oo.id = se.operation_id
        WHERE lr.run_date BETWEEN $1 AND $2
          AND (oo.operation_name ILIKE '%pack%' OR oo.operation_name ILIKE '%emp%')
    `;
    
    const params = [startDate, endDate];
    let paramIndex = 3;
    
    if (style && style !== 'all') {
      query += ` AND lr.style = $${paramIndex++}`;
      params.push(style);
    }
    
    if (lineNo && lineNo !== 'all') {
      query += ` AND lr.line_no = $${paramIndex++}`;
      params.push(lineNo);
    }
    
    query += `
        GROUP BY lr.id, lr.style, lr.sam_minutes, lr.operators_count, lr.working_hours, lr.target_pcs, lr.line_no
      )
      SELECT 
        style,
        SUM(total_sewed) as total_produced,
        SUM(target_pcs) as total_target,
        SUM(total_sewed * sam_minutes) as total_sam_output,
        SUM(operators_count * working_hours * 60) as total_available_minutes,
        -- SAM-based efficiency (most accurate)
        CASE 
          WHEN SUM(operators_count * working_hours * 60) > 0 
          THEN (SUM(total_sewed * sam_minutes) / SUM(operators_count * working_hours * 60)) * 100
          ELSE 0
        END as efficiency,
        -- Production compliance (for reference only)
        CASE 
          WHEN SUM(target_pcs) > 0 
          THEN (SUM(total_sewed) / SUM(target_pcs)) * 100 
          ELSE 0 
        END as compliance
      FROM style_packing_data
      GROUP BY style
      ORDER BY efficiency DESC
    `;
    
    const result = await client.query(query, params);
    
    const styles = result.rows.map(row => ({
      style: row.style || 'No Style',
      target: parseFloat(row.total_target) || 0,
      produced: parseFloat(row.total_produced) || 0,
      efficiency: parseFloat(row.efficiency) || 0,  // SAM-based efficiency
      compliance: parseFloat(row.compliance) || 0,  // Production compliance
      total_sam_output: parseFloat(row.total_sam_output) || 0,
      total_available_minutes: parseFloat(row.total_available_minutes) || 0
    }));
    
    res.json({
      success: true,
      period: { startDate, endDate },
      styles
    });
  } catch (err) {
    console.error("❌ Error fetching style performance:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/skyrina/line-performance-detail?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&style=xxx&lineNo=xxx
 * Returns line performance with SAM-based efficiency
 */
app.get("/api/skyrina/line-performance-detail", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { startDate, endDate, style, lineNo } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        error: "startDate and endDate parameters required" 
      });
    }
    
    if (!['skyrina', 'engineer', 'supervisor', 'soporte_it', 'master'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: "Access denied" });
    }
    
    let query = `
      WITH line_packing_data AS (
        SELECT 
          lr.style,
          lr.line_no,
          lr.sam_minutes,
          lr.operators_count,
          lr.working_hours,
          lr.target_pcs,
          COALESCE(SUM(se.sewed_qty), 0) as total_sewed
        FROM line_runs lr
        JOIN run_operators ro ON lr.id = ro.run_id
        JOIN operator_operations oo ON ro.id = oo.run_operator_id
        LEFT JOIN operation_sewed_entries se ON oo.id = se.operation_id
        WHERE lr.run_date BETWEEN $1 AND $2
          AND (oo.operation_name ILIKE '%pack%' OR oo.operation_name ILIKE '%emp%')
    `;
    
    const params = [startDate, endDate];
    let paramIndex = 3;
    
    if (style && style !== 'all') {
      query += ` AND lr.style = $${paramIndex++}`;
      params.push(style);
    }
    
    if (lineNo && lineNo !== 'all') {
      query += ` AND lr.line_no = $${paramIndex++}`;
      params.push(lineNo);
    }
    
    query += `
        GROUP BY lr.id, lr.style, lr.line_no, lr.sam_minutes, lr.operators_count, lr.working_hours, lr.target_pcs
      ),
      line_aggregates AS (
        SELECT
          style,
          line_no,
          SUM(total_sewed) as total_produced,
          SUM(target_pcs) as total_target,
          SUM(total_sewed * sam_minutes) as total_sam_output,
          SUM(operators_count * working_hours * 60) as total_available_minutes
        FROM line_packing_data
        GROUP BY style, line_no
      )
      SELECT 
        style,
        line_no,
        total_target as target,
        total_produced as produced,
        -- SAM-based efficiency
        CASE 
          WHEN total_available_minutes > 0 
          THEN (total_sam_output / total_available_minutes) * 100
          ELSE 0
        END as efficiency,
        -- Production compliance (for reference)
        CASE 
          WHEN total_target > 0 
          THEN (total_produced / total_target) * 100 
          ELSE 0 
        END as compliance
      FROM line_aggregates
      ORDER BY line_no::int, efficiency DESC
    `;
    
    const result = await client.query(query, params);
    
    const lines = result.rows.map(row => ({
      style: row.style || 'No Style',
      lineNo: row.line_no,
      target: Math.round(parseFloat(row.target) * 100) / 100,
      produced: Math.round(parseFloat(row.produced) * 100) / 100,
      efficiency: parseFloat(row.efficiency) || 0,  // SAM-based efficiency
      compliance: parseFloat(row.compliance) || 0   // Production compliance
    }));
    
    res.json({
      success: true,
      period: { startDate, endDate },
      lines
    });
  } catch (err) {
    console.error("❌ Error fetching line performance detail:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/skyrina/available-styles?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * Returns list of unique styles in the date range
 */
app.get("/api/skyrina/available-styles", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        error: "startDate and endDate parameters required" 
      });
    }
    
    const result = await client.query(
      `SELECT DISTINCT style FROM line_runs 
       WHERE run_date BETWEEN $1 AND $2 AND style IS NOT NULL AND style != ''
       ORDER BY style`,
      [startDate, endDate]
    );
    
    const styles = result.rows.map(row => row.style);
    
    res.json({
      success: true,
      styles
    });
  } catch (err) {
    console.error("❌ Error fetching available styles:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/skyrina/available-lines?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * Returns list of unique line numbers in the date range
 */
app.get("/api/skyrina/available-lines", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        error: "startDate and endDate parameters required" 
      });
    }
    
    // Fix: Cast line_no to integer in SELECT as well, or remove ORDER BY cast
    const result = await client.query(
      `SELECT DISTINCT line_no, line_no::int as line_no_int 
       FROM line_runs 
       WHERE run_date BETWEEN $1 AND $2 AND line_no IS NOT NULL
       ORDER BY line_no_int`,
      [startDate, endDate]
    );
    
    const lines = result.rows.map(row => row.line_no);
    
    res.json({
      success: true,
      lines
    });
  } catch (err) {
    console.error("❌ Error fetching available lines:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/skyrina/period-summary?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&style=xxx&lineNo=xxx
 * Returns aggregated summary for a date range with filters
 */
/**
 * GET /api/skyrina/period-summary?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&style=xxx&lineNo=xxx
 * Returns aggregated summary for a date range with CORRECT efficiency calculation
 * Uses weighted average based on total SAM output vs total available minutes
 */
app.get("/api/skyrina/period-summary", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { startDate, endDate, style, lineNo } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        error: "startDate and endDate parameters required" 
      });
    }
    
    if (!['master', 'skyrina', 'engineer', 'supervisor'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: "Access denied" });
    }
    
    let query = `
      WITH packing_sewed AS (
        SELECT 
          lr.id as run_id,
          lr.line_no,
          lr.target_pcs,
          lr.operators_count,
          lr.working_hours,
          lr.sam_minutes,
          COALESCE(SUM(se.sewed_qty), 0) as total_sewed
        FROM line_runs lr
        LEFT JOIN run_operators ro ON lr.id = ro.run_id
        LEFT JOIN operator_operations oo ON ro.id = oo.run_operator_id
        LEFT JOIN operation_sewed_entries se ON oo.id = se.operation_id
        WHERE lr.run_date BETWEEN $1 AND $2
          AND (oo.operation_name ILIKE '%pack%' OR oo.operation_name ILIKE '%emp%' OR oo.operation_name IS NULL)
    `;
    
    const params = [startDate, endDate];
    let paramIndex = 3;
    
    if (style && style !== 'all') {
      query += ` AND lr.style = $${paramIndex++}`;
      params.push(style);
    }
    
    if (lineNo && lineNo !== 'all') {
      query += ` AND lr.line_no = $${paramIndex++}`;
      params.push(lineNo);
    }
    
    query += `
        GROUP BY lr.id, lr.line_no, lr.target_pcs, lr.operators_count, lr.working_hours, lr.sam_minutes
      )
      SELECT 
        COUNT(DISTINCT run_id) as total_runs,
        COUNT(DISTINCT line_no) as lines_used,
        COALESCE(SUM(total_sewed), 0) as total_sewed,
        COALESCE(SUM(target_pcs), 0) as total_target,
        -- CORRECT EFFICIENCY: Total SAM output / Total available minutes (NO ROUNDING)
        CASE 
          WHEN SUM(operators_count * working_hours * 60) > 0 
          THEN (SUM(total_sewed * sam_minutes) / SUM(operators_count * working_hours * 60)) * 100
          ELSE 0
        END as avg_efficiency
      FROM packing_sewed
    `;
    
    const result = await client.query(query, params);
    
    const summary = result.rows[0] || {
      total_runs: 0,
      lines_used: 0,
      total_sewed: 0,
      total_target: 0,
      avg_efficiency: 0
    };
    
    const avgEfficiency = parseFloat(summary.avg_efficiency) || 0;
    
    res.json({
      success: true,
      period: { startDate, endDate },
      summary: {
        totalRuns: parseInt(summary.total_runs) || 0,
        linesUsed: parseInt(summary.lines_used) || 0,
        totalTarget: parseFloat(summary.total_target) || 0,  // NO ROUNDING
        totalSewed: parseFloat(summary.total_sewed) || 0,    // NO ROUNDING
        avgEfficiency: avgEfficiency  // NO ROUNDING - keep exact value
      }
    });
  } catch (err) {
    console.error("❌ Error fetching period summary:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/skyrina/product-breakdown?date=YYYY-MM-DD
 * Returns product (style) breakdown with sewed quantities for a specific date
 */
app.get("/api/skyrina/product-breakdown", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, error: "date parameter required" });
    }
    
    // Check if user has access
    if (!['master', 'skyrina', 'engineer', 'supervisor'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: "Access denied" });
    }
    
    const query = `
      SELECT 
        lr.style,
        COALESCE(SUM(se.sewed_qty), 0) as sewed,
        lr.target_pcs as target,
        lr.line_no
      FROM line_runs lr
      JOIN run_operators ro ON lr.id = ro.run_id
      JOIN operator_operations oo ON ro.id = oo.run_operator_id
      LEFT JOIN operation_sewed_entries se ON oo.id = se.operation_id
      WHERE lr.run_date = $1
        AND (oo.operation_name ILIKE '%pack%' OR oo.operation_name ILIKE '%emp%')
      GROUP BY lr.id, lr.style, lr.target_pcs, lr.line_no
      ORDER BY sewed DESC
    `;
    
    const result = await client.query(query, [date]);
    
    // Group by style (in case same style runs on multiple lines)
    const styleMap = new Map();
    
    for (const row of result.rows) {
      const style = row.style || 'Sin Estilo';
      const current = styleMap.get(style) || { 
        style, 
        sewed: 0, 
        target: 0
      };
      
      current.sewed += parseFloat(row.sewed) || 0;
      current.target += parseFloat(row.target) || 0;
      
      styleMap.set(style, current);
    }
    
    const products = Array.from(styleMap.values())
      .sort((a, b) => b.sewed - a.sewed);
    
    res.json({
      success: true,
      date,
      products,
      totalProducts: products.length
    });
  } catch (err) {
    console.error("❌ Error fetching product breakdown:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});
// Add this new endpoint in server.js (before the period-summary endpoint)

/**
 * GET /api/skyrina/line-efficiency?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&style=xxx&lineNo=xxx
 * Returns per-line efficiency calculated with SAM formula (server-side) with filters
 */
app.get("/api/skyrina/line-efficiency", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { startDate, endDate, style, lineNo } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        error: "startDate and endDate parameters required" 
      });
    }
    
    if (!['master', 'skyrina', 'engineer', 'supervisor'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: "Access denied" });
    }
    
    let query = `
      WITH packing_sewed AS (
        SELECT 
          lr.id as run_id,
          lr.line_no,
          lr.operators_count,
          lr.working_hours,
          lr.sam_minutes,
          lr.target_pcs,
          COALESCE(SUM(se.sewed_qty), 0) as total_sewed
        FROM line_runs lr
        LEFT JOIN run_operators ro ON lr.id = ro.run_id
        LEFT JOIN operator_operations oo ON ro.id = oo.run_operator_id
        LEFT JOIN operation_sewed_entries se ON oo.id = se.operation_id
        WHERE lr.run_date BETWEEN $1 AND $2
          AND (oo.operation_name ILIKE '%pack%' OR oo.operation_name ILIKE '%emp%' OR oo.operation_name IS NULL)
    `;
    
    const params = [startDate, endDate];
    let paramIndex = 3;
    
    if (style && style !== 'all') {
      query += ` AND lr.style = $${paramIndex++}`;
      params.push(style);
    }
    
    if (lineNo && lineNo !== 'all') {
      query += ` AND lr.line_no = $${paramIndex++}`;
      params.push(lineNo);
    }
    
    query += `
        GROUP BY lr.id, lr.line_no, lr.operators_count, lr.working_hours, lr.sam_minutes, lr.target_pcs
      ),
      line_aggregates AS (
        SELECT
          line_no,
          SUM(total_sewed) as total_sewed,
          SUM(target_pcs) as total_target,
          SUM(operators_count * working_hours * 60) as total_available_minutes,
          SUM(total_sewed * sam_minutes) as total_sam_output
        FROM packing_sewed
        GROUP BY line_no
      )
      SELECT 
        line_no,
        total_sewed as quantity,
        total_target as target,
        CASE 
          WHEN total_available_minutes > 0 
          THEN (total_sam_output / total_available_minutes) * 100
          ELSE 0
        END as efficiency
      FROM line_aggregates
      ORDER BY line_no::int
    `;
    
    const result = await client.query(query, params);
    
    const lines = result.rows.map(row => ({
      lineNo: row.line_no,
      quantity: parseFloat(row.quantity) || 0,
      target: parseFloat(row.target) || 0,
      efficiency: parseFloat(row.efficiency) || 0  // NO ROUNDING - keep exact value
    }));
    
    res.json({
      success: true,
      period: { startDate, endDate },
      lines
    });
  } catch (err) {
    console.error("❌ Error fetching line efficiency:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});
/**
 * GET /api/skyrina/style-efficiency-sam?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&style=xxx&lineNo=xxx
 * Returns style efficiency calculated using SAM (standard allowed minutes)
 * This is more accurate than production compliance
 */
app.get("/api/skyrina/style-efficiency-sam", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { startDate, endDate, style, lineNo } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        error: "startDate and endDate parameters required" 
      });
    }
    
    if (!['master', 'skyrina', 'engineer', 'supervisor'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: "Access denied" });
    }
    
    let query = `
      WITH style_packing_data AS (
        SELECT 
          lr.style,
          lr.sam_minutes,
          lr.operators_count,
          lr.working_hours,
          lr.target_pcs,
          lr.line_no,
          COALESCE(SUM(se.sewed_qty), 0) as total_sewed
        FROM line_runs lr
        JOIN run_operators ro ON lr.id = ro.run_id
        JOIN operator_operations oo ON ro.id = oo.run_operator_id
        LEFT JOIN operation_sewed_entries se ON oo.id = se.operation_id
        WHERE lr.run_date BETWEEN $1 AND $2
          AND (oo.operation_name ILIKE '%pack%' OR oo.operation_name ILIKE '%emp%')
    `;
    
    const params = [startDate, endDate];
    let paramIndex = 3;
    
    if (style && style !== 'all') {
      query += ` AND lr.style = $${paramIndex++}`;
      params.push(style);
    }
    
    if (lineNo && lineNo !== 'all') {
      query += ` AND lr.line_no = $${paramIndex++}`;
      params.push(lineNo);
    }
    
    query += `
        GROUP BY lr.id, lr.style, lr.sam_minutes, lr.operators_count, lr.working_hours, lr.target_pcs, lr.line_no
      )
      SELECT 
        style,
        SUM(total_sewed) as total_produced,
        SUM(target_pcs) as total_target,
        SUM(total_sewed * sam_minutes) as total_sam_output,
        SUM(operators_count * working_hours * 60) as total_available_minutes,
        CASE 
          WHEN SUM(operators_count * working_hours * 60) > 0 
          THEN (SUM(total_sewed * sam_minutes) / SUM(operators_count * working_hours * 60)) * 100
          ELSE 0
        END as efficiency,
        CASE 
          WHEN SUM(target_pcs) > 0 
          THEN (SUM(total_sewed) / SUM(target_pcs)) * 100 
          ELSE 0 
        END as compliance
      FROM style_packing_data
      GROUP BY style
      ORDER BY efficiency DESC
    `;
    
    const result = await client.query(query, params);
    
    const styles = result.rows.map(row => ({
      style: row.style || 'No Style',
      target: parseFloat(row.total_target) || 0,
      produced: parseFloat(row.total_produced) || 0,
      efficiency: parseFloat(row.efficiency) || 0,  // SAM-based efficiency
      compliance: parseFloat(row.compliance) || 0,  // Production compliance
      total_sam_output: parseFloat(row.total_sam_output) || 0,
      total_available_minutes: parseFloat(row.total_available_minutes) || 0
    }));
    
    res.json({
      success: true,
      period: { startDate, endDate },
      styles
    });
  } catch (err) {
    console.error("❌ Error fetching style efficiency (SAM):", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});
/**
 * GET /api/skyrina/line-performance-detail?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * Returns line performance with style, target, produced, and compliance
 */
app.get("/api/skyrina/line-performance-detail", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        error: "startDate and endDate parameters required" 
      });
    }
    
    // Check if user has access
    if (!['master', 'skyrina', 'engineer', 'supervisor'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: "Access denied" });
    }
    
    const query = `
      WITH line_data AS (
        SELECT 
          lr.style,
          lr.line_no,
          lr.target_pcs as target,
          COALESCE(SUM(se.sewed_qty), 0) as produced,
          lr.run_date
        FROM line_runs lr
        JOIN run_operators ro ON lr.id = ro.run_id
        JOIN operator_operations oo ON ro.id = oo.run_operator_id
        LEFT JOIN operation_sewed_entries se ON oo.id = se.operation_id
        WHERE lr.run_date BETWEEN $1 AND $2
          AND (oo.operation_name ILIKE '%pack%' OR oo.operation_name ILIKE '%emp%' OR oo.operation_name IS NULL)
        GROUP BY lr.id, lr.style, lr.line_no, lr.target_pcs, lr.run_date
      )
      SELECT 
        style,
        line_no,
        SUM(target) as total_target,
        SUM(produced) as total_produced,
        CASE 
          WHEN SUM(target) > 0 
          THEN (SUM(produced) / SUM(target)) * 100 
          ELSE 0 
        END as compliance
      FROM line_data
      GROUP BY style, line_no
      ORDER BY line_no::int, total_produced DESC
    `;
    
    const result = await client.query(query, [startDate, endDate]);
    
    const lines = result.rows.map(row => ({
      style: row.style || 'Sin Estilo',
      lineNo: row.line_no,
      target: Math.round(parseFloat(row.total_target) * 100) / 100,
      produced: Math.round(parseFloat(row.total_produced) * 100) / 100,
      compliance: Math.min(Math.round(parseFloat(row.compliance) * 100) / 100, 100)
    }));
    
    res.json({
      success: true,
      period: { startDate, endDate },
      lines
    });
  } catch (err) {
    console.error("❌ Error fetching line performance detail:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/skyrina/product-performance?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * Returns product performance with style, target, produced, and compliance
 */
app.get("/api/skyrina/product-performance", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        error: "startDate and endDate parameters required" 
      });
    }
    
    // Check if user has access
    if (!['skyrina', 'engineer', 'supervisor', 'soporte_it', 'master'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: "Access denied" });
    }
    
    const query = `
      WITH product_data AS (
        SELECT 
          lr.style,
          lr.target_pcs as target,
          COALESCE(SUM(se.sewed_qty), 0) as produced,
          lr.line_no,
          lr.run_date
        FROM line_runs lr
        JOIN run_operators ro ON lr.id = ro.run_id
        JOIN operator_operations oo ON ro.id = oo.run_operator_id
        LEFT JOIN operation_sewed_entries se ON oo.id = se.operation_id
        WHERE lr.run_date BETWEEN $1 AND $2
          AND (oo.operation_name ILIKE '%pack%' OR oo.operation_name ILIKE '%emp%' OR oo.operation_name IS NULL)
        GROUP BY lr.id, lr.style, lr.target_pcs, lr.line_no, lr.run_date
      )
      SELECT 
        style,
        SUM(target) as total_target,
        SUM(produced) as total_produced,
        CASE 
          WHEN SUM(target) > 0 
          THEN (SUM(produced) / SUM(target)) * 100 
          ELSE 0 
        END as compliance
      FROM product_data
      GROUP BY style
      ORDER BY total_produced DESC
    `;
    
    const result = await client.query(query, [startDate, endDate]);
    
    const products = result.rows.map(row => ({
      style: row.style || 'Sin Estilo',
      target: Math.round(parseFloat(row.total_target) * 100) / 100,
      produced: Math.round(parseFloat(row.total_produced) * 100) / 100,
      compliance: Math.min(Math.round(parseFloat(row.compliance) * 100) / 100, 100)
    }));
    
    res.json({
      success: true,
      period: { startDate, endDate },
      products
    });
  } catch (err) {
    console.error("❌ Error fetching product performance:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// Add this endpoint to your server.js (without validate)
// ========== BATCH ENDPOINT FOR SKYRINA DASHBOARD ==========
app.post(
  "/api/batch/line-runs-data",
  authenticateToken,
  async (req, res) => {
    const client = await pool.connect();
    try {
      await setSchema(client);
      
      const { lines, date } = req.body;
      
      // Validate inputs manually
      if (!lines || !Array.isArray(lines)) {
        return res.status(400).json({ success: false, error: "lines array required" });
      }
      if (!date) {
        return res.status(400).json({ success: false, error: "date required" });
      }
      
      const results = {};
      
      for (const lineNo of lines) {
        // Get runs for this line
        const runsResult = await client.query(
          `SELECT id, line_no, run_date, style, operators_count, working_hours, sam_minutes,
                  efficiency, target_pcs, target_per_hour, created_at
           FROM line_runs
           WHERE line_no = $1 AND run_date = $2
           ORDER BY run_date DESC`,
          [lineNo, date]
        );
        
        const lineRuns = [];
        
        for (const run of runsResult.rows) {
          // Get full run data
          const runData = await getFullRunDataBatch(client, run.id);
          lineRuns.push({
            ...run,
            runData
          });
        }
        
        results[lineNo] = lineRuns;
      }
      
      res.json({ success: true, data: results });
    } catch (err) {
      console.error("❌ Error in batch endpoint:", err.message);
      res.status(500).json({ success: false, error: err.message });
    } finally {
      client.release();
    }
  }
);

// Helper function for batch endpoint (different name to avoid conflict)
async function getFullRunDataBatch(client, runId) {
  // Get slots
  const slotsResult = await client.query(
    "SELECT id, slot_order, slot_label, slot_start, slot_end, planned_hours FROM shift_slots WHERE run_id = $1 ORDER BY slot_order",
    [runId]
  );
  
  // Get operators
  const operatorsResult = await client.query(
    "SELECT id, operator_no, operator_name FROM run_operators WHERE run_id = $1 ORDER BY operator_no",
    [runId]
  );
  
  // Get slot targets
  const slotTargetsResult = await client.query(
    `SELECT s.slot_label, t.slot_target, t.cumulative_target
     FROM slot_targets t
     JOIN shift_slots s ON t.slot_id = s.id
     WHERE t.run_id = $1
     ORDER BY s.slot_order`,
    [runId]
  );
  
  // Get operations with their data
  const operationsData = [];
  for (const operator of operatorsResult.rows) {
    const operationsResult = await client.query(
      `SELECT 
        o.id,
        o.operation_name,
        o.t1_sec,
        o.t2_sec,
        o.t3_sec,
        o.t4_sec,
        o.t5_sec,
        o.capacity_per_hour,
        COALESCE(
          jsonb_object_agg(
            COALESCE(s.slot_label, ''),
            COALESCE(h.stitched_qty, 0)
          ) FILTER (WHERE s.slot_label IS NOT NULL),
          '{}'::jsonb
        ) as stitched_data,
        COALESCE(
          jsonb_object_agg(
            COALESCE(s2.slot_label, ''),
            COALESCE(se.sewed_qty, 0)
          ) FILTER (WHERE s2.slot_label IS NOT NULL),
          '{}'::jsonb
        ) as sewed_data
       FROM operator_operations o
       LEFT JOIN operation_hourly_entries h ON o.id = h.operation_id
       LEFT JOIN shift_slots s ON h.slot_id = s.id
       LEFT JOIN operation_sewed_entries se ON o.id = se.operation_id
       LEFT JOIN shift_slots s2 ON se.slot_id = s2.id
       WHERE o.run_operator_id = $1 AND o.run_id = $2
       GROUP BY o.id
       ORDER BY o.created_at`,
      [operator.id, runId]
    );
    
    operationsData.push({
      operator,
      operations: operationsResult.rows,
    });
  }
  
  return {
    slots: slotsResult.rows,
    operators: operatorsResult.rows,
    operations: operationsData,
    slotTargets: slotTargetsResult.rows,
  };
}

// Add the helper function getFullRunData


// Helper function to get full run data
async function getFullRunData(client, runId) {
  // Get slots
  const slotsResult = await client.query(
    "SELECT id, slot_order, slot_label, slot_start, slot_end, planned_hours FROM shift_slots WHERE run_id = $1 ORDER BY slot_order",
    [runId]
  );
  
  // Get operators
  const operatorsResult = await client.query(
    "SELECT id, operator_no, operator_name FROM run_operators WHERE run_id = $1 ORDER BY operator_no",
    [runId]
  );
  
  // Get slot targets
  const slotTargetsResult = await client.query(
    `SELECT s.slot_label, t.slot_target, t.cumulative_target
     FROM slot_targets t
     JOIN shift_slots s ON t.slot_id = s.id
     WHERE t.run_id = $1
     ORDER BY s.slot_order`,
    [runId]
  );
  
  // Get operations with their data
  const operationsData = [];
  for (const operator of operatorsResult.rows) {
    const operationsResult = await client.query(
      `SELECT 
        o.id,
        o.operation_name,
        o.t1_sec,
        o.t2_sec,
        o.t3_sec,
        o.t4_sec,
        o.t5_sec,
        o.capacity_per_hour,
        COALESCE(
          jsonb_object_agg(
            COALESCE(s.slot_label, ''),
            COALESCE(h.stitched_qty, 0)
          ) FILTER (WHERE s.slot_label IS NOT NULL),
          '{}'::jsonb
        ) as stitched_data,
        COALESCE(
          jsonb_object_agg(
            COALESCE(s2.slot_label, ''),
            COALESCE(se.sewed_qty, 0)
          ) FILTER (WHERE s2.slot_label IS NOT NULL),
          '{}'::jsonb
        ) as sewed_data
       FROM operator_operations o
       LEFT JOIN operation_hourly_entries h ON o.id = h.operation_id
       LEFT JOIN shift_slots s ON h.slot_id = s.id
       LEFT JOIN operation_sewed_entries se ON o.id = se.operation_id
       LEFT JOIN shift_slots s2 ON se.slot_id = s2.id
       WHERE o.run_operator_id = $1 AND o.run_id = $2
       GROUP BY o.id
       ORDER BY o.created_at`,
      [operator.id, runId]
    );
    
    operationsData.push({
      operator,
      operations: operationsResult.rows,
    });
  }
  
  return {
    slots: slotsResult.rows,
    operators: operatorsResult.rows,
    operations: operationsData,
    slotTargets: slotTargetsResult.rows,
  };
}
// --------------------------------------------------------------
// update-working-hours (FIXED)
// --------------------------------------------------------------

// ✅ Update working hours for a run and recalculate target
app.put("/api/update-working-hours/:runId", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId } = req.params;
    const { workingHours } = req.body;

    if (!workingHours || workingHours <= 0) {
      return res.status(400).json({
        success: false,
        error: "Valid working hours are required",
      });
    }

    // Get current run data
    const runResult = await client.query(
      `SELECT operators_count, sam_minutes, efficiency, target_pcs, target_per_hour
       FROM line_runs WHERE id = $1`,
      [runId]
    );

    if (runResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Run not found",
      });
    }

    const run = runResult.rows[0];
    
    // Recalculate target based on new working hours
    const operators = parseFloat(run.operators_count) || 0;
    const sam = parseFloat(run.sam_minutes) || 0;
    const efficiency = parseFloat(run.efficiency) || 0.7;
    const wh = parseFloat(workingHours);

    // Calculate new target
    const totalMinutes = operators * wh * 60;
    const piecesAt100 = sam > 0 ? totalMinutes / sam : 0;
    const newTarget = piecesAt100 * efficiency;
    
    // Calculate new target per hour
    const newTargetPerHour = wh > 0 ? newTarget / wh : 0;

    // Update the run with new working hours and recalculated targets
    await client.query(
      `UPDATE line_runs 
       SET working_hours = $1, 
           target_pcs = $2,
           target_per_hour = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [wh, newTarget, newTargetPerHour, runId]
    );

    // Also update slot targets (redistribute target across slots proportionally)
    const slotsResult = await client.query(
      `SELECT id, planned_hours FROM shift_slots WHERE run_id = $1 ORDER BY slot_order`,
      [runId]
    );

    if (slotsResult.rows.length > 0) {
      const totalPlannedHours = slotsResult.rows.reduce((sum, slot) => sum + parseFloat(slot.planned_hours), 0);
      
      let cumulativeTarget = 0;
      for (const slot of slotsResult.rows) {
        const slotHours = parseFloat(slot.planned_hours);
        const slotTarget = totalPlannedHours > 0 ? (slotHours / totalPlannedHours) * newTarget : 0;
        cumulativeTarget += slotTarget;

        await client.query(
          `UPDATE slot_targets 
           SET slot_target = $1, cumulative_target = $2, updated_at = NOW()
           WHERE run_id = $3 AND slot_id = $4`,
          [slotTarget, cumulativeTarget, runId, slot.id]
        );
      }
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Working hours updated successfully",
      newTarget,
      newTargetPerHour,
      workingHours: wh
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error updating working hours:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Delete a line run and all associated data
app.delete("/api/run/:runId", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId } = req.params;

    // Check if run exists
    const runCheck = await client.query(
      "SELECT id, line_no, run_date FROM line_runs WHERE id = $1",
      [runId]
    );

    if (runCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        error: "Run not found",
      });
    }

    const run = runCheck.rows[0];

    // Check if user has permission to delete (engineer, supervisor, master, soporte_it)
    const allowedRoles = ['engineer', 'supervisor', 'master', 'soporte_it'];
    if (!allowedRoles.includes(req.user.role)) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        success: false,
        error: "Access denied. Only engineers, supervisors, or support can delete runs.",
      });
    }

    // Delete the run (CASCADE will handle all related data)
    await client.query("DELETE FROM line_runs WHERE id = $1", [runId]);

    await client.query("COMMIT");

    console.log(`✅ Run ${runId} (Line ${run.line_no}, ${run.run_date}) deleted by user ${req.user.username}`);

    res.json({
      success: true,
      message: `Run from line ${run.line_no} on ${run.run_date} deleted successfully`,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error deleting run:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ========== add / delete operator ==========

app.post("/api/run/:runId/operators", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId } = req.params;
    const { operatorNo, operatorName } = req.body;

    if (!operatorNo) {
      return res.status(400).json({
        success: false,
        error: "Operator number is required",
      });
    }

    // Check if operator already exists in this run
    const existingOp = await client.query(
      `SELECT id FROM run_operators 
       WHERE run_id = $1 AND operator_no = $2`,
      [runId, parseInt(operatorNo)]
    );

    if (existingOp.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Operator ${operatorNo} already exists in this run`,
      });
    }

    // Insert new operator
    const result = await client.query(
      `INSERT INTO run_operators (run_id, operator_no, operator_name, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, operator_no, operator_name`,
      [runId, parseInt(operatorNo), operatorName || null]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Operator ${operatorNo} added successfully`,
      operator: result.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error adding operator:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Delete an operator from an existing run
app.delete("/api/run/:runId/operators/:operatorId", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId, operatorId } = req.params;

    // Check if operator exists and belongs to this run
    const operatorCheck = await client.query(
      `SELECT id, operator_no FROM run_operators 
       WHERE id = $1 AND run_id = $2`,
      [operatorId, runId]
    );

    if (operatorCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Operator not found in this run",
      });
    }

    const operatorNo = operatorCheck.rows[0].operator_no;

    // Delete operator (cascades to operations and hourly entries due to foreign keys)
    await client.query(
      `DELETE FROM run_operators WHERE id = $1`,
      [operatorId]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Operator ${operatorNo} deleted successfully`,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error deleting operator:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});



// ✅ Get all operators for a run (with their operations count)
app.get("/api/run/:runId/operators", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { runId } = req.params;

    const result = await client.query(
      `SELECT 
        ro.id,
        ro.operator_no,
        ro.operator_name,
        ro.created_at,
        COUNT(oo.id) as operations_count
       FROM run_operators ro
       LEFT JOIN operator_operations oo ON ro.id = oo.run_operator_id
       WHERE ro.run_id = $1
       GROUP BY ro.id
       ORDER BY ro.operator_no`,
      [runId]
    );

    res.json({
      success: true,
      operators: result.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching operators:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ========== ENGINEER LINE BALANCING ==========

const requireEngineer = (req, res, next) => {
  if (req.user.role !== "engineer") {
    return res.status(403).json({
      success: false,
      error: "Access denied. Engineer role required.",
    });
  }
  next();
};

// ========== ENGINEER LINE BALANCING ==========

/**
 * GET /api/engineer/line-balancing/:runId
 * Returns line run details and operator capacities for balancing
 */
app.get("/api/engineer/line-balancing/:runId", authenticateToken, requireEngineer, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    const { runId } = req.params;

    // 1. Run details (including target_per_hour)
    const runRes = await client.query(
      `SELECT id, line_no, target_per_hour, working_hours, operators_count
       FROM line_runs WHERE id = $1`,
      [runId]
    );
    if (runRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Run not found" });
    }
    const run = runRes.rows[0];

    // 2. Operators with their operations and capacities
    const opsRes = await client.query(
      `SELECT
          ro.id AS operator_id,
          ro.operator_no,
          ro.operator_name,
          oo.id AS operation_id,
          oo.operation_name,
          oo.capacity_per_hour,
          -- average cycle time in seconds from t1..t5
          (COALESCE(oo.t1_sec,0) + COALESCE(oo.t2_sec,0) + COALESCE(oo.t3_sec,0) + COALESCE(oo.t4_sec,0) + COALESCE(oo.t5_sec,0))
          / NULLIF(
            (CASE WHEN oo.t1_sec IS NOT NULL THEN 1 ELSE 0 END +
             CASE WHEN oo.t2_sec IS NOT NULL THEN 1 ELSE 0 END +
             CASE WHEN oo.t3_sec IS NOT NULL THEN 1 ELSE 0 END +
             CASE WHEN oo.t4_sec IS NOT NULL THEN 1 ELSE 0 END +
             CASE WHEN oo.t5_sec IS NOT NULL THEN 1 ELSE 0 END), 0
          ) AS avg_cycle_sec
       FROM run_operators ro
       JOIN operator_operations oo ON ro.id = oo.run_operator_id
       WHERE ro.run_id = $1
       ORDER BY ro.operator_no, oo.id`,
      [runId]
    );

    // 3. Group by operator
    const operators = [];
    const operatorMap = new Map();
    for (const row of opsRes.rows) {
      if (!operatorMap.has(row.operator_id)) {
        operatorMap.set(row.operator_id, {
          operator_id: row.operator_id,
          operator_no: row.operator_no,
          operator_name: row.operator_name,
          operations: []
        });
        operators.push(operatorMap.get(row.operator_id));
      }
      operatorMap.get(row.operator_id).operations.push({
        operation_id: row.operation_id,
        operation_name: row.operation_name,
        capacity_per_hour: Number(row.capacity_per_hour),
        avg_cycle_sec: Number(row.avg_cycle_sec)
      });
    }

    res.json({
      success: true,
      run,
      operators
    });
  } catch (err) {
    console.error("❌ /api/engineer/line-balancing error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/engineer/line-balancing/:runId/assign
 * Save balancing assignments (fast operators helping slow ones)
 */
app.post("/api/engineer/line-balancing/:runId/assign", authenticateToken, requireEngineer, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");
    const { runId } = req.params;
    const { assignments } = req.body; // array of { sourceOperatorId, targetOperatorId, operationId, assignedQtyPerHour }

    for (const a of assignments) {
      await client.query(
        `INSERT INTO line_balancing_assignments
           (run_id, source_operator_id, target_operator_id, operation_id, assigned_quantity_per_hour)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (run_id, source_operator_id, target_operator_id, operation_id)
         DO UPDATE SET assigned_quantity_per_hour = EXCLUDED.assigned_quantity_per_hour,
                       updated_at = NOW()`,
        [runId, a.sourceOperatorId, a.targetOperatorId, a.operationId, a.assignedQtyPerHour]
      );
    }

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ /api/engineer/line-balancing/assign error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});
// ========== LINE LEADER ASSIGNMENTS ==========

/**
 * GET /api/lineleader/assignments/:runId
 * Returns balancing assignments for a specific run (for line leader view)
 */
app.get("/api/lineleader/assignments/:runId", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    const { runId } = req.params;

    const query = `
      SELECT 
        lba.id,
        lba.source_operator_id,
        lba.target_operator_id,
        lba.operation_id,
        lba.assigned_quantity_per_hour,
        source.operator_no AS source_operator_no,
        source.operator_name AS source_operator_name,
        target.operator_no AS target_operator_no,
        target.operator_name AS target_operator_name,
        oo.operation_name
      FROM line_balancing_assignments lba
      JOIN run_operators source ON lba.source_operator_id = source.id
      JOIN run_operators target ON lba.target_operator_id = target.id
      JOIN operator_operations oo ON lba.operation_id = oo.id
      WHERE lba.run_id = $1
      ORDER BY source.operator_no, target.operator_no;
    `;
    const result = await client.query(query, [runId]);
    res.json({ success: true, assignments: result.rows });
  } catch (err) {
    console.error("❌ Error fetching lineleader assignments:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});


// ========== SUPERVISOR ASSIGNMENTS ==========

/**
 * GET /api/supervisor/assignments?date=YYYY-MM-DD
 * Returns aggregated assignments for a given date (total pieces helped = assigned_qty_per_hour * working_hours)
 */
app.get("/api/supervisor/assignments", authenticateToken, requireSupervisor, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, error: "date parameter required" });
    }

    const query = `
      SELECT 
        lr.line_no,
        lba.source_operator_id,
        lba.target_operator_id,
        lba.assigned_quantity_per_hour,
        lr.working_hours,
        (lba.assigned_quantity_per_hour * lr.working_hours) AS total_helped_pieces,
        source.operator_no AS source_operator_no,
        source.operator_name AS source_operator_name,
        target.operator_no AS target_operator_no,
        target.operator_name AS target_operator_name
      FROM line_balancing_assignments lba
      JOIN line_runs lr ON lba.run_id = lr.id
      JOIN run_operators source ON lba.source_operator_id = source.id
      JOIN run_operators target ON lba.target_operator_id = target.id
      WHERE lr.run_date = $1
      ORDER BY lr.line_no, source.operator_no, target.operator_no;
    `;
    const result = await client.query(query, [date]);
    res.json({ success: true, assignments: result.rows });
  } catch (err) {
    console.error("❌ Error fetching supervisor assignments:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});



// ✅ Health check
app.get("/api/health", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("SELECT 1");
    res.json({
      success: true,
      message: "Server and database are running",
      schema: "prod_db_schema",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "Database connection failed",
    });
  } finally {
    client.release();
  }
});

// ✅ Reset/clear all data (for testing)
app.post("/api/reset-database", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    // Delete in correct order (respecting foreign keys)
    await client.query("DELETE FROM operation_sewed_entries");
    await client.query("DELETE FROM operation_hourly_entries");
    await client.query("DELETE FROM slot_targets");
    await client.query("DELETE FROM operator_operations");
    await client.query("DELETE FROM run_operators");
    await client.query("DELETE FROM shift_slots");
    await client.query("DELETE FROM line_runs");

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Database cleared successfully in prod_db_schema",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error resetting database:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// Initialize database connection
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log("✅ Connected to PostgreSQL successfully");

    await setSchema(client);

    const res = await client.query("SELECT current_schema(), current_database()");
    console.log("📋 Schema:", res.rows[0].current_schema);
    console.log("📋 Database:", res.rows[0].current_database);
    console.log("🕒 Server time:", new Date());

    // Create all tables after connection
    await createAllTables();

    client.release();
  } catch (err) {
    console.error("❌ Database connection failed");
    console.error(err.message);
  }
}

testConnection();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📁 Using schema: prod_db_schema`);
  console.log(`🗄️ Database: ${process.env.PG_DB || "prod_db"}`);
});

setInterval(() => {
  console.log("🟢 Server running, DB pool alive");
}, 30000);