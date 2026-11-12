import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

from app import create_app, get_db


class AppTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.config = {"TESTING": True, "DATABASE": str(Path(self.temp.name) / "test.sqlite3"),
                       "POISKKINO_API_KEY": "test-key"}
        self.app = create_app(self.config)
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def import_fixture(self):
        response = Mock(status_code=200)
        response.json.return_value = {"docs": [{
            "id": 123, "name": "Фильм из API", "year": 2024,
            "genres": [{"name": "драма"}], "rating": {"kp": 8.1},
            "poster": {"url": "https://example.com/poster.jpg"},
            "description": "Описание из API"
        }]}
        with patch("app.requests.Session") as session:
            session.return_value.__enter__.return_value.get.return_value = response
            result = self.client.get("/api/movies")
            call = session.return_value.__enter__.return_value.get.call_args
            self.assertEqual(call.args[0], "https://api.poiskkino.dev/v1.5/movie")
            self.assertEqual(call.kwargs["params"]["limit"], 50)
        self.assertEqual(result.status_code, 200)
        return result.json

    def test_import_and_cache_survive_restart(self):
        movies = self.import_fixture()
        self.assertEqual(set(movies[0]), {"id", "title", "year", "genres", "rating", "poster", "description"})
        self.assertEqual(movies[0]["genres"], ["драма"])
        restarted = create_app({**self.config, "POISKKINO_API_KEY": ""})
        with patch("app.requests.Session") as remote:
            self.assertEqual(restarted.test_client().get("/api/movies").json, movies)
            remote.assert_not_called()

    def test_favorites_persistence_deduplication_and_removal(self):
        self.import_fixture()
        for _ in range(2):
            self.assertEqual(self.client.post("/api/favorites", json={"movie_id": 123}).status_code, 200)
        restarted = create_app(self.config).test_client()
        self.assertEqual(len(restarted.get("/api/favorites").json), 1)
        self.assertEqual(restarted.delete("/api/favorites/123").status_code, 204)
        self.assertEqual(self.client.get("/api/favorites").json, [])
        self.assertEqual(restarted.delete("/api/favorites/123").status_code, 204)

    def test_invalid_favorite_requests(self):
        for body in [None, [], {}, {"movie_id": True}, {"movie_id": "123"}, {"movie_id": -1}]:
            self.assertEqual(self.client.post("/api/favorites", json=body).status_code, 400)
        self.assertEqual(self.client.post("/api/favorites", json={"movie_id": 999}).status_code, 404)

    def test_missing_key_is_clear_error(self):
        client = create_app({**self.config, "POISKKINO_API_KEY": ""}).test_client()
        result = client.get("/api/movies")
        self.assertEqual(result.status_code, 503)
        self.assertIn(".env", result.json["error"])

    def test_provider_errors_leave_database_empty(self):
        for status in (401, 429):
            with self.subTest(status=status), patch("app.requests.Session") as session:
                session.return_value.__enter__.return_value.get.return_value.status_code = status
                result = self.client.get("/api/movies")
                self.assertIn(result.status_code, (502, 503))
                self.assertNotIn("test-key", result.get_data(as_text=True))
        with self.app.app_context():
            self.assertEqual(get_db().execute("SELECT COUNT(*) FROM movies").fetchone()[0], 0)

    def test_timeout(self):
        with patch("app.requests.Session") as session:
            session.return_value.__enter__.return_value.get.side_effect = requests.Timeout()
            self.assertEqual(self.client.get("/api/movies").status_code, 502)

    def test_frontend_and_secrets(self):
        for path in ("/", "/api.js"):
            with self.client.get(path) as response:
                self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/.env").status_code, 404)
        self.assertEqual(self.client.get("/instance/kinotinder.sqlite3").status_code, 404)


if __name__ == "__main__":
    unittest.main()
