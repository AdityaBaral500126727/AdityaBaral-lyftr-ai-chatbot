import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.database import (
    get_session_messages,
    init_db,
    save_turn,
    session_exists,
)
from app.gateway import dispatch_chat_request
from app.models import (
    ChatRequest,
    ChatResponse,
    HealthResponse,
    SessionHistoryResponse,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("lyftr-backend")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure database schema exists
    init_db()
    logger.info(
        f"Database initialized. Configured keys: {len(settings.key_pool)}, "
        f"Simulation enabled: {settings.ENABLE_FAILURE_SIMULATION}"
    )
    yield


app = FastAPI(
    title="Lyftr AI Backend",
    version="1.0.0",
    lifespan=lifespan
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Formats validation errors cleanly with a detail key and 422 status."""
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": jsonable_encoder(exc.errors())}
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Ensures all HTTP exceptions return a detail field in pure JSON."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail}
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Fallback handler so user never sees a stack trace or broken HTML."""
    logger.exception(f"Unhandled error: {exc}")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "internal server error"}
    )


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """
    Returns 200 once the app is running, the database is reachable
    and the key pool is loaded.
    """
    return HealthResponse(
        status="ok",
        keys_configured=len(settings.key_pool),
        cache_enabled=True
    )


@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(
    req: ChatRequest,
    x_simulate_failure: Optional[str] = Header(None, alias="X-Simulate-Failure")
):
    """
    Handles user chat turn with multi-turn context retention,
    response caching, automatic key fallback, and failure simulation.
    """
    session_id = req.session_id
    message_content = req.message

    # Retrieve prior conversation history for this session from SQLite
    history = get_session_messages(session_id)

    # Build full prompt sequence sent to LiteLLM:
    # 1. System Prompt
    system_prompt = req.system_prompt or settings.DEFAULT_SYSTEM_PROMPT
    messages = [{"role": "system", "content": system_prompt}]

    # 2. Prior history turns
    for turn in history:
        messages.append({
            "role": turn["role"],
            "content": turn["content"]
        })

    # 3. Current user message
    messages.append({
        "role": "user",
        "content": message_content
    })

    # Dispatch via LiteLLM gateway with failover & caching
    reply_text, meta = await dispatch_chat_request(
        messages=messages,
        simulate_header=x_simulate_failure
    )

    # Only save to SQLite upon successful completion (never on 422 or 503)
    save_turn(
        session_id=session_id,
        user_content=message_content,
        assistant_content=reply_text,
        assistant_metadata=meta.model_dump()
    )

    return ChatResponse(
        session_id=session_id,
        reply=reply_text,
        metadata=meta
    )


@app.get("/sessions/{session_id}/messages", response_model=SessionHistoryResponse)
async def get_session_history(session_id: str):
    """
    Returns the stored history of one session from SQLite, oldest first,
    without the system prompt. Returns 404 if the session does not exist.
    """
    if not session_exists(session_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="session not found"
        )

    history = get_session_messages(session_id)
    return SessionHistoryResponse(
        session_id=session_id,
        messages=history
    )
