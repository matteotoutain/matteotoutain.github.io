// app.js

// ===== 1. URLs backend (ton dépôt existant) ================================

const URL_METADATA =
  "https://raw.githubusercontent.com/matteotoutain/ECM_2526_FinalProject/main/precomputed/metadata.json";
const URL_STATIONS =
  "https://raw.githubusercontent.com/matteotoutain/ECM_2526_FinalProject/main/precomputed/stations.json";

// fichiers backend
const URL_PROBA_OD =
  "https://raw.githubusercontent.com/matteotoutain/ECM_2526_FinalProject/main/precomputed/proba_od.csv";
const URL_SNAPSHOT_TODAY_OD =
  "https://raw.githubusercontent.com/matteotoutain/ECM_2526_FinalProject/main/precomputed/snapshot_today_od.csv";

// ===== 2. Schéma attendu ================================================

// proba_od.csv
const COL_OD_ORIGIN = "origine";
const COL_OD_DEST = "destination";
const COL_OD_DELTA = "delta_days";
const COL_OD_PROBA = "proba_open";

// snapshot_today_od.csv
const COL_SNAP_DATE = "departure_date"; // IMPORTANT
const COL_SNAP_ORIGIN = "origine";
const COL_SNAP_DEST = "destination";
const COL_SNAP_OPEN = "is_open_today";

// ===== 3. Données en mémoire ============================================

let metaData = null;
let stations = [];

let odByKey = {};    // { "ORIGIN||DEST": [{delta_days, proba_open}, ...] }
// snapshotToday = { "YYYY-MM-DD": { "ORIGIN||DEST": bool } }
let snapshotToday = {};

let chartInstance = null;

// ===== Helpers DOM =======================================================

function $(id) {
  return document.getElementById(id);
}

// Normalisation robuste (évite mismatch espaces/unicode)
function normText(s) {
  return (s ?? "")
    .toString()
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function normStation(s) {
  // Si tu veux forcer en MAJ : return normText(s).toUpperCase();
  return normText(s);
}

function odKey(origin, destination) {
  return `${normStation(origin)}||${normStation(destination)}`;
}

// ===== 4. Chargement initial ============================================

async function loadAll() {
  try {
    const [metaRes, stationsRes, odRes, snapRes] = await Promise.all([
      fetch(URL_METADATA),
      fetch(URL_STATIONS),
      fetch(URL_PROBA_OD),
      fetch(URL_SNAPSHOT_TODAY_OD)
    ]);

    // metadata.json
    if (metaRes.ok) {
      metaData = await metaRes.json();
      updateMetadataLine();
    } else {
      $("meta-line").textContent = "Métadonnées non disponibles.";
    }

    // stations.json
    if (stationsRes.ok) {
      stations = await stationsRes.json();
      populateStations();
    } else {
      console.warn("stations.json non disponible");
    }

    // proba_od.csv
    if (odRes.ok) {
      const odText = await odRes.text();
      const odRaw = parseCSV(odText);
      buildOdIndex(odRaw);
    } else {
      console.warn("proba_od.csv non disponible => aucune proba affichable.");
    }

    // snapshot_today_od.csv
    if (snapRes.ok) {
      const snapText = await snapRes.text();
      const snapRaw = parseCSV(snapText);
      buildSnapshotIndex(snapRaw);
    } else {
      console.warn(
        "snapshot_today_od.csv non disponible => bandeau 'dispo' restera 'inconnu'."
      );
    }

    prefillDateToday();
    setStatus("Données chargées, sélectionne un trajet.", "neutral");
  } catch (e) {
    console.error(e);
    showFatalError(
      "Erreur de chargement des données. Vérifie les fichiers pré-calculés."
    );
  }
}

function updateMetadataLine() {
  const el = $("meta-line");
  if (!metaData) {
    el.textContent = "Métadonnées non disponibles.";
    return;
  }
  const genAt = metaData.generated_at_utc || "n.c.";
  const nRaw = metaData.n_rows_raw || "n.c.";
  const nEnriched = metaData.n_rows_enriched || "n.c.";
  const nStations = metaData.n_stations || "n.c.";
  const nOd = metaData.n_rows_proba_od || "n.c.";

  el.textContent =
    `Généré le ${genAt} • ${nRaw} lignes brutes • ${nEnriched} enrichies • ` +
    `${nStations} gares • ${nOd} OD`;
}

// ===== 5. Parsing CSV simple ============================================

function parseCSV(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const lines = trimmed.split(/\r?\n/);
  if (lines.length <= 1) return [];

  const headerLine = lines[0];
  const sep =
    headerLine.split(";").length > headerLine.split(",").length ? ";" : ",";
  const headers = headerLine.split(sep).map((h) => h.trim());

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(sep);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (cols[idx] || "").trim();
    });
    rows.push(obj);
  }
  return rows;
}

// ===== 6. Indexation OD & snapshot ======================================

function buildOdIndex(odRaw) {
  odByKey = {};
  odRaw.forEach((r) => {
    const o = r[COL_OD_ORIGIN];
    const d = r[COL_OD_DEST];
    if (!o || !d) return;

    const key = odKey(o, d);
    const delta = parseInt(r[COL_OD_DELTA] || "NaN", 10);
    const p = parseFloat(r[COL_OD_PROBA] || "NaN");
    if (!Number.isFinite(delta) || !Number.isFinite(p)) return;

    if (!odByKey[key]) odByKey[key] = [];
    odByKey[key].push({ delta_days: delta, proba_open: p });
  });

  // Trier chaque série par delta_days
  for (const key of Object.keys(odByKey)) {
    odByKey[key].sort((a, b) => a.delta_days - b.delta_days);
  }
}

function buildSnapshotIndex(snapRaw) {
  // snapshotToday = { "YYYY-MM-DD": { "ORIG||DEST": bool } }
  snapshotToday = {};

  snapRaw.forEach((r) => {
    const dep = normText(r[COL_SNAP_DATE]); // IMPORTANT
    const o = r[COL_SNAP_ORIGIN];
    const d = r[COL_SNAP_DEST];
    if (!dep || !o || !d) return;

    const key = odKey(o, d);

    const rawVal = (r[COL_SNAP_OPEN] ?? "").toString().toLowerCase().trim();
    const val =
      rawVal === "1" ||
      rawVal === "true" ||
      rawVal === "oui" ||
      rawVal === "yes";

    if (!snapshotToday[dep]) snapshotToday[dep] = {};
    snapshotToday[dep][key] = val;
  });
}

// ===== 7. Stations & date ===============================================

function populateStations() {
  const originSelect = $("origin-select");
  const destSelect = $("destination-select");
  originSelect.innerHTML =
    '<option value="">— Sélectionnez une gare —</option>';
  destSelect.innerHTML =
    '<option value="">— Sélectionnez une gare —</option>';

  if (!Array.isArray(stations) || !stations.length) return;

  stations.forEach((name) => {
    const v = normStation(name);

    const o = document.createElement("option");
    o.value = v;
    o.textContent = name;
    originSelect.appendChild(o);

    const d = document.createElement("option");
    d.value = v;
    d.textContent = name;
    destSelect.appendChild(d);
  });
}

function prefillDateToday() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  $("date-select").value = `${yyyy}-${mm}-${dd}`;
}

// ===== 8. Calcul & affichage ============================================

function computeDeltaDaysFromToday(dateStr) {
  const travel = new Date(dateStr + "T00:00:00");
  const today = new Date();
  const todayMidnight = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const diffMs = travel.getTime() - todayMidnight.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function findClosestOdRow(series, delta) {
  if (!series || !series.length) return null;
  let best = series[0];
  let bestDist = Math.abs(best.delta_days - delta);
  for (let i = 1; i < series.length; i++) {
    const r = series[i];
    const dist = Math.abs(r.delta_days - delta);
    if (dist < bestDist) {
      best = r;
      bestDist = dist;
    }
  }
  return best;
}

function onComputeClick() {
  const dateStr = $("date-select").value;
  const origin = $("origin-select").value;
  const dest = $("destination-select").value;

  resetMessages();

  if (!dateStr || !origin || !dest) {
    setStatus(
      "Merci de sélectionner une date, une origine et une destination.",
      "warning"
    );
    return;
  }

  const key = odKey(origin, dest);
  const delta = computeDeltaDaysFromToday(dateStr);
  $("delta-value").textContent = String(delta);

  // 1) snapshot du jour (INDEXÉ PAR DATE + OD)
  updateTodayBadge(dateStr, origin, dest);

  // 2) proba OD uniquement
  const series = odByKey[key] || [];
  const odRow = findClosestOdRow(series, delta);
  const odProb = odRow ? odRow.proba_open : null;

  if (odProb == null) {
    $("probability-value").textContent = "–";
    setStatus(
      "Aucune donnée pour ce trajet (OD). Choisis un autre trajet.",
      "warning"
    );
    drawChart(series, key);
    return;
  }

  $("probability-value").textContent = (odProb * 100).toFixed(0) + " %";

  if (odProb >= 0.5) {
    setStatus("Fortes chances d'ouverture TGVmax pour ce trajet.", "positive");
  } else if (odProb <= 0.3) {
    setStatus("Faibles chances d'ouverture TGVmax pour ce trajet.", "negative");
  } else {
    setStatus("Zone grise : ouverture TGVmax incertaine.", "neutral");
  }

  if (series.length) {
    const minD = series[0].delta_days;
    const maxD = series[series.length - 1].delta_days;
    if (delta < minD || delta > maxD) {
      showWarning(
        `Delta ${delta} hors de la plage observée pour ce trajet (${minD} → ${maxD}). ` +
        "La proba OD est basée sur le delta le plus proche."
      );
    }
  }

  drawChart(series, key);

  // Debug
  const dbg = $("debug-info");
  if (dbg) {
    dbg.classList.remove("hidden");
    dbg.textContent = JSON.stringify(
      {
        departure_date: normText(dateStr),
        origin: normStation(origin),
        destination: normStation(dest),
        key,
        delta,
        snapshot_lookup: snapshotToday?.[normText(dateStr)]?.[key],
        od_used: odRow,
        has_series: series.length
      },
      null,
      2
    );
  }
}

// ===== 9. Bandeau "dispo aujourd'hui" ===================================

function updateTodayBadge(departureDateStr, origin, dest) {
  const badge = $("today-badge");
  if (!badge) return;

  const dep = normText(departureDateStr);
  const key = odKey(origin, dest);

  const byDate = snapshotToday[dep];
  if (!byDate) {
    badge.textContent = `Snapshot du jour : aucun statut pour la date ${dep}`;
    badge.className = "badge badge--unknown";
    return;
  }

  const val = byDate[key];
  if (val === undefined) {
    badge.textContent = "Snapshot du jour : statut inconnu pour ce trajet";
    badge.className = "badge badge--unknown";
    return;
  }

  if (val) {
    badge.textContent = "Snapshot du jour : TGVmax DISPONIBLE sur ce trajet";
    badge.className = "badge badge--open";
  } else {
    badge.textContent = "Snapshot du jour : TGVmax NON disponible sur ce trajet";
    badge.className = "badge badge--closed";
  }
}

// ===== 10. Courbe de probabilité (Chart.js) =============================

function drawChart(series, key) {
  const canvas = document.getElementById("prob-chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  if (!series || !series.length) {
    chartInstance = new Chart(ctx, {
      type: "line",
      data: { labels: [], datasets: [{ label: "Pas de données OD", data: [] }] },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: "delta_days" } },
          y: { title: { display: true, text: "proba_open" }, min: 0, max: 1 }
        }
      }
    });
    return;
  }

  const labels = series.map((r) => r.delta_days);
  const data = series.map((r) => r.proba_open);

  chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `Proba d'ouverture – ${key.replace("||", " → ")}`,
          data,
          tension: 0.2,
          pointRadius: 2
        }
      ]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: "delta_days" } },
        y: { title: { display: true, text: "proba_open" }, min: 0, max: 1 }
      }
    }
  });
}

// ===== 11. Messages / erreurs ===========================================

function showFatalError(msg) {
  const rs = $("result-status");
  if (rs) {
    rs.textContent = msg;
    rs.className = "status status--negative";
  }
  const pv = $("probability-value");
  if (pv) pv.textContent = "–";
  const dv = $("delta-value");
  if (dv) dv.textContent = "–";
}

function resetMessages() {
  setStatus("Calcul en attente…", "neutral");
  const w = $("warning-box");
  if (w) {
    w.classList.add("hidden");
    w.innerHTML = "";
  }
  const dbg = $("debug-info");
  if (dbg) {
    dbg.classList.add("hidden");
    dbg.textContent = "";
  }
}

function setStatus(text, level) {
  const el = $("result-status");
  if (!el) return;

  el.textContent = text;

  let cls = "status status--neutral";
  if (level === "positive") cls = "status status--positive";
  if (level === "negative") cls = "status status--negative";
  if (level === "warning") cls = "status status--warning";
  el.className = cls;
}

function showWarning(html) {
  const w = $("warning-box");
  if (!w) return;
  w.innerHTML = html;
  w.classList.remove("hidden");
}

function swapStations() {
  const o = $("origin-select");
  const d = $("destination-select");
  if (!o || !d) return;

  const tmp = o.value;
  o.value = d.value;
  d.value = tmp;

  // Bonus UX : si les 3 champs sont remplis, on relance direct
  const dateStr = $("date-select")?.value;
  if (dateStr && o.value && d.value) {
    onComputeClick();
  }
}

// ===== 12. Listeners =====================================================

document.addEventListener("DOMContentLoaded", () => {
  loadAll();
  $("compute-btn")?.addEventListener("click", onComputeClick);

  const swapBtn = $("swap-btn");
  if (swapBtn) swapBtn.addEventListener("click", swapStations);
});
