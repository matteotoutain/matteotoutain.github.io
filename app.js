// app.js
// Version statique GitHub Pages de ton interface Streamlit.

const DATA_URL = "data/tgvmax_snapshot.json";

let allRows = [];
let uniqueOrigins = [];
let uniqueDestinationsByOrigin = {};

// =========================
// 1. Chargement des données
// =========================

async function loadData() {
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    allRows = json || [];

    buildOriginDestinationMaps();
    populateOriginSelect();
    prefillDateIfPossible();
  } catch (err) {
    console.error("Erreur de chargement des données :", err);
    showFatalError("Impossible de charger les données TGVmax.");
  }
}

function buildOriginDestinationMaps() {
  const originSet = new Set();
  const destMap = {};

  allRows.forEach((row) => {
    const o = row.origine;
    const d = row.destination;
    if (!o || !d) return;

    originSet.add(o);

    if (!destMap[o]) {
      destMap[o] = new Set();
    }
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

// =========================
// 2. DOM helpers
// =========================

function $(id) {
  return document.getElementById(id);
}

function populateOriginSelect() {
  const originSelect = $("origin-select");
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

  if (!origin || !uniqueDestinationsByOrigin[origin]) return;

  uniqueDestinationsByOrigin[origin].forEach((dest) => {
    const opt = document.createElement("option");
    opt.value = dest;
    opt.textContent = dest;
    destinationSelect.appendChild(opt);
  });
}

function prefillDateIfPossible() {
  const dateInput = $("date-select");
  if (!allRows.length) return;
  // On prend la date min et max dans les données puis "au milieu" ou la plus récente
  const dates = Array.from(
    new Set(allRows.map((r) => r.date).filter(Boolean))
  ).sort();
  const mostRecent = dates[dates.length - 1];
  dateInput.value = mostRecent;
}

function showFatalError(message) {
  $("result-status").textContent = message;
  $("result-status").className =
    "result-status result-status--negative";
  $("probability-value").textContent = "–";
  $("historical-rate-value").textContent = "–";
  $("observations-value").textContent = "–";
}

// =========================
// 3. Logique de calcul
// =========================

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

  // Filtre sur l'OD d'abord
  const rowsForOD = allRows.filter(
    (r) => r.origine === origin && r.destination === destination
  );

  if (!rowsForOD.length) {
    // Cas 1 : cet OD n'existe pas dans les données
    setStatus("Trajet inexistant dans les données TGVmax.", "negative");
    $("probability-value").textContent = "–";
    $("historical-rate-value").textContent = "–";
    $("observations-value").textContent = "0";
    showWarning(
      "<strong>Ce couple origine / destination n'apparaît jamais</strong> dans les données historisées. " +
        "On ne calcule donc pas de probabilité artificielle."
    );
    return;
  }

  // Filtre sur la date exacte
  const rowsForExactDate = rowsForOD.filter((r) => r.date === dateStr);

  let row;
  if (rowsForExactDate.length) {
    // On prend la première (normalement unique)
    row = rowsForExactDate[0];
  } else {
    // Option : fallback sur “dates proches” ou moyenne globale OD
    // Ici : moyenne globale de l'OD si aucune ligne pour la date exacte
    row = buildAggregatedRow(rowsForOD);
  }

  updateResult(row, rowsForOD.length, rowsForExactDate.length > 0);
}

function buildAggregatedRow(rowsForOD) {
  const n = rowsForOD.length;
  const meanProb =
    rowsForOD.reduce((acc, r) => acc + (r.prob_open ?? 0), 0) / n;
  const meanHist =
    rowsForOD.reduce((acc, r) => acc + (r.historical_open_rate ?? 0), 0) / n;

  const base = rowsForOD[0];
  return {
    date: null,
    origine: base.origine,
    destination: base.destination,
    prob_open: meanProb,
    historical_open_rate: meanHist,
    n_observations: n,
  };
}

function updateResult(row, totalForOD, hasExactDate) {
  const prob = row.prob_open ?? null;
  const hist = row.historical_open_rate ?? null;
  const nObs = row.n_observations ?? totalForOD ?? null;

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
      "Les données existantes pour ce trajet sont trop faibles ou absentes pour produire une estimation robuste."
    );
    return;
  }

  // Choix du statut en fonction de la proba
  if (prob >= 0.7) {
    setStatus(
      hasExactDate
        ? "Trajet fréquemment ouvert TGVmax à cette date."
        : "Trajet souvent ouvert TGVmax (estimation moyenne sur l'historique).",
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
        ? "Zone grise : ouverture TGVmax assez incertaine."
        : "Zone grise : l'historique reste mitigé sur ce trajet.",
      "neutral"
    );
  }

  if (!hasExactDate) {
    showWarning(
      "Aucune observation exacte pour la date sélectionnée. " +
        "La probabilité affichée est une moyenne historique sur ce trajet."
    );
  }

  // Debug “soft” pour toi si tu veux vérifier
  const dbg = $("debug-info");
  dbg.innerHTML =
    "<strong>Debug :</strong> " +
    JSON.stringify(
      {
        date_selectionnee: $("date-select").value,
        row_utilisee: row,
        total_OD: totalForOD,
        date_exacte_disponible: hasExactDate,
      },
      null,
      2
    ).replace(/\n/g, "<br>").replace(/ /g, "&nbsp;");
  dbg.classList.remove("hidden");
}

// =========================
// 4. UI messages
// =========================

function resetMessages() {
  setStatus("Calcul en attente…", "neutral");
  $("warning-box").classList.add("hidden");
  $("warning-box").innerHTML = "";
  $("debug-info").classList.add("hidden");
  $("debug-info").innerHTML = "";
}

function setStatus(text, level) {
  const el = $("result-status");
  el.textContent = text;

  const base = "result-status";
  const cls =
    level === "positive"
      ? base + " result-status--positive"
      : level === "negative"
      ? base + " result-status--negative"
      : level === "warning"
      ? base + " result-status--warning"
      : base + " result-status--neutral";

  el.className = cls;
}

function showWarning(html) {
  const w = $("warning-box");
  w.innerHTML = html;
  w.classList.remove("hidden");
}

// =========================
// 5. Listeners
// =========================

document.addEventListener("DOMContentLoaded", () => {
  loadData();

  $("origin-select").addEventListener("change", (e) => {
    populateDestinationSelect(e.target.value);
  });

  $("compute-btn").addEventListener("click", () => {
    onComputeClick();
  });
});
