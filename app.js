// app.js
// Front GitHub Pages : lit les fichiers pré-calculés d'un AUTRE dépôt.
//
const URL_METADATA = "https://raw.githubusercontent.com/matteotoutain/ECM_2526_FinalProject/main/precomputed/metadata.json";
const URL_PROBA_GLOBAL = "https://raw.githubusercontent.com/matteotoutain/ECM_2526_FinalProject/main/precomputed/proba_global.csv";
const URL_STATIONS = "https://raw.githubusercontent.com/matteotoutain/ECM_2526_FinalProject/main/precomputed/stations.json";

// Colonnes de proba_global.csv
const COL_DELTA_DAYS = "delta_days";
const COL_PROBA_OPEN = "proba_open";

// Données en mémoire
let globalRows = []; // [{ delta_days: number, proba_open: number }]
let metaData = null;
let stations = [];

// Helpers DOM
function $(id) {
  return document.getElementById(id);
}

// =========================================================
// 1. Chargement global (metadata + proba_global + stations)
// =========================================================

async function loadAll() {
  try {
    const [metaRes, probaRes, stationsRes] = await Promise.all([
      fetch(URL_METADATA),
      fetch(URL_PROBA_GLOBAL),
      fetch(URL_STATIONS)
    ]);

    // ----- metadata.json -----
    if (metaRes.ok) {
      metaData = await metaRes.json();
      updateMetadataLine();
    } else {
      $("meta-line").textContent = "Métadonnées non disponibles.";
    }

    // ----- proba_global.csv -----
    if (!probaRes.ok) {
      throw new Error("Impossible de charger proba_global.csv (" + probaRes.status + ")");
    }
    const csvText = await probaRes.text();
    const rawRows = parseCSV(csvText);
    globalRows = rawRows
      .map(normalizeGlobalRow)
      .filter((r) => Number.isFinite(r.delta_days) && Number.isFinite(r.proba_open));

    if (!globalRows.length) {
      throw new Error("proba_global.csv ne contient aucune ligne exploitable.");
    }

    // Tri par delta_days pour faciliter les recherches
    globalRows.sort((a, b) => a.delta_days - b.delta_days);

    // ----- stations.json -----
    if (stationsRes.ok) {
      stations = await stationsRes.json();
      populateStations();
    } else {
      console.warn("stations.json non disponible :", stationsRes.status);
    }

    prefillDateToday();
    setStatus("Données chargées, sélectionne un trajet.", "neutral");
    updateRangeInfo();
  } catch (err) {
    console.error("Erreur lors du chargement des données :", err);
    showFatalError(
      "Impossible de charger les données distantes. Vérifie les URL des fichiers dans app.js."
    );
  }
}

// Affiche la ligne de métadonnées (volumes uniquement)
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
  const nGlobal = metaData.n_rows_proba_global || "n.c.";
  const nOd = metaData.n_rows_proba_od || "n.c.";

  el.textContent =
    `Généré le ${genAt} • ${nRaw} lignes brutes • ${nEnriched} lignes enrichies • ` +
    `${nStations} gares • ${nGlobal} lignes globales • ${nOd} OD détaillés`;
}

// =========================================================
// 2. Parsing CSV (simple, séparateur auto ; ou , )
// =========================================================

function parseCSV(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const lines = trimmed.split(/\r?\n/);
  if (lines.length <= 1) return [];

  const headerLine = lines[0];
  const sep = headerLine.split(";").length > headerLine.split(",").length ? ";" : ",";
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

// Normalisation d'une ligne de proba_global.csv
function normalizeGlobalRow(raw) {
  return {
    delta_days: parseInt(raw[COL_DELTA_DAYS] || "NaN", 10),
    proba_open: parseFloat(raw[COL_PROBA_OPEN] || "NaN")
  };
}

// =========================================================
// 3. Stations : remplissage des selects
// =========================================================

function populateStations() {
  const originSelect = $("origin-select");
  const destSelect = $("destination-select");

  originSelect.innerHTML = '<option value="">Sélectionner une origine…</option>';
  destSelect.innerHTML = '<option value="">Sélectionner une destination…</option>';

  if (!Array.isArray(stations) || !stations.length) return;

  stations.forEach((name) => {
    const opt1 = document.createElement("option");
    opt1.value = name;
    opt1.textContent = name;
    originSelect.appendChild(opt1);

    const opt2 = document.createElement("option");
    opt2.value = name;
    opt2.textContent = name;
    destSelect.appendChild(opt2);
  });
}

// Date par défaut = aujourd'hui
function prefillDateToday() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  $("date-select").value = `${yyyy}-${mm}-${dd}`;
}

// Affiche l'intervalle de delta_days couvert par le modèle
function updateRangeInfo() {
  if (!globalRows.length) {
    $("range-value").textContent = "–";
    return;
  }
  const minDelta = globalRows[0].delta_days;
  const maxDelta = globalRows[globalRows.length - 1].delta_days;
  $("range-value").textContent = `${minDelta} → ${maxDelta}`;
}

// =========================================================
// 4. Calcul de la proba pour une date choisie
// =========================================================

function onComputeClick() {
  const dateStr = $("date-select").value;
  const origin = $("origin-select").value;
  const destination = $("destination-select").value;

  resetMessages();

  if (!dateStr) {
    setStatus("Merci de sélectionner une date.", "warning");
    return;
  }

  if (!origin || !destination) {
    setStatus("Sélectionne aussi une origine et une destination.", "warning");
    // On ne bloque pas forcément le calcul de la proba globale,
    // mais on demande quand même un trajet complet pour l’UX.
  }

  const delta = computeDeltaDaysFromToday(dateStr);
  $("delta-value").textContent = String(delta);

  if (!globalRows.length) {
    showFatalError("Les données globales ne sont pas disponibles.");
    return;
  }

  const minDelta = globalRows[0].delta_days;
  const maxDelta = globalRows[globalRows.length - 1].delta_days;

  let warningHtml = "";
  if (delta < minDelta || delta > maxDelta) {
    warningHtml +=
      `La date choisie (delta = ${delta}) est <strong>hors de la plage</strong> couverte par le modèle ` +
      `(<code>${minDelta}</code> → <code>${maxDelta}</code>). ` +
      "La valeur affichée est extrapolée à partir du delta le plus proche.";
  }

  // Cherche la ligne de delta_days la plus proche
  const row = findClosestDeltaRow(delta);
  if (!row) {
    showFatalError("Impossible de trouver une probabilité globale pour ce delta.");
    return;
  }

  updateGlobalResult(row, delta);

  if (warningHtml) {
    showWarning(warningHtml);
  }

  // Debug soft
  const dbg = $("debug-info");
  dbg.innerHTML =
    "<strong>Debug :</strong> " +
    JSON.stringify(
      {
        date_selectionnee: dateStr,
        delta_calcule: delta,
        delta_retourne: row.delta_days,
        proba_open: row.proba_open
      },
      null,
      2
    )
      .replace(/\n/g, "<br>")
      .replace(/ /g, "&nbsp;");
  dbg.classList.remove("hidden");
}

// Conversion date → delta_days (date - aujourd'hui)
function computeDeltaDaysFromToday(dateStr) {
  // dateStr = "YYYY-MM-DD"
  const travel = new Date(dateStr + "T00:00:00");
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffMs = travel.getTime() - todayMidnight.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return diffDays;
}

// Trouve la ligne avec le delta_days le plus proche
function findClosestDeltaRow(delta) {
  if (!globalRows.length) return null;
  let best = globalRows[0];
  let bestDist = Math.abs(best.delta_days - delta);

  for (let i = 1; i < globalRows.length; i++) {
    const r = globalRows[i];
    const dist = Math.abs(r.delta_days - delta);
    if (dist < bestDist) {
      best = r;
      bestDist = dist;
    }
  }
  return best;
}

// Mise à jour de la carte résultat
function updateGlobalResult(row, requestedDelta) {
  const prob = Number.isFinite(row.proba_open) ? row.proba_open : null;

  $("probability-value").textContent =
    prob == null ? "–" : (prob * 100).toFixed(0) + " %";

  if (prob == null) {
    setStatus(
      "Pas assez de données fiables pour estimer cette probabilité globale.",
      "warning"
    );
    return;
  }

  // Statut visuel simple suivant la proba
  if (prob >= 0.7) {
    setStatus(
      "Probabilité globale élevée d'ouverture TGVmax pour ce delta.",
      "positive"
    );
  } else if (prob <= 0.3) {
    setStatus(
      "Probabilité globale faible d'ouverture TGVmax pour ce delta.",
      "negative"
    );
  } else {
    setStatus(
      "Probabilité globale intermédiaire : ouverture incertaine.",
      "neutral"
    );
  }
}

// =========================================================
// 5. Gestion des messages / erreurs
// =========================================================

function showFatalError(message) {
  $("result-status").textContent = message;
  $("result-status").className = "result-status result-status--negative";
  $("probability-value").textContent = "–";
  $("delta-value").textContent = "–";
}

function resetMessages() {
  setStatus("Calcul en attente…", "neutral");
  const w = $("warning-box");
  w.classList.add("hidden");
  w.innerHTML = "";
  const dbg = $("debug-info");
  dbg.classList.add("hidden");
  dbg.innerHTML = "";
}

function setStatus(text, level) {
  const el = $("result-status");
  el.textContent = text;

  const base = "result-status";
  let cls;
  switch (level) {
    case "positive":
      cls = base + " result-status--positive";
      break;
    case "negative":
      cls = base + " result-status--negative";
      break;
    case "warning":
      cls = base + " result-status--warning";
      break;
    default:
      cls = base + " result-status--neutral";
  }
  el.className = cls;
}

function showWarning(html) {
  const w = $("warning-box");
  w.innerHTML = html;
  w.classList.remove("hidden");
}

// =========================================================
// 6. Listeners
// =========================================================

document.addEventListener("DOMContentLoaded", () => {
  loadAll();
  $("compute-btn").addEventListener("click", () => {
    onComputeClick();
  });
});
