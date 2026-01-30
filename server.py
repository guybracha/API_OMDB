import os
import re
from flask import Flask, request, jsonify
from flask_cors import CORS
import requests

app = Flask(__name__)
CORS(app)

OMDB_KEY = os.getenv("OMDB_API_KEY")
OMDB_URL = "http://www.omdbapi.com/"

def omdb_get(params: dict):
    if not OMDB_KEY:
        return {"Response": "False", "Error": "Missing OMDB_API_KEY env var"}

    params = {**params, "apikey": OMDB_KEY}
    r = requests.get(OMDB_URL, params=params, timeout=15)

    # לפעמים יגיע טקסט/HTML במקרה של תקלה — נשמור על יציבות
    try:
        data = r.json()
    except Exception:
        return {"Response": "False", "Error": "Non-JSON response from OMDb", "raw_text": r.text[:500]}

    if data.get("Response") != "True":
        return {"Response": "False", "Error": data.get("Error", "Unknown OMDb error"), "raw": data}

    return data

def split_csv(s: str):
    if not s:
        return []
    return [x.strip() for x in s.split(",") if x.strip()]

def norm_words(s: str):
    # ניקוי מילים מהכותרת כדי להפיק keywords טובים לחיפוש
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    words = [w for w in s.split() if len(w) >= 4]
    # מורידים מילים ממש נפוצות
    stop = {"the", "and", "with", "from", "this", "that", "movie", "film"}
    return [w for w in words if w not in stop][:3]

def safe_float(x, default=0.0):
    try:
        return float(x)
    except Exception:
        return default

def explain(seed, cand):
    seed_genres = set(split_csv(seed.get("Genre", "")))
    cand_genres = set(split_csv(cand.get("Genre", "")))
    g = list(seed_genres & cand_genres)

    seed_actors = set(split_csv(seed.get("Actors", "")))
    cand_actors = set(split_csv(cand.get("Actors", "")))
    a = list(seed_actors & cand_actors)

    seed_director = set(split_csv(seed.get("Director", "")))
    cand_director = set(split_csv(cand.get("Director", "")))
    d = list(seed_director & cand_director)

    why = []
    if g:
        why.append({"type": "genres", "items": g[:4]})
    if d:
        why.append({"type": "director", "items": d[:2]})
    if a:
        why.append({"type": "actors", "items": a[:4]})

    # fallback
    if not why:
        why.append({"type": "rating", "items": [f"IMDb {cand.get('imdbRating', 'N/A')}"]})

    return why

def candidate_score(seed, cand):
    # תכונות
    seed_genres = set(split_csv(seed.get("Genre", "")))
    cand_genres = set(split_csv(cand.get("Genre", "")))

    seed_actors = set(split_csv(seed.get("Actors", "")))
    cand_actors = set(split_csv(cand.get("Actors", "")))

    seed_director = set(split_csv(seed.get("Director", "")))
    cand_director = set(split_csv(cand.get("Director", "")))

    # חפיפות
    genre_overlap = len(seed_genres & cand_genres)
    actor_overlap = len(seed_actors & cand_actors)
    director_overlap = len(seed_director & cand_director)

    rating = safe_float(cand.get("imdbRating"), 0.0)

    # ניקוד (משקלים)
    score = (
        genre_overlap * 4 +
        actor_overlap * 2 +
        director_overlap * 3 +
        rating * 1.2
    )

    # בונוס אם אותה שנה +/- 3 (קצת "אותו וייב")
    seed_year = safe_float(seed.get("Year"), 0)
    cand_year = safe_float(cand.get("Year"), 0)
    if seed_year and cand_year and abs(seed_year - cand_year) <= 3:
        score += 1.0

    return score

def search_candidates(seed, limit_pages=2):
    """
    מייצר רשימת מועמדים ע"י כמה שאילתות Search שונות:
    - ז'אנר + מילת מפתח מהכותרת
    - שם הבמאי
    - 1-2 שחקנים מובילים
    """
    title_words = norm_words(seed.get("Title", ""))
    genres = split_csv(seed.get("Genre", ""))[:2]
    director = split_csv(seed.get("Director", ""))[:1]
    actors = split_csv(seed.get("Actors", ""))[:2]

    queries = []

    # 1) ז'אנר + מילת כותרת
    if genres:
        q = genres[0]
        if title_words:
            q += " " + title_words[0]
        queries.append(q)

    # 2) עוד ז'אנר
    if len(genres) > 1:
        queries.append(genres[1])

    # 3) במאי
    if director:
        queries.append(director[0])

    # 4) שחקנים
    queries += actors

    # ניקוי כפילויות
    seen = set()
    queries = [q for q in queries if q and not (q.lower() in seen or seen.add(q.lower()))]

    # ביצוע חיפוש
    imdb_ids = []
    for q in queries[:6]:
        for page in range(1, limit_pages + 1):
            res = omdb_get({"s": q, "type": "movie", "page": str(page)})
            if res.get("Response") != "True":
                break
            for item in res.get("Search", []):
                iid = item.get("imdbID")
                if iid and iid not in imdb_ids:
                    imdb_ids.append(iid)

    return imdb_ids

@app.get("/search")
def search_movies():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"ok": False, "error": "Missing ?q=..."}), 400

    data = omdb_get({"s": q, "type": "movie"})
    if data.get("Response") != "True":
        return jsonify({"ok": False, "error": data.get("Error"), "raw": data.get("raw")}), 404

    return jsonify({"ok": True, "results": data.get("Search", [])})

@app.get("/movie/by_id")
def movie_by_id():
    imdb_id = request.args.get("imdbID", "").strip()
    if not imdb_id:
        return jsonify({"ok": False, "error": "Missing ?imdbID=..."}), 400

    data = omdb_get({"i": imdb_id, "plot": "full"})
    if data.get("Response") != "True":
        return jsonify({"ok": False, "error": data.get("Error"), "raw": data.get("raw")}), 404

    return jsonify({"ok": True, "movie": data})

@app.get("/ai/recommend_by_id")
def ai_recommend_by_id():
    imdb_id = request.args.get("imdbID", "").strip()
    top = request.args.get("top", "10").strip()

    if not imdb_id:
        return jsonify({"ok": False, "error": "Missing ?imdbID=..."}), 400

    try:
        top_n = max(1, min(20, int(top)))
    except:
        top_n = 10

    seed = omdb_get({"i": imdb_id, "type": "movie", "plot": "short"})
    if seed.get("Response") != "True":
        return jsonify({"ok": False, "error": seed.get("Error"), "raw": seed.get("raw")}), 404

    ids = search_candidates(seed, limit_pages=2)

    scored = []
    for iid in ids[:60]:
        cand = omdb_get({"i": iid, "plot": "short"})
        if cand.get("Response") == "True":
            if cand.get("imdbID") == seed.get("imdbID"):
                continue
            scored.append((candidate_score(seed, cand), cand))

    scored.sort(key=lambda x: x[0], reverse=True)

    recs = [{
        "Title": m.get("Title"),
        "Year": m.get("Year"),
        "Genre": m.get("Genre"),
        "Director": m.get("Director"),
        "Actors": m.get("Actors"),
        "imdbRating": m.get("imdbRating"),
        "imdbID": m.get("imdbID"),
        "Poster": m.get("Poster"),
        "score": round(score, 2),
        "why": explain(seed, m)
    } for score, m in scored[:top_n]]

    return jsonify({
        "ok": True,
        "seed": {
            "Title": seed.get("Title"),
            "Year": seed.get("Year"),
            "Genre": seed.get("Genre"),
            "Director": seed.get("Director"),
            "Actors": seed.get("Actors"),
            "imdbRating": seed.get("imdbRating"),
            "imdbID": seed.get("imdbID"),
            "Poster": seed.get("Poster")
        },
        "recommendations": recs
    })

@app.get("/ai/recommend")
def recommend():
    """
    /ai/recommend?title=Inception&top=10
    אופציונלי: &year=2010
    """
    title = request.args.get("title", "").strip()
    year = request.args.get("year", "").strip()
    top = request.args.get("top", "10").strip()

    if not title:
        return jsonify({"ok": False, "error": "Missing ?title=..."}), 400

    try:
        top_n = max(1, min(20, int(top)))  # עד 20
    except Exception:
        top_n = 10

    seed_params = {"t": title, "type": "movie", "plot": "short"}
    if year:
        seed_params["y"] = year

    seed = omdb_get(seed_params)
    if seed.get("Response") != "True":
        return jsonify({"ok": False, "error": seed.get("Error"), "raw": seed.get("raw")}), 404

    # מביאים מועמדים
    ids = search_candidates(seed, limit_pages=2)

    # מביאים פרטים מלאים + ניקוד
    scored = []
    for iid in ids[:60]:  # תקרה כדי לא להשתולל בבקשות
        cand = omdb_get({"i": iid, "plot": "short"})
        if cand.get("Response") == "True":
            if cand.get("imdbID") == seed.get("imdbID"):
                continue
            scored.append((candidate_score(seed, cand), cand))

    scored.sort(key=lambda x: x[0], reverse=True)

    recs = []
    for score, m in scored[:top_n]:
        recs.append({
            "Title": m.get("Title"),
            "Year": m.get("Year"),
            "Genre": m.get("Genre"),
            "Director": m.get("Director"),
            "Actors": m.get("Actors"),
            "imdbRating": m.get("imdbRating"),
            "imdbID": m.get("imdbID"),
            "Poster": m.get("Poster"),
            "score": round(score, 2),
            "why": explain(seed, m)
        })

    return jsonify({
        "ok": True,
        "seed": {
            "Title": seed.get("Title"),
            "Year": seed.get("Year"),
            "Genre": seed.get("Genre"),
            "Director": seed.get("Director"),
            "Actors": seed.get("Actors"),
            "imdbRating": seed.get("imdbRating"),
            "imdbID": seed.get("imdbID")
        },
        "recommendations": recs
    })

@app.post("/ai/recommend_for_user")
def recommend_for_user():
    body = request.get_json(silent=True) or {}
    fav_ids = body.get("favorites", [])[:20]

    if not fav_ids:
        return jsonify({"ok": False, "error": "No favorites provided"}), 400

    # בונים "seed משולב" מכל המועדפים
    movies = []
    for iid in fav_ids:
        m = omdb_get({"i": iid})
        if m.get("Response") == "True":
            movies.append(m)

    if not movies:
        return jsonify({"ok": False, "error": "Could not load favorite movies"}), 400

    # מאחדים ז'אנרים/שחקנים/במאים למעין "וקטור טעם"
    taste = {
        "Genre": ", ".join({g for mv in movies for g in split_csv(mv.get("Genre",""))}),
        "Actors": ", ".join({a for mv in movies for a in split_csv(mv.get("Actors",""))}),
        "Director": ", ".join({d for mv in movies for d in split_csv(mv.get("Director",""))}),
        "Year": movies[0].get("Year")
    }

    ids = search_candidates(taste, limit_pages=2)

    scored = []
    fav_set = set(fav_ids)
    for iid in ids[:80]:
        if iid in fav_set:
            continue
        cand = omdb_get({"i": iid})
        if cand.get("Response") == "True":
            scored.append((candidate_score(taste, cand), cand))

    scored.sort(key=lambda x: x[0], reverse=True)

    recs = []
    for score, m in scored[:15]:
        recs.append({
            "Title": m.get("Title"),
            "Year": m.get("Year"),
            "Genre": m.get("Genre"),
            "imdbRating": m.get("imdbRating"),
            "imdbID": m.get("imdbID"),
            "Poster": m.get("Poster"),
            "score": round(score, 2),
        })

    return jsonify({"ok": True, "recommendations": recs})

@app.get("/health")
def health():
    return jsonify({"ok": True})

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=True)
