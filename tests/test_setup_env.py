import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from dotenv import dotenv_values

import setup_env


class SetupTests(unittest.TestCase):
    def test_first_run_saves_key_without_printing_it(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            with patch.object(setup_env, "ENV_PATH", path), \
                 patch("setup_env.os.getenv", return_value=None), \
                 patch("setup_env.getpass", return_value="example-private-key"), \
                 patch("builtins.print") as output:
                setup_env.configure()
            self.assertEqual(dotenv_values(path)["POISKKINO_API_KEY"], "example-private-key")
            self.assertNotIn("example-private-key", str(output.call_args_list))

    def test_existing_key_is_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            path.write_text("POISKKINO_API_KEY=existing-key\n", encoding="utf-8")
            with patch.object(setup_env, "ENV_PATH", path), \
                 patch("setup_env.os.getenv", return_value=None), \
                 patch("setup_env.getpass") as prompt, patch("builtins.print"):
                setup_env.configure()
                prompt.assert_not_called()
            self.assertEqual(dotenv_values(path)["POISKKINO_API_KEY"], "existing-key")

    def test_empty_input_does_not_create_env(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            with patch.object(setup_env, "ENV_PATH", path), \
                 patch("setup_env.os.getenv", return_value=None), \
                 patch("setup_env.getpass", return_value=""), patch("builtins.print"):
                with self.assertRaises(SystemExit):
                    setup_env.configure()
            self.assertFalse(path.exists())
