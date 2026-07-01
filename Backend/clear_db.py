"""
Utility script: clears all application data from the database.
Run from any directory:
    python Backend/clear_db.py
    python clear_db.py  (when inside Backend/)
"""
import asyncio
from sqlalchemy import text
from app.database import engine, async_session_maker

async def clear():
    async with async_session_maker() as db:
        await db.execute(text("PRAGMA foreign_keys = OFF"))
        tables = ["audit_log", "feedback", "interview_questions", "scores", "candidates", "jobs"]
        for table in tables:
            result = await db.execute(text(f"DELETE FROM {table}"))
            print(f"  Cleared {table}: {result.rowcount} rows deleted")
        await db.execute(text("PRAGMA foreign_keys = ON"))
        await db.commit()

    # VACUUM must run outside any transaction
    async with engine.connect() as conn:
        await conn.execute(text("VACUUM"))

    print("Done — all tables cleared.")

asyncio.run(clear())
