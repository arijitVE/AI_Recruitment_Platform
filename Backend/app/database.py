from collections.abc import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base

from app.config import settings

_is_sqlite = settings.DATABASE_URL.startswith("sqlite")

# Create async database engine
# pool_pre_ping: test every pooled connection before use — discards connections
#   that Neon/PostgreSQL has closed due to idle timeout (prevents 500 errors)
# pool_recycle: force-recycle connections every 10 minutes regardless, so the
#   pool never holds a connection longer than Neon's idle timeout (~5 minutes)
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    future=True,
    # SQLite doesn't support connection pooling parameters
    **({} if _is_sqlite else {
        "pool_pre_ping": True,      # re-validates connection before checkout
        "pool_recycle": 300,        # recycle connections after 5 minutes
        "pool_size": 5,             # max number of persistent connections
        "max_overflow": 10,         # extra connections allowed above pool_size
    })
)

async_session_maker = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)

Base = declarative_base()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session
