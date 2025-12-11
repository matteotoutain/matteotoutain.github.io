// app.js
// Front GitHub Pages : lit les fichiers pré-calculés d'un AUTRE dépôt.
//
// ✔️ A ADAPTER : les 3 URL ci-dessous vers ton autre repo GitHub
//    (brut ou GitHub Pages : raw.githubusercontent.com ou /precomputed/...).

const URL_METADATA = "https://raw.githubusercontent.com/matteotoutain/ECM_2526_FinalProject/main/precomputed/metadata.json";
const URL_PROBA_GLOBAL = "https://raw.githubusercontent.com/matteotoutain/ECM_2526_FinalProject/main/precomputed/proba_global.csv";
const URL_STATIONS = "https://raw.githubusercontent.com/matteotoutain/ECM_2526_FinalProject/main/precomputed/stations.json";

// Si besoin tu pourras exploiter proba_od.parquet côté backend,
// mais ici on reste 100 % statique, donc non utilisé en JS.

// ========================
// 0. Colonnes attendues
// ========================
//
// ➜ Aligne ces noms sur l'en-tête de proba_global.csv
//    (une seule modif à faire ici si ton CSV est différent).

const COL_DATE = "date";
const COL_ORIGIN = "origine";
const COL_DEST = "destination";
const COL_PROB_OPEN = "prob_open";            // ex: prob_open
const COL_HIST_RATE = "historical_open_rate"; // ex: historical_open_rate
const COL_N_OBS = "n_observations";           // ex: n_observations

// ========================
// 1. Data en mémoire
// ========================

let allRows = [];                 // lignes issues de proba_global.csv normalisées
let uniqueOrigins = [];           // liste des origines
let uniqueDestinationsByOrigin = {}; // { origine: [dest1, dest2, ...] }
let metaData = null;              // contenu de metadata.json (optionnel)
let stations = [];                // contenu de stations.json (optionnel)

// ========================
// 2. Helpers DOM
// ========================

function $(id) {
  return document.getElementById(id);
}

// ========================
// 3. Chargement des données
// ========================

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
      console.warn("metadata.json non disponible :", metaRes.status);
      $("meta-line").textContent = "Métadonnées non disponibles.";
    }

    // ----- proba_global.csv -----
    if (!probaRes.ok) {
      throw new Error("Impossible de charger proba_global.csv (" + probaRes.status + ")");
    }
    const csvText = await probaRes.text();
    const rawRows = parseCSV(csvText);
    allRows = rawRows.map(normalizeRow).filter((r) => !!r.origine && !!r.destination);

    if (!allRows.length) {
      throw new Error("proba_global.csv ne contient aucune ligne exploitable.");
    }

    buildOriginDestinationMaps();

    // ----- stations.json (optionnel) -----
    if (stationsRes.ok) {
      stations = await stationsRes.json();
    } else {
      console.warn("stations.json non disponible :", stationsRes.status);
    }

    populateOriginSelect();
    prefillDateIfPossible();
    setStatus("Données chargées, sélectionne un trajet.", "neutral");
  } catch (err) {
    console.error("Erreur lors du chargement des données :", err);
    showFatalError(
      "Impossible de charger les données distantes. Vérifie les URL des fichiers dans app.js."
    );
  }
}

// Affiche la ligne de métadonnées en haut (à partir de metadata.json)
function updateMetadataLine() {
  const el = $("meta-line");
  if (!metaData) {
    el.textContent = "Métadonnées non disponibles.";
    return;
  }

  const last = metaData.last_snapshot_date || metaData.last_date || "n.c.";
  const first = metaData.first_snapshot_date || metaData.first_date || null;
  const nDays = metaData.n_days || metaData.nb_jours || null;
  const nTrips = metaData.n_trips || metaData.nb_trajets || metaData.n_od || null;

  let parts = [];
  if (first && last) {
    parts.push(`Période couverte : ${first} → ${last}`);
  } else {
    parts.push(`Dernier snapshot : ${last}`);
  }
  if (nDays) {
    parts.push(`${nDays} jours observés`);
  }
  if (nTrips) {
    parts.push(`${nTrips} trajets OD`);
  }

  el.textContent = parts.join(" • ");
}

// ========================
// 4. Parsing CSV simple
// ========================
//
// Gère séparateur "," ou ";" (auto-détection sur la première ligne).
//

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

// Normalise les noms de colonnes pour avoir une structure uniforme
function normalizeRow(raw) {
  return {
    date: raw[COL_DATE] || null,
    origine: raw[COL_ORIGIN] || null,
    destination: raw[COL_DEST] || null,
    prob_open: parseFloat(raw[COL_PROB_OPEN] || "NaN"),
    historical_open_rate: parseFloat(raw[COL_HIST_RATE] || "NaN"),
    n_observations: parseInt(raw[COL_N_OBS] || "0", 10)
  };
}

// ========================
// 5. Construction OD
// ========================

function buildOriginDestinationMaps() {
  const originSet = new Set();
  const destMap = {};

  allRows.forEach((row) => {
    const o = row.origine;
    const d = row.destination;
    if (!o || !d) return;

    originSet.add(o);
    if (!destMap[o]) destMap[o] = new Set();
    destMap[o].add(d);
  });

  uniqueOrigins = Array.from(originSet).sort((a, b) => a.localeCompare(b, "fr"));
  uniqueDestinationsByOrigin = {};
  for (const [origin, destSet] of Object.entries(destMap)) {
    uniqueDestinationsByOrigin[origin] = Array.from(destSet).sort((a, b) =>
      a.localeCompare(b, "fr")
    );
  }
}

// ========================
// 6. Form controls
// ========================

function populateOriginSelect() {
  const originSelect = $("origin-select");
  originSelect.innerHTML = '<option value="">Sélectionner une origine…</option>';

  uniqueOrigins.forEach((origin) => {
    const opt = document.createElement("option");
    opt.value = origin;
    opt.textContent = origin;
    originSelect.appendChild(opt);
  });
}

function populateDestinationSelect(origin) {
  const destinationSelect = $("destination-select");
  destinationSelect.innerHTML =
    '<option value="">Sélectionner une destination…</option>';

  const list = uniqueDestinationsByOrigin[origin] || [];
  list.forEach((dest) => {
    const opt = document.createElement("option");
    opt.value = dest;
    opt.textContent = dest;
    destinationSelect.appendChild(opt);
  });
}

// Préremplit la date avec la plus récente dispo dans proba_global.csv
function prefillDateIfPossible() {
  if (!allRows.length) return;
  const dates = Array.from(
    new Set(allRows.map((r) => r.date).filter(Boolean))
  ).sort();
  if (!dates.length) return;
  const mostRecent = dates[dates.length - 1];
  $("date-select").value = mostRecent;
}

// ========================
// 7. Gestion erreurs globales
// ========================

function showFatalError(message) {
  $("result-status").textContent = message;
  $("result-status").className = "result-status result-status--negative";
  $("probability-value").textContent = "–";
  $("historical-rate-value").textContent = "–";
  $("observations-value").textContent = "–";
}

// ========================
// 8. Logique de calcul
// ========================

function onComputeClick() {
  const dateStr = $("date-select").value;
  const origin = $("origin-select").value;
  const destination = $("destination-select").value;

  resetMessages();

  if (!dateStr || !origin || !destination) {
    setStatus(
      "Merci de sélectionner une date, une origine et une destination.",
      "warning"
    );
    return;
  }

  // 1) Filtre sur le couple OD
  const rowsForOD = allRows.filter(
    (r) => r.origine === origin && r.destination === destination
  );

  if (!rowsForOD.length) {
    // Trajet jamais vu dans proba_global.csv → pas un trajet réel dans l'historique
    setStatus("Trajet inexistant dans les données historiques.", "negative");
    $("probability-value").textContent = "–";
    $("historical-rate-value").textContent = "–";
    $("observations-value").textContent = "0";
    showWarning(
      "<strong>Ce couple origine / destination n'apparaît jamais</strong> dans " +
        "<code>proba_global.csv</code>. On ne calcule donc <em>aucune</em> probabilité."
    );
    return;
  }

  // 2) Filtre sur la date exacte
  const rowsForExactDate = rowsForOD.filter((r) => r.date === dateStr);

  let row;
  const hasExactDate = rowsForExactDate.length > 0;

  if (hasExactDate) {
    row = rowsForExactDate[0]; // en principe unique
  } else {
    // Fallback : moyenne historique de cet OD (tout proba_global.csv)
    row = buildAggregatedRow(rowsForOD);
  }

  updateResult(row, rowsForOD.length, hasExactDate, dateStr);
}

function buildAggregatedRow(rowsForOD) {
  const n = rowsForOD.length;
  const meanProb =
    rowsForOD.reduce((acc, r) => acc + (Number.isFinite(r.prob_open) ? r.prob_open : 0), 0) / n;
  const meanHist =
    rowsForOD.reduce(
      (acc, r) =>
        acc +
        (Number.isFinite(r.historical_open_rate) ? r.historical_open_rate : 0),
      0
    ) / n;

  const base = rowsForOD[0];
  return {
    date: null,
    origine: base.origine,
    destination: base.destination,
    prob_open: meanProb,
    historical_open_rate: meanHist,
    n_observations: n
  };
}

function updateResult(row, totalForOD, hasExactDate, dateStr) {
  const prob = Number.isFinite(row.prob_open) ? row.prob_open : null;
  const hist = Number.isFinite(row.historical_open_rate)
    ? row.historical_open_rate
    : null;
  const nObs =
    row.n_observations && row.n_observations > 0
      ? row.n_observations
      : totalForOD;

  $("probability-value").textContent =
    prob == null ? "–" : (prob * 100).toFixed(0) + " %";
  $("historical-rate-value").textContent =
    hist == null ? "–" : (hist * 100).toFixed(0) + " %";
  $("observations-value").textContent = nObs == null ? "–" : String(nObs);

  if (prob == null) {
    setStatus(
      "Pas assez de données fiables pour estimer cette probabilité.",
      "warning"
    );
    showWarning(
      "Les données existantes pour ce trajet sont trop faibles ou incomplètes " +
        "pour produire une estimation robuste."
    );
    return;
  }

  // Statut visuel en fonction de la probabilité
  if (prob >= 0.7) {
    setStatus(
      hasExactDate
        ? "Trajet fréquemment ouvert TGVmax pour cette date."
        : "Trajet souvent ouvert TGVmax (moyenne historique).",
      "positive"
    );
  } else if (prob <= 0.3) {
    setStatus(
      hasExactDate
        ? "Trajet rarement ouvert TGVmax à cette date."
        : "Trajet peu ouvert TGVmax en moyenne.",
      "negative"
    );
  } else {
    setStatus(
      hasExactDate
        ? "Zone grise : ouverture TGVmax incertaine pour cette date."
        : "Zone grise : historique mitigé sur ce trajet.",
      "neutral"
    );
  }

  if (!hasExactDate) {
    showWarning(
      "Aucune ligne exacte dans <code>proba_global.csv</code> pour la date sélectionnée " +
        `(<code>${dateStr}</code>). La probabilité affichée est une <strong>moyenne historique</strong> ` +
        "sur ce couple origine / destination."
    );
  }

  // Debug pour contrôle (désactivable en CSS)
  const dbg = $("debug-info");
  dbg.innerHTML =
    "<strong>Debug :</strong> " +
    JSON.stringify(
      {
        date_selectionnee: dateStr,
        row_utilisee: row,
        total_OD: totalForOD,
        date_exacte_disponible: hasExactDate
      },
      null,
      2
    )
      .replace(/\n/g, "<br>")
      .replace(/ /g, "&nbsp;");
  dbg.classList.remove("hidden");
}

// ========================
// 9. Gestion des messages
// ========================

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

// ========================
// 10. Listeners
// ========================

document.addEventListener("DOMContentLoaded", () => {
  loadAll();

  $("origin-select").addEventListener("change", (e) => {
    populateDestinationSelect(e.target.value);
  });

  $("compute-btn").addEventListener("click", () => {
    onComputeClick();
  });
});
