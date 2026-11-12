"""Flask API и локальная SQLite для КиноТиндера."""
import json
import os
import sqlite3
from pathlib import Path
from threading import Lock

import requests
from dotenv import load_dotenv
from flask import Flask, current_app, g, jsonify, request

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
POISKKINO_URL = "https://api.poiskkino.dev/v1.5"
BATCH_SIZE = 50
MAX_MOVIES = 500


class APIError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE"], timeout=15)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def poiskkino_get(session, path, **params):
    try:
        response = session.get(f"{POISKKINO_URL}{path}", params=params, timeout=(5, 15))
        if response.status_code in (401, 403):
            raise APIError("ПоискКино API отклонил ключ. Проверь POISKKINO_API_KEY в .env.")
        if response.status_code == 429:
            raise APIError("Лимит запросов ПоискКино API исчерпан. Попробуй позже.", 503)
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            raise ValueError("Expected object")
        return data
    except (requests.RequestException, ValueError) as error:
        raise APIError("Не удалось получить фильмы из ПоискКино API. Попробуй позже.") from error


def import_movies():
    db = get_db()
    count = db.execute("SELECT COUNT(*) FROM movies").fetchone()[0]
    state = db.execute("SELECT next_cursor, exhausted FROM catalog_state WHERE id = 1").fetchone()
    if count >= MAX_MOVIES or state["exhausted"]:
        return []
    key = current_app.config["POISKKINO_API_KEY"]
    if not key:
        raise APIError("Добавь POISKKINO_API_KEY в файл .env и перезапусти Flask.", 503)
    params = dict(limit=BATCH_SIZE, type="movie", sortField="votes.kp", sortType="-1")
    if state["next_cursor"]:
        params["next"] = state["next_cursor"]
    movies = []
    with requests.Session() as session:
        session.headers.update({"X-API-KEY": key, "Accept": "application/json"})
        collection = poiskkino_get(session, "/movie", **params)
        items = collection.get("docs")
        if not isinstance(items, list):
            raise APIError("ПоискКино API вернул неожиданный формат подборки.")
        for film in items:
            movie_id = film.get("id")
            if type(movie_id) is not int or movie_id <= 0:
                raise APIError("ПоискКино API вернул некорректный ID фильма.")
            poster = film.get("poster") or {}
            movies.append({
                "id": movie_id,
                "title": film.get("name") or film.get("alternativeName") or "Без названия",
                "year": film.get("year"),
                "genres": [genre["name"] for genre in (film.get("genres") or []) if genre.get("name")],
                "rating": (film.get("rating") or {}).get("kp"),
                "poster": poster.get("url") or poster.get("previewUrl") or "",
                "description": film.get("shortDescription") or film.get("description") or "Описание пока недоступно."
            })
    next_cursor = collection.get("next")
    has_next = collection.get("hasNext", bool(next_cursor))
    if has_next and (not isinstance(next_cursor, str) or not next_cursor or next_cursor == state["next_cursor"]):
        raise APIError("ПоискКино API не вернул корректный курсор следующей страницы.")
    # Фильмы и курсор сохраняются вместе. Ошибка не пропускает страницу.
    added = []
    with db:
        for movie in movies:
            if count + len(added) >= MAX_MOVIES:
                break
            inserted = db.execute("INSERT OR IGNORE INTO movies (id, data) VALUES (?, ?)",
                                  (movie["id"], json.dumps(movie, ensure_ascii=False)))
            if inserted.rowcount:
                added.append(movie)
        db.execute("UPDATE catalog_state SET next_cursor = ?, exhausted = ? WHERE id = 1",
                   (next_cursor if has_next else None, int(not has_next)))
    return added


def create_app(test_config=None):
    app = Flask(__name__, static_folder=str(ROOT / "frontend"), static_url_path="")
    app.json.ensure_ascii = False
    app.config.update(
        DATABASE=str(ROOT / "instance" / "kinotinder.sqlite3"),
        POISKKINO_API_KEY=os.getenv("POISKKINO_API_KEY", "").strip(),
        MAX_CONTENT_LENGTH=4096,
    )
    if test_config:
        app.config.update(test_config)
    Path(app.config["DATABASE"]).parent.mkdir(parents=True, exist_ok=True)
    import_lock = Lock()

    @app.teardown_appcontext
    def close_db(error=None):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    with app.app_context():
        get_db().executescript("""
            CREATE TABLE IF NOT EXISTS movies (
                id INTEGER PRIMARY KEY,
                data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS catalog_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                next_cursor TEXT,
                exhausted INTEGER NOT NULL DEFAULT 0
            );
            INSERT OR IGNORE INTO catalog_state (id) VALUES (1);
            CREATE TABLE IF NOT EXISTS favorites (
                movie_id INTEGER PRIMARY KEY REFERENCES movies(id) ON DELETE CASCADE,
                added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        """)

    @app.errorhandler(APIError)
    def api_error(error):
        return jsonify(error=str(error)), error.status

    @app.errorhandler(sqlite3.Error)
    def database_error(error):
        app.logger.error("SQLite operation failed: %s", type(error).__name__)
        return jsonify(error="Не удалось обратиться к локальной базе данных."), 500

    @app.get("/")
    def index():
        return app.send_static_file("index.html")

    @app.get("/api/movies")
    def movies():
        with import_lock:
            rows = get_db().execute("SELECT data FROM movies ORDER BY id").fetchall()
            data = [json.loads(row["data"]) for row in rows] if rows else import_movies()
        return jsonify(data)

    @app.get("/api/movies/next")
    def next_movies():
        with import_lock:
            added = import_movies()
            db = get_db()
            total = db.execute("SELECT COUNT(*) FROM movies").fetchone()[0]
            exhausted = db.execute("SELECT exhausted FROM catalog_state WHERE id = 1").fetchone()[0]
        return jsonify(movies=added, has_more=not exhausted and total < MAX_MOVIES,
                       total=total, limit=MAX_MOVIES)

    @app.get("/api/favorites")
    def favorites():
        rows = get_db().execute("""
            SELECT movies.data FROM favorites JOIN movies ON movies.id = favorites.movie_id
            ORDER BY favorites.added_at, favorites.movie_id
        """).fetchall()
        return jsonify([json.loads(row["data"]) for row in rows])

    @app.post("/api/favorites")
    def add_favorite():
        body = request.get_json(silent=True)
        movie_id = body.get("movie_id") if isinstance(body, dict) else None
        if type(movie_id) is not int or movie_id <= 0:
            return jsonify(error="movie_id должен быть положительным целым числом."), 400
        db = get_db()
        row = db.execute("SELECT data FROM movies WHERE id = ?", (movie_id,)).fetchone()
        if row is None:
            return jsonify(error="Фильм не найден в локальном каталоге."), 404
        with db:
            db.execute("INSERT OR IGNORE INTO favorites (movie_id) VALUES (?)", (movie_id,))
        return jsonify(json.loads(row["data"]))

    @app.delete("/api/favorites/<int:movie_id>")
    def remove_favorite(movie_id):
        db = get_db()
        with db:
            db.execute("DELETE FROM favorites WHERE movie_id = ?", (movie_id,))
        return "", 204

    return app


if __name__ == "__main__":
    create_app().run(host="127.0.0.1", port=5000, debug=False)
