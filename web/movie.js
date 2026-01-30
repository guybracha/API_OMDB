const API = "http://127.0.0.1:8000";
const status = document.getElementById("status");
const movieBox = document.getElementById("movie");
const results = document.getElementById("results");
const btn = document.getElementById("btn");
const topInput = document.getElementById("top");

const params = new URLSearchParams(location.search);
const imdbID = params.get("imdbID");

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

// Status messages
function setStatus(msg, kind="") {
  if (!msg) { status.innerHTML = ""; return; }
  status.innerHTML = (kind === "error")
    ? `<div class="alert alert-danger" role="alert"><i class="bi bi-exclamation-triangle"></i> ${msg}</div>`
    : `<div class="alert alert-info" role="alert"><i class="bi bi-info-circle"></i> ${msg}</div>`;
}

// Movie card rendering
function movieCard(m) {
  const poster = (m.Poster && m.Poster !== "N/A") ? m.Poster : "";
  const rating = m.imdbRating && m.imdbRating !== "N/A" ? m.imdbRating : "—";
  const year   = m.Year || "";
  const genre  = m.Genre || "";
  const score  = (m.score !== undefined) ? `<span class="badge">score: ${m.score}</span>` : "";
  
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
          ${poster ? `<img class="poster" src="${poster}">` : `<div class="poster"></div>`}
          <div class="flex-grow-1">
            <h6 class="mb-1">${m.Title}</h6>
            <div class="text-muted small">${year} • <i class="bi bi-star-fill text-warning"></i> ${rating}</div>
            <div class="text-muted small mt-2">${genre}</div>
            <div class="mt-2">${score}</div>
            ${why}
          </div>
        </div>
      </div>
    </div>
  `;
}

// Load movie details
async function loadMovie() {
  if (!imdbID) {
    setStatus("חסר imdbID בכתובת. דוגמה: movie.html?imdbID=tt1375666", "error");
    return;
  }

  setStatus("טוען פרטי סרט…");
  const res = await fetch(`${API}/movie/by_id?imdbID=${encodeURIComponent(imdbID)}`);
  const data = await res.json();

  if (!data.ok) {
    setStatus(data.error || "שגיאה", "error");
    return;
  }

  const m = data.movie;
  document.title = m.Title || "Movie";

  const poster = (m.Poster && m.Poster !== "N/A") ? m.Poster : "";
  movieBox.style.display = "block";
  movieBox.innerHTML = `
    <div class="row g-4">
      <div class="col-12 col-md-auto text-center">
        ${poster ? `<img class="poster-large" src="${poster}" alt="poster">` : `<div class="poster-large"></div>`}
      </div>
      <div class="col">
        <h2 class="mb-3">${m.Title} <span class="text-muted fs-5">(${m.Year || ""})</span></h2>
        <div class="mb-3">
          <i class="bi bi-star-fill text-warning"></i> ${m.imdbRating || "—"} • 
          <i class="bi bi-clock"></i> ${m.Runtime || ""} • 
          <span class="text-muted">${m.Genre || ""}</span>
        </div>
        <div class="mb-3">
          <span class="badge me-2">${m.imdbID}</span>
          ${m.Rated ? `<span class="badge me-2">${m.Rated}</span>` : ""}
          ${m.Language ? `<span class="badge me-2">${m.Language}</span>` : ""}
        </div>
        <div class="d-flex gap-2 flex-wrap mb-3">
          <button id="favBtn" class="btn btn-secondary"><i class="bi bi-star"></i> שמור למועדפים</button>
          <button class="btn btn-secondary" onclick="navigator.clipboard.writeText(location.href)"><i class="bi bi-link-45deg"></i> העתק קישור</button>
        </div>
        <div class="mb-2"><strong><i class="bi bi-person-video3"></i> Director:</strong> <span class="text-muted">${m.Director || "—"}</span></div>
        <div class="mb-3"><strong><i class="bi bi-people"></i> Actors:</strong> <span class="text-muted">${m.Actors || "—"}</span></div>
        <div class="mt-3 lh-lg">${m.Plot || ""}</div>
      </div>
    </div>
  `;

  // הוספה להיסטוריה
  addUnique("history", { imdbID: m.imdbID, Title: m.Title, Year: m.Year, Poster: m.Poster });

  // כפתור מועדפים
  const favBtn = document.getElementById("favBtn");
  function refreshFavBtn() {
    if (isFav(m.imdbID)) {
      favBtn.innerHTML = '<i class="bi bi-star-fill"></i> נמצא במועדפים';
      favBtn.classList.remove('btn-secondary');
      favBtn.classList.add('btn-success');
    } else {
      favBtn.innerHTML = '<i class="bi bi-star"></i> שמור למועדפים';
      favBtn.classList.remove('btn-success');
      favBtn.classList.add('btn-secondary');
    }
  }
  refreshFavBtn();

  favBtn.addEventListener("click", () => {
    if (isFav(m.imdbID)) {
      removeById("favorites", m.imdbID);
    } else {
      addUnique("favorites", { imdbID: m.imdbID, Title: m.Title, Year: m.Year, Poster: m.Poster });
    }
    refreshFavBtn();
  });

  setStatus("מוכן ✅");
}

// Get recommendations
async function recommend() {
  const top = topInput.value.trim() || "10";
  btn.disabled = true;
  setStatus("מביא המלצות…");

  try {
    const res = await fetch(`${API}/ai/recommend_by_id?imdbID=${encodeURIComponent(imdbID)}&top=${encodeURIComponent(top)}`);
    const data = await res.json();

    if (!data.ok) {
      setStatus(data.error || "שגיאה", "error");
      results.innerHTML = "";
      return;
    }

    const recs = data.recommendations || [];
    if (!recs.length) {
      setStatus("לא נמצאו המלצות.", "error");
      results.innerHTML = "";
      return;
    }

    setStatus(`נמצאו ${recs.length} המלצות ✅`);
    results.innerHTML = recs.map(movieCard).join("");
  } finally {
    btn.disabled = false;
  }
}

// Event listeners
btn.addEventListener("click", recommend);

// Load movie on page load
loadMovie();

// GSAP Animations
gsap.from("h1", {
  duration: 1,
  x: -50,
  opacity: 0,
  ease: "power3.out"
});

gsap.from(".card", {
  duration: 0.8,
  y: 30,
  opacity: 0,
  stagger: 0.2,
  ease: "power3.out",
  delay: 0.3
});

// אנימציה להופעת תוצאות המלצות
const resultsObserver = new MutationObserver(() => {
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
resultsObserver.observe(results, { childList: true });

// אנימציה לפוסטר
const movieObserver = new MutationObserver(() => {
  const poster = movieBox.querySelector('.poster-large');
  if (poster) {
    gsap.from(poster, {
      duration: 1,
      scale: 0.5,
      rotation: -15,
      opacity: 0,
      ease: "elastic.out(1, 0.5)"
    });
  }
});
movieObserver.observe(movieBox, { childList: true, subtree: true });
