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

    model_config = SettingsConfigDict(
        env_file=(".env", str(BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )



settings = Settings()

# Ensure storage path exists
os.makedirs(settings.STORAGE_PATH, exist_ok=True)
