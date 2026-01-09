const API = "http://localhost:5050/api";

const $ = (id) => document.getElementById(id);

const typeEl = $("type");
const dateEl = $("date");
const categoryEl = $("category");
const amountEl = $("amount");
const noteEl = $("note");

const addBtn = $("addBtn");
const refreshBtn = $("refreshBtn");
const exportBtn = $("exportBtn");
const importFile = $("importFile");

const summaryMode = $("summaryMode");
const kpiIncome = $("kpiIncome");
const kpiExpense = $("kpiExpense");
const kpiBalance = $("kpiBalance");

const txTableBody = $("txTable").querySelector("tbody");
const catTableBody = $("catTable").querySelector("tbody");

const todayLabel = $("todayLabel");

const scanBtn = $("scanBtn");
const stopScanBtn = $("stopScanBtn");
const qrWrap = $("qrWrap");
const video = $("video");
const qrResult = $("qrResult");

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fmtMoney(x) {
  return Number(x).toFixed(2);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res;
}

async function loadTransactions() {
  const res = await api("/transactions");
  const data = await res.json();

  txTableBody.innerHTML = "";
  for (const t of data) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(t.occurred_at)}</td>
      <td><span class="tag">${escapeHtml(t.type)}</span></td>
      <td>${escapeHtml(t.category)}</td>
      <td>${escapeHtml(t.amount)}</td>
      <td>${escapeHtml(t.note || "")}</td>
      <td><button data-id="${t.id}" class="delBtn">Delete</button></td>
    `;
    txTableBody.appendChild(tr);
  }

  document.querySelectorAll(".delBtn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (!confirm("Delete this transaction?")) return;
      await api(`/transactions/${id}`, { method: "DELETE" });
      await refreshAll();
    });
  });
}

async function loadSummary() {
  const mode = summaryMode.value;
  const date = dateEl.value || todayISO();
  const q = new URLSearchParams({ mode, date }).toString();
  const res = await api(`/summary?${q}`);
  const s = await res.json();

  kpiIncome.textContent = s.totals.income;
  kpiExpense.textContent = s.totals.expense;
  kpiBalance.textContent = s.totals.balance;

  catTableBody.innerHTML = "";
  for (const c of s.byCategory) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="tag">${escapeHtml(c.type)}</span></td>
      <td>${escapeHtml(c.category)}</td>
      <td>${escapeHtml(c.amount)}</td>
    `;
    catTableBody.appendChild(tr);
  }
}

async function refreshAll() {
  await Promise.all([loadTransactions(), loadSummary()]);
}

addBtn.addEventListener("click", async () => {
  const payload = {
    type: typeEl.value,
    category: categoryEl.value.trim(),
    amount: amountEl.value.trim(),
    occurred_at: dateEl.value || todayISO(),
    note: noteEl.value.trim()
  };

  try {
    await api("/transactions", { method: "POST", body: JSON.stringify(payload) });
    amountEl.value = "";
    noteEl.value = "";
    await refreshAll();
  } catch (e) {
    alert(e.message);
  }
});

refreshBtn.addEventListener("click", refreshAll);

exportBtn.addEventListener("click", async () => {
  const res = await fetch(`${API}/export`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "money-manager-export.json";
  a.click();
  URL.revokeObjectURL(url);
});

importFile.addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const arr = JSON.parse(text);

    const res = await api("/import", { method: "POST", body: JSON.stringify(arr) });
    const out = await res.json();
    alert(`Imported: ${out.inserted}`);
    importFile.value = "";
    await refreshAll();
  } catch (e) {
    alert(`Import failed: ${e.message}`);
  }
});

// ---------- QR SCAN (camera) ----------
let stream = null;
let rafId = null;
let canvas = null;
let ctx = null;

function parseFromQrText(text) {
  const s = String(text || "");

  // Try find amount patterns: 123.45 or 1,234.56 or 1234
  const amtMatch = s.match(/(\d{1,6}([.,]\d{1,2})?)/);
  const amount = amtMatch ? amtMatch[1].replace(",", ".") : "";

  // Note = first 120 chars of payload
  const note = s.length > 120 ? s.slice(0, 120) + "…" : s;

  // If looks like URL, keep it as note
  return { amount, note };
}

async function startScan() {
  qrWrap.style.display = "block";
  qrResult.textContent = "Starting camera…";

  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false,
  });

  video.srcObject = stream;
  await video.play();

  canvas = document.createElement("canvas");
  ctx = canvas.getContext("2d", { willReadFrequently: true });

  const tick = () => {
    if (!video.videoWidth) {
      rafId = requestAnimationFrame(tick);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, canvas.width, canvas.height);

    if (code && code.data) {
      const text = code.data;
      qrResult.textContent = `QR content: ${text}`;

      const parsed = parseFromQrText(text);
      if (parsed.amount && !amountEl.value) amountEl.value = parsed.amount;
      if (parsed.note && !noteEl.value) noteEl.value = parsed.note;

      // default guess: expense
      typeEl.value = "expense";
      if (!categoryEl.value) categoryEl.value = "misc";

      stopScan();
      return;
    }

    rafId = requestAnimationFrame(tick);
  };

  tick();
}

function stopScan() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;

  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }

  qrResult.textContent = qrResult.textContent || "Stopped.";
}

scanBtn.addEventListener("click", async () => {
  try {
    await startScan();
  } catch (e) {
    alert("Camera permission denied or not available.");
  }
});

stopScanBtn.addEventListener("click", () => {
  stopScan();
  qrWrap.style.display = "none";
});

// init
(function init() {
  const t = todayISO();
  dateEl.value = t;
  todayLabel.textContent = `Today: ${t}`;
  refreshAll();
})();
