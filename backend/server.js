const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { makeRoutes } = require("./routes");
const dbHelpers = require("./db");
const path = require("path");

dotenv.config();

const PORT = parseInt(process.env.PORT || "5050", 10);
const dbFile = dbHelpers.resolveDbFileFromEnv(process.env.DB_FILE);

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// init db
const db = dbHelpers.openDb(dbFile);
dbHelpers.initDb(db);

// api routes
app.use("/api", makeRoutes(dbHelpers, db));

// serve frontend (optional): open frontend/index.html directly, or serve it
app.use("/", express.static(path.join(__dirname, "..", "frontend")));

app.listen(PORT, () => {
  console.log(`Money Manager API running on http://localhost:${PORT}`);
  console.log(`DB file: ${dbFile}`);
});
