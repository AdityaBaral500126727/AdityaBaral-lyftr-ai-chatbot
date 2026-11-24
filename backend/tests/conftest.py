import os
import tempfile
import pytest
from fastapi.testclient import TestClient

# Point database to temporary test file
temp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
temp_db.close()
os.environ["DATABASE_URL"] = f"sqlite:///{temp_db.name}"
os.environ["ENABLE_FAILURE_SIMULATION"] = "true"

from app.config import settings
from app.database import init_db
from app.main import app


@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    init_db()
    yield
    try:
        if os.path.exists(temp_db.name):
            os.remove(temp_db.name)
    except Exception:
        pass


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client

