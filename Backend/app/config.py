import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
_DEFAULT_DB = f"sqlite+aiosqlite:///{BACKEND_DIR / 'recruitment_platform.db'}"


class Settings(BaseSettings):
    DATABASE_URL: str = _DEFAULT_DB
    OPENAI_API_KEY: str = "test_key"
    PINECONE_API_KEY: str = "test_key"
    PINECONE_ENVIRONMENT: str = "us-east-1"
    PINECONE_INDEX_NAME: str = "recruitment-platform"
    STORAGE_PATH: str = "./data/resumes"
    MAX_UPLOAD_BYTES: int = 10 * 1024 * 1024
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"
    ALLOW_DEVELOPMENT_FALLBACKS: bool = False

    model_config = SettingsConfigDict(
        env_file=(".env", str(BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )



settings = Settings()


def get_cors_origins() -> list[str]:
    return [origin.strip() for origin in settings.CORS_ORIGINS.split(",") if origin.strip()]

# Resolve relative SQLite URLs consistently against Backend. SQLAlchemy's
# sqlite:///./file.db form is otherwise relative to the shell's current folder.
_SQLITE_PREFIX = "sqlite+aiosqlite:///"
if settings.DATABASE_URL.startswith(_SQLITE_PREFIX):
    database_path = settings.DATABASE_URL.removeprefix(_SQLITE_PREFIX)
    if database_path and database_path != ":memory:":
        resolved_database = Path(database_path).expanduser()
        if not resolved_database.is_absolute():
            resolved_database = BACKEND_DIR / resolved_database
        settings.DATABASE_URL = f"{_SQLITE_PREFIX}{resolved_database.resolve()}"

# Resolve relative storage consistently against Backend, regardless of where
# uvicorn was launched from.
storage_path = Path(settings.STORAGE_PATH).expanduser()
if not storage_path.is_absolute():
    storage_path = BACKEND_DIR / storage_path
settings.STORAGE_PATH = str(storage_path.resolve())
os.makedirs(settings.STORAGE_PATH, exist_ok=True)
