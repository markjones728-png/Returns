const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { STATUSES } = require('./utils/constants');

// PERSIST_DIR lets this point at a mounted persistent disk in production
// (e.g. on Render) so the database survives restarts/redeploys. Locally it
// just defaults to this project's own "data" folder.
const PERSIST_DIR = process.env.PERSIST_DIR || __dirname;
const DB_PATH = path.join(PERSIST_DIR, 'data', 'returns.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT UNIQUE NOT NULL,
    company_name TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    equipment_type TEXT NOT NULL,
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    serial_number TEXT NOT NULL,
    fault_description TEXT NOT NULL,
    collection_address TEXT NOT NULL DEFAULT '',
    collection_hours TEXT NOT NULL DEFAULT '',
    premises_type TEXT NOT NULL DEFAULT '',
    courier_contact_number TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Return Submitted',
    staff_notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS return_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    kind TEXT NOT NULL,
    uploaded_by TEXT NOT NULL DEFAULT 'customer',
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (return_id) REFERENCES returns(id)
  );

  CREATE TABLE IF NOT EXISTS return_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    changed_by TEXT NOT NULL,
    note TEXT DEFAULT '',
    changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (return_id) REFERENCES returns(id)
  );

  CREATE TABLE IF NOT EXISTS invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    token TEXT UNIQUE NOT NULL,
    invited_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    accepted_at TEXT
  );
`);

// --- Lightweight migrations: add any columns that don't exist yet on an  ---
// --- already-created database, so upgrading the app never wipes data.   ---
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = cols.some((c) => c.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('returns', 'collection_address', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'collection_hours', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'premises_type', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'courier_contact_number', "TEXT NOT NULL DEFAULT ''");

// --- Roger Technology "Request for Authorisation to Return Product for   ---
// --- Inspection" fields, filled in by the returns engineer in two       ---
// --- stages: on receipt/inspection, and after testing.                  ---
ensureColumn('returns', 'insp_application_type', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'insp_product_type', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'insp_dimensions', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'insp_weight', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'insp_install_date', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'insp_product_code', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'insp_quantity', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'insp_plate_p_code', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'insp_plate_voltage', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'insp_plate_batch', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'insp_plate_in', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'insp_plate_pm', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'insp_guarantee_status', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'insp_problem_by_client', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'insp_problem_by_dealer', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'insp_action_suggested', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'insp_repairable', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'insp_request_type', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'insp_completed_by', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'insp_completed_at', "TEXT");
ensureColumn('returns', 'test_result', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'test_notes', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'test_completed_by', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'test_completed_at', "TEXT");
ensureColumn('returns', 'manufacturer_rma_number', "TEXT NOT NULL DEFAULT ''");
ensureColumn('returns', 'rta_rt_number', "TEXT NOT NULL DEFAULT ''");

// Seed a default admin user if no users exist yet
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const defaultUsername = process.env.DEFAULT_ADMIN_USER || 'admin';
  const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'ChangeMe123!';
  const hash = bcrypt.hashSync(defaultPassword, 10);
  db.prepare(
    'INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)'
  ).run(defaultUsername, hash, 'Administrator', 'admin');
  console.log(`Seeded default staff login -> username: "${defaultUsername}" password: "${defaultPassword}" (change this after first login!)`);
}

function nextReference() {
  const year = new Date().getFullYear();
  const row = db.prepare(
    `SELECT COUNT(*) AS c FROM returns WHERE reference LIKE ?`
  ).get(`RT-${year}-%`);
  const seq = String(row.c + 1).padStart(4, '0');
  return `RT-${year}-${seq}`;
}

module.exports = { db, nextReference, STATUSES };
