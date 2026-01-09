const path = require("path");
const sqlite3 = require("sqlite3").verbose();

function openDb(dbFile) {
  return new sqlite3.Database(dbFile);
}

function initDb(db) {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('income','expense')),
        category TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        note TEXT,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at ON transactions(occurred_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category)`);
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function resolveDbFileFromEnv(rawPath) {
  // Allows relative DB path from backend folder
  if (!rawPath) return path.join(__dirname, "data", "data.sqlite");
  return path.isAbsolute(rawPath) ? rawPath : path.join(__dirname, rawPath);
}

module.exports = { openDb, initDb, run, all, get, resolveDbFileFromEnv };
