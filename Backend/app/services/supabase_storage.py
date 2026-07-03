import uuid
import logging
from typing import Optional
from app.config import settings

logger = logging.getLogger(__name__)

_supabase_client = None        # anon client (kept for compatibility)
_supabase_service_client = None  # service-role client used for storage uploads


def _get_storage_client():
    """
    Return a Supabase client that uses the service_role key so that
    Storage uploads bypass Row Level Security (RLS).
    Falls back to the anon key if no service key is configured.
    """
    global _supabase_service_client
    if _supabase_service_client is not None:
        return _supabase_service_client

    url = settings.SUPABASE_URL
    # Prefer service_role key — it bypasses RLS for server-side operations
    key = settings.SUPABASE_SERVICE_KEY or settings.SUPABASE_KEY
    if not url or not key:
        return None

    if not settings.SUPABASE_SERVICE_KEY:
        logger.warning(
            "SUPABASE_SERVICE_KEY is not set. Using the anon/publishable key for storage "
            "uploads. This will fail if RLS policies restrict inserts. "
            "Set SUPABASE_SERVICE_KEY in your .env to fix this."
        )

    try:
        from supabase import create_client
        _supabase_service_client = create_client(url, key)
        return _supabase_service_client
    except Exception as e:
        logger.error(f"Failed to initialize Supabase storage client: {e}")
        return None


def get_supabase_client():
    """Return anon client (kept for backward compat). For uploads use _get_storage_client()."""
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client
    if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
        return None
    try:
        from supabase import create_client
        _supabase_client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
        return _supabase_client
    except Exception as e:
        logger.error(f"Failed to initialize Supabase client: {e}")
        return None


def is_supabase_configured() -> bool:
    return bool(settings.SUPABASE_URL and settings.SUPABASE_KEY)


def _ensure_bucket_exists(client, bucket_name: str) -> bool:
    """Check if the storage bucket exists, and attempt to create it if missing."""
    try:
        buckets = client.storage.list_buckets()
        for b in buckets:
            b_id = getattr(b, "id", None) or (b.get("id") if isinstance(b, dict) else None)
            b_name = getattr(b, "name", None) or (b.get("name") if isinstance(b, dict) else None)
            if b_id == bucket_name or b_name == bucket_name:
                return True
    except Exception as e:
        logger.debug(f"Could not list buckets: {e}")

    logger.info(f"Supabase bucket '{bucket_name}' not found. Attempting to create public bucket...")
    try:
        client.storage.create_bucket(bucket_name, options={"public": True})
        logger.info(f"Successfully created public storage bucket '{bucket_name}'")
        return True
    except TypeError:
        try:
            client.storage.create_bucket(id=bucket_name, name=bucket_name, options={"public": True})
            logger.info(f"Successfully created public storage bucket '{bucket_name}'")
            return True
        except Exception as e:
            if "already exists" in str(e).lower():
                return True
            logger.warning(f"Failed to auto-create bucket '{bucket_name}': {e}")
            return False
    except Exception as e:
        if "already exists" in str(e).lower():
            return True
        logger.warning(f"Failed to auto-create bucket '{bucket_name}': {e}")
        return False


def _do_upload(client, bucket_name: str, unique_name: str, file_bytes: bytes, content_type: str) -> bool:
    """Attempt a single upload call. Returns True on success, raises on failure."""
    client.storage.from_(bucket_name).upload(
        path=unique_name,
        file=file_bytes,
        file_options={"content-type": content_type, "upsert": "true"}
    )
    return True


def upload_to_supabase(file_bytes: bytes, filename: str, content_type: str = "application/pdf") -> Optional[str]:
    """
    Upload a file to Supabase Storage using the service_role key (bypasses RLS).
    Returns the public URL on success, None on failure.
    """
    client = _get_storage_client()
    if not client:
        return None

    bucket_name = settings.SUPABASE_STORAGE_BUCKET
    unique_name = f"{uuid.uuid4().hex}_{filename}"

    try:
        _do_upload(client, bucket_name, unique_name, file_bytes, content_type)
    except Exception as e:
        err_str = str(e)
        # Handle RLS violation explicitly with a clear action message
        if "row-level security" in err_str.lower() or "403" in err_str or "Unauthorized" in err_str:
            logger.error(
                f"Supabase upload blocked by RLS (403 Unauthorized). "
                f"Fix: set SUPABASE_SERVICE_KEY in your .env to the service_role key from "
                f"Supabase Dashboard → Project Settings → API → service_role secret."
            )
            return None
        # Handle missing bucket
        if "Bucket not found" in err_str or "404" in err_str or ("not found" in err_str.lower() and "bucket" in err_str.lower()):
            logger.info(f"Bucket '{bucket_name}' not found during upload. Attempting to create...")
            if _ensure_bucket_exists(client, bucket_name):
                try:
                    _do_upload(client, bucket_name, unique_name, file_bytes, content_type)
                except Exception as retry_err:
                    logger.error(f"Upload failed after bucket creation: {retry_err}")
                    return None
            else:
                logger.error(
                    f"Supabase bucket '{bucket_name}' does not exist and auto-creation failed. "
                    f"Please create it manually: Supabase Dashboard → Storage → New bucket → name='{bucket_name}' → Public=ON"
                )
                return None
        else:
            logger.error(f"Supabase upload error: {e}")
            return None

    try:
        public_url = client.storage.from_(bucket_name).get_public_url(unique_name)
        logger.info(f"Successfully uploaded '{filename}' to Supabase: {public_url}")
        return public_url
    except Exception as e:
        logger.error(f"Error getting public URL from Supabase: {e}")
        return None
