const express = require("express");

function normalizeDateISO(input) {
  // expected: YYYY-MM-DD
  if (!input) return null;
  const s = String(input).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function parseMoneyToCents(amount) {
  // accepts number or string like "123.45"
  if (amount === null || amount === undefined) return null;
  const s = String(amount).trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, dec = "0"] = s.split(".");
  const cents = parseInt(whole, 10) * 100 + parseInt(dec.padEnd(2, "0").slice(0, 2), 10);
  if (!Number.isFinite(cents) || cents <= 0) return null;
  return cents;
}

function centsToMoney(cents) {
  return (cents / 100).toFixed(2);
}

function safeText(v, max = 120) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

function makeRoutes(dbHelpers, db) {
  const { run, all, get } = dbHelpers;
  const router = express.Router();

  // Health
  router.get("/health", (req, res) => res.json({ ok: true }));

  // Create transaction
  router.post("/transactions", async (req, res) => {
    try {
      const type = String(req.body?.type || "").trim();
      const category = safeText(req.body?.category, 40);
      const note = safeText(req.body?.note, 200);
      const occurred_at = normalizeDateISO(req.body?.occurred_at) || new Date().toISOString().slice(0, 10);
      const amount_cents = parseMoneyToCents(req.body?.amount);

      if (!["income", "expense"].includes(type)) {
        return res.status(400).json({ error: "type must be 'income' or 'expense'." });
      }
      if (!category) {
        return res.status(400).json({ error: "category is required." });
      }
      if (!amount_cents) {
        return res.status(400).json({ error: "amount is required and must be > 0." });
      }
      if (!normalizeDateISO(occurred_at)) {
        return res.status(400).json({ error: "occurred_at must be YYYY-MM-DD." });
      }

      const result = await run(
        db,
        `INSERT INTO transactions(type, category, amount_cents, note, occurred_at)
         VALUES (?, ?, ?, ?, ?)`,
        [type, category, amount_cents, note || null, occurred_at]
      );

      const created = await get(db, `SELECT * FROM transactions WHERE id = ?`, [result.lastID]);
      return res.status(201).json({
        ...created,
        amount: centsToMoney(created.amount_cents)
      });
    } catch (e) {
      return res.status(500).json({ error: "Server error.", details: String(e.message || e) });
    }
  });

  // List transactions (with filters)
  router.get("/transactions", async (req, res) => {
    try {
      const type = req.query.type ? String(req.query.type).trim() : null;
      const from = req.query.from ? normalizeDateISO(req.query.from) : null;
      const to = req.query.to ? normalizeDateISO(req.query.to) : null;

      const params = [];
      const where = [];

      if (type && ["income", "expense"].includes(type)) {
        where.push("type = ?");
        params.push(type);
      }
      if (from) {
        where.push("occurred_at >= ?");
        params.push(from);
      }
      if (to) {
        where.push("occurred_at <= ?");
        params.push(to);
      }

      const sql = `
        SELECT * FROM transactions
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY occurred_at DESC, id DESC
        LIMIT 500
      `;

      const rows = await all(db, sql, params);
      const out = rows.map(r => ({ ...r, amount: centsToMoney(r.amount_cents) }));
      res.json(out);
    } catch (e) {
      return res.status(500).json({ error: "Server error.", details: String(e.message || e) });
    }
  });

  // Delete
  router.delete("/transactions/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });

      const existing = await get(db, `SELECT id FROM transactions WHERE id = ?`, [id]);
      if (!existing) return res.status(404).json({ error: "Not found." });

      await run(db, `DELETE FROM transactions WHERE id = ?`, [id]);
      res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: "Server error.", details: String(e.message || e) });
    }
  });

  // Summary: totals + by category (supports day/month)
  router.get("/summary", async (req, res) => {
    try {
      const mode = String(req.query.mode || "all").trim(); // all | day | month
      const date = normalizeDateISO(req.query.date) || new Date().toISOString().slice(0, 10);

      let from = null;
      let to = null;

      if (mode === "day") {
        from = date;
        to = date;
      } else if (mode === "month") {
        const [y, m] = date.split("-").map(x => parseInt(x, 10));
        const mm = String(m).padStart(2, "0");
        from = `${y}-${mm}-01`;
        // last day: take first day next month minus 1
        const nextMonth = new Date(Date.UTC(y, m, 1)); // m is 1-based; Date month is 0-based but here we used m directly, so it becomes next month
        const lastDay = new Date(nextMonth.getTime() - 24 * 3600 * 1000);
        to = lastDay.toISOString().slice(0, 10);
      }

      const params = [];
      const where = [];
      if (from) {
        where.push("occurred_at >= ?");
        params.push(from);
      }
      if (to) {
        where.push("occurred_at <= ?");
        params.push(to);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const totals = await all(
        db,
        `
        SELECT type, SUM(amount_cents) AS sum_cents
        FROM transactions
        ${whereSql}
        GROUP BY type
        `,
        params
      );

      const byCategory = await all(
        db,
        `
        SELECT type, category, SUM(amount_cents) AS sum_cents
        FROM transactions
        ${whereSql}
        GROUP BY type, category
        ORDER BY type ASC, sum_cents DESC
        `,
        params
      );

      const income = totals.find(t => t.type === "income")?.sum_cents || 0;
      const expense = totals.find(t => t.type === "expense")?.sum_cents || 0;

      res.json({
        mode,
        date,
        range: from ? { from, to } : null,
        totals: {
          income: centsToMoney(income),
          expense: centsToMoney(expense),
          balance: centsToMoney(income - expense)
        },
        byCategory: byCategory.map(r => ({
          type: r.type,
          category: r.category,
          amount: centsToMoney(r.sum_cents || 0)
        }))
      });
    } catch (e) {
      return res.status(500).json({ error: "Server error.", details: String(e.message || e) });
    }
  });

  // Export JSON
  router.get("/export", async (req, res) => {
    try {
      const rows = await all(db, `SELECT * FROM transactions ORDER BY occurred_at DESC, id DESC`);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=money-manager-export.json");
      res.send(
        JSON.stringify(
          rows.map(r => ({ ...r, amount: centsToMoney(r.amount_cents) })),
          null,
          2
        )
      );
    } catch (e) {
      return res.status(500).json({ error: "Server error.", details: String(e.message || e) });
    }
  });

  // Import JSON (array of transactions)
  router.post("/import", async (req, res) => {
    try {
      const items = req.body;
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: "Body must be an array." });
      }

      let inserted = 0;
      for (const it of items) {
        const type = String(it.type || "").trim();
        const category = safeText(it.category, 40);
        const note = safeText(it.note, 200);
        const occurred_at = normalizeDateISO(it.occurred_at);
        const amount_cents = parseMoneyToCents(it.amount);

        if (!["income", "expense"].includes(type)) continue;
        if (!category) continue;
        if (!occurred_at) continue;
        if (!amount_cents) continue;

        await run(
          db,
          `INSERT INTO transactions(type, category, amount_cents, note, occurred_at)
           VALUES (?, ?, ?, ?, ?)`,
          [type, category, amount_cents, note || null, occurred_at]
        );
        inserted++;
      }

      res.json({ ok: true, inserted });
    } catch (e) {
      return res.status(500).json({ error: "Server error.", details: String(e.message || e) });
    }
  });

  return router;
}

module.exports = { makeRoutes };
