import os
import uuid
import logging
from typing import Optional
from app.config import settings

logger = logging.getLogger(__name__)

_supabase_client = None

def get_supabase_client():
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

def upload_to_supabase(file_bytes: bytes, filename: str, content_type: str = "application/pdf") -> Optional[str]:
    """
    Uploads a file to Supabase Storage bucket and returns the public URL or file path.
    """
    client = get_supabase_client()
    if not client:
        return None

    try:
        bucket_name = settings.SUPABASE_STORAGE_BUCKET
        unique_name = f"{uuid.uuid4().hex}_{filename}"
        
        # Upload binary data to Supabase Storage
        res = client.storage.from_(bucket_name).upload(
            path=unique_name,
            file=file_bytes,
            file_options={"content-type": content_type, "upsert": "true"}
        )
        
        # Get public URL
        public_url = client.storage.from_(bucket_name).get_public_url(unique_name)
        logger.info(f"Successfully uploaded {filename} to Supabase storage: {public_url}")
        return public_url
    except Exception as e:
        logger.error(f"Error uploading file to Supabase: {e}")
        return None
