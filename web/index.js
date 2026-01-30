const API = "http://127.0.0.1:8000";

const elTitle = document.getElementById("title");
const elYear  = document.getElementById("year");
const elTop   = document.getElementById("top");
const btn     = document.getElementById("btn");
const btnClear= document.getElementById("btnClear");
const status  = document.getElementById("status");
const seedBox = document.getElementById("seed");
const results = document.getElementById("results");

let selectedImdbID = null;
let searchTimer = null;
const suggest = document.getElementById("suggest");

// localStorage helpers
function loadList(key) {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); }
  catch { return []; }
}

function saveList(key, arr) {
  localStorage.setItem(key, JSON.stringify(arr));
}

function addUnique(key, item, idField="imdbID") {
  const arr = loadList(key);
  const exists = arr.some(x => x[idField] === item[idField]);
  if (!exists) arr.unshift(item);
  saveList(key, arr.slice(0, 50)); // שומר עד 50
}

function removeById(key, imdbID) {
  const arr = loadList(key).filter(x => x.imdbID !== imdbID);
  saveList(key, arr);
}

function isFav(imdbID) {
  return loadList("favorites").some(x => x.imdbID === imdbID);
}

function buildTasteProfile() {
  const favs = loadList("favorites");
  return {
    favorites: favs.map(x => x.imdbID)
  };
}

// Live search autocomplete
function showSuggest(items) {
  if (!items.length) {
    suggest.style.display = "none";
    suggest.innerHTML = "";
    return;
  }

  suggest.style.display = "block";
  suggest.innerHTML = items.map(x => `
    <div data-id="${x.imdbID}" class="suggest-item">
      <div class="fw-bold">${x.Title}</div>
      <div class="text-muted small">${x.Year} • ${x.Type || "movie"} • ${x.imdbID}</div>
    </div>
  `).join("");
}

async function liveSearch(q) {
  const res = await fetch(`${API}/search?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  if (!data.ok) return showSuggest([]);
  showSuggest((data.results || []).slice(0, 8));
}

elTitle.addEventListener("input", () => {
  const q = elTitle.value.trim();
  selectedImdbID = null;

  clearTimeout(searchTimer);
  if (q.length < 2) return showSuggest([]);

  searchTimer = setTimeout(() => liveSearch(q), 250);
});

suggest.addEventListener("click", (e) => {
  const row = e.target.closest("[data-id]");
  if (!row) return;

  selectedImdbID = row.getAttribute("data-id");
  const titleText = row.querySelector("div").innerText;
  elTitle.value = titleText;

  showSuggest([]);

  // מעבר לדף הסרט
  window.location.href = `movie.html?imdbID=${encodeURIComponent(selectedImdbID)}`;
});

// לסגור הצעות בלחיצה מחוץ
document.addEventListener("click", (e) => {
  if (!suggest.contains(e.target) && e.target !== elTitle) showSuggest([]);
});

// Status messages
function setStatus(msg, kind="") {
  if (!msg) { status.innerHTML = ""; return; }
  if (kind === "error") status.innerHTML = `<div class="alert alert-danger" role="alert"><i class="bi bi-exclamation-triangle"></i> ${msg}</div>`;
  else status.innerHTML = `<div class="alert alert-info" role="alert"><i class="bi bi-info-circle"></i> ${msg}</div>`;
}

// Movie card rendering
function movieCard(m) {
  const poster = (m.Poster && m.Poster !== "N/A") ? m.Poster : "";
  const rating = m.imdbRating && m.imdbRating !== "N/A" ? m.imdbRating : "—";
  const year   = m.Year || "";
  const genre  = m.Genre || "";
  const whyScore = (m.score !== undefined) ? `<span class="badge">score: ${m.score}</span>` : "";

  const why = (m.why || []).map(w => {
    const label = w.type === "genres" ? "ז'אנרים משותפים"
                : w.type === "actors" ? "שחקנים משותפים"
                : w.type === "director" ? "אותו במאי"
                : "סיבה";
    return `<div class="text-muted small mt-1"><i class="bi bi-robot"></i> ${label}: ${w.items.join(", ")}</div>`;
  }).join("");

  return `
    <div class="col-12 col-md-6 col-lg-4">
      <div class="card h-100 p-3">
        <div class="d-flex gap-3">
          ${poster ? `<img class="poster" src="${poster}" alt="poster">` : `<div class="poster"></div>`}
          <div class="flex-grow-1">
            <h6 class="mb-1">${m.Title || "Unknown"}</h6>
            <div class="text-muted small">${year} • <i class="bi bi-star-fill text-warning"></i> ${rating}</div>
            <div class="text-muted small mt-2">${genre}</div>
            <div class="mt-2">${whyScore}</div>
            ${why}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderSeed(seed) {
  seedBox.style.display = "block";
  seedBox.innerHTML = `
    <h6 class="mb-2"><i class="bi bi-bullseye"></i> סרט מקור</h6>
    <div class="text-muted">${seed.Title} (${seed.Year}) • ${seed.Genre || ""} • <i class="bi bi-star-fill text-warning"></i> ${seed.imdbRating || "—"}</div>
  `;
}

function clearAll() {
  setStatus("");
  seedBox.style.display = "none";
  seedBox.innerHTML = "";
  results.innerHTML = "";
}

// Recommendation functions
async function recommend() {
  const title = elTitle.value.trim();
  const year  = elYear.value.trim();
  const top   = elTop.value.trim() || "10";

  if (!title) {
    setStatus("חייבים למלא שם סרט.", "error");
    return;
  }

  btn.disabled = true;
  setStatus("מביא המלצות…");

  try {
    const qs = new URLSearchParams({ title, top });
    if (year) qs.set("year", year);

    const res = await fetch(`${API}/ai/recommend?${qs.toString()}`);
    const data = await res.json();

    if (!data.ok) {
      setStatus(data.error || "שגיאה לא ידועה", "error");
      results.innerHTML = "";
      seedBox.style.display = "none";
      return;
    }

    renderSeed(data.seed);

    if (!data.recommendations || data.recommendations.length === 0) {
      setStatus("לא נמצאו המלצות. נסה סרט אחר או הוסף שנה.", "error");
      results.innerHTML = "";
      return;
    }

    setStatus(`נמצאו ${data.recommendations.length} המלצות ✅`);
    results.innerHTML = data.recommendations.map(movieCard).join("");

  } catch (e) {
    setStatus("נראה שהשרת לא רץ או שיש בעיית CORS. בדוק ש-Flask רץ על 127.0.0.1:8000", "error");
  } finally {
    btn.disabled = false;
  }
}

async function recommendForUser() {
  const profile = buildTasteProfile();
  if (!profile.favorites.length) {
    setStatus("אין מועדפים עדיין. שמור כמה סרטים קודם 🙂", "error");
    return;
  }

  setStatus("מייצר המלצות לפי הטעם שלך…");
  seedBox.style.display = "none";

  try {
    const res = await fetch(`${API}/ai/recommend_for_user`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(profile)
    });
    const data = await res.json();

    if (!data.ok) {
      setStatus(data.error || "שגיאה", "error");
      return;
    }

    setStatus(`נמצאו ${data.recommendations.length} המלצות מותאמות ✅`);
    results.innerHTML = data.recommendations.map(movieCard).join("");
  } catch (e) {
    setStatus("שגיאה בהתחברות לשרת", "error");
  }
}

// Event listeners
btn.addEventListener("click", recommend);
document.getElementById("btnUser").addEventListener("click", recommendForUser);
btnClear.addEventListener("click", clearAll);
elTitle.addEventListener("keydown", (e) => { if (e.key === "Enter") recommend(); });

// GSAP Animations
gsap.from("#header", {
  duration: 1,
  y: -50,
  opacity: 0,
  ease: "power3.out"
});

gsap.from(".card", {
  duration: 0.8,
  y: 30,
  opacity: 0,
  stagger: 0.2,
  ease: "power3.out"
});

// אנימציה להופעת תוצאות
const observer = new MutationObserver(() => {
  if (results.children.length > 0) {
    gsap.from(results.children, {
      duration: 0.6,
      scale: 0.8,
      opacity: 0,
      stagger: 0.1,
      ease: "back.out(1.7)"
    });
  }
});
observer.observe(results, { childList: true });
