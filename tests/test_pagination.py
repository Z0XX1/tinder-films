import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

from app import create_app, get_db


def response(ids, cursor=None):
    result = Mock(status_code=200)
    result.json.return_value = {
        "docs": [{"id": i, "name": f"Film {i}", "genres": []} for i in ids],
        "next": cursor, "hasNext": bool(cursor)
    }
    return result


class PaginationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.config = {"TESTING": True, "DATABASE": str(Path(self.temp.name) / "db.sqlite3"),
                       "POISKKINO_API_KEY": "test-key"}
        self.app = create_app(self.config)
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def remote(self, result):
        session = patch("app.requests.Session")
        mocked = session.start()
        self.addCleanup(session.stop)
        mocked.return_value.__enter__.return_value.get.return_value = result
        return mocked.return_value.__enter__.return_value.get

    def test_500_unique_movies_and_cursor_after_restart(self):
        remote = self.remote(response(range(1, 51), "cursor-1"))
        self.assertEqual(len(self.client.get("/api/movies").json), 50)
        self.assertNotIn("next", remote.call_args.kwargs["params"])
        self.client = create_app(self.config).test_client()
        collected = set(range(1, 51))
        for page in range(1, 10):
            remote.return_value = response(range(page * 50 + 1, page * 50 + 51), f"cursor-{page + 1}")
            data = self.client.get("/api/movies/next").json
            self.assertEqual(remote.call_args.kwargs["params"]["next"], f"cursor-{page}")
            self.assertFalse(collected.intersection(movie["id"] for movie in data["movies"]))
            collected.update(movie["id"] for movie in data["movies"])
        self.assertEqual(len(collected), 500)
        self.assertEqual(data["total"], 500)
        self.assertFalse(data["has_more"])
        remote.reset_mock()
        self.assertEqual(self.client.get("/api/movies/next").json["movies"], [])
        remote.assert_not_called()

    def test_duplicate_ids_and_existing_favorites(self):
        self.remote(response(range(1, 51), "next-page"))
        self.client.get("/api/movies")
        self.client.post("/api/favorites", json={"movie_id": 1})
        with patch("app.requests.Session") as session:
            session.return_value.__enter__.return_value.get.return_value = response(range(41, 91))
            data = self.client.get("/api/movies/next").json
        self.assertEqual(len(data["movies"]), 40)
        self.assertEqual(data["total"], 90)
        self.assertFalse(data["has_more"])
        self.assertEqual(self.client.get("/api/favorites").json[0]["id"], 1)

    def test_failure_retries_same_cursor(self):
        remote = self.remote(response(range(1, 51), "retry-cursor"))
        self.client.get("/api/movies")
        remote.side_effect = requests.Timeout()
        self.assertEqual(self.client.get("/api/movies/next").status_code, 502)
        remote.side_effect = None
        remote.return_value = response(range(51, 101))
        self.assertEqual(self.client.get("/api/movies/next").json["total"], 100)
        self.assertEqual(remote.call_args.kwargs["params"]["next"], "retry-cursor")

    def test_migration_keeps_legacy_movies_and_favorites(self):
        with self.app.app_context():
            db = get_db()
            with db:
                db.execute("INSERT INTO movies VALUES (?, ?)", (1, json.dumps({"id": 1})))
                db.execute("INSERT INTO favorites (movie_id) VALUES (1)")
                db.execute("DROP TABLE catalog_state")
        client = create_app(self.config).test_client()
        self.remote(response(range(1, 51), "cursor"))
        result = client.get("/api/movies/next").json
        self.assertEqual(result["total"], 50)
        self.assertEqual(len(result["movies"]), 49)
        self.assertEqual(client.get("/api/favorites").json, [{"id": 1}])

    def test_invalid_cursor_does_not_save_page(self):
        self.remote(response(range(1, 51), "cursor"))
        self.client.get("/api/movies")
        with patch("app.requests.Session") as session:
            session.return_value.__enter__.return_value.get.return_value = response(range(51, 101), "cursor")
            self.assertEqual(self.client.get("/api/movies/next").status_code, 502)
        self.assertEqual(len(self.client.get("/api/movies").json), 50)
