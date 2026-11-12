"""Настройка ключа на компьютере пользователя без публикации в Git."""
import os
from getpass import getpass
from pathlib import Path

from dotenv import dotenv_values, set_key

ENV_PATH = Path(__file__).resolve().parent / ".env"


def configure():
    key = os.getenv("POISKKINO_API_KEY") or dotenv_values(ENV_PATH).get("POISKKINO_API_KEY")
    if key and key.strip():
        print("API key is configured. Starting KinoTinder...")
        return
    print("Get an API key at https://poiskkino.dev/")
    print("Paste it below. Input is hidden; the key stays in your local .env file.")
    key = getpass("POISKKINO_API_KEY: ").strip()
    if not key:
        raise SystemExit("No API key entered. Run start.bat again when ready.")
    set_key(ENV_PATH, "POISKKINO_API_KEY", key)
    print("API key saved to .env.")


if __name__ == "__main__":
    configure()
