import os
import sqlite3
import json
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from app.config import settings


def get_db_path(custom_path: Optional[str] = None) -> str:
    path = custom_path or settings.sqlite_db_path
    dirname = os.path.dirname(path)
    if dirname and not os.path.exists(dirname):
        try:
            os.makedirs(dirname, exist_ok=True)
        except OSError:
            pass
    return path


def get_connection(custom_path: Optional[str] = None) -> sqlite3.Connection:
    path = get_db_path(custom_path)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(custom_path: Optional[str] = None) -> None:
    """Creates the messages table and indexes if they do not exist."""
    conn = get_connection(custom_path)
    try:
        with conn:
            conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                metadata TEXT,
                created_at TEXT NOT NULL
            );
            """)
            conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages (session_id, id);
            """)
    finally:
        conn.close()


def session_exists(session_id: str, custom_path: Optional[str] = None) -> bool:
    """Checks if a session has any saved messages."""
    conn = get_connection(custom_path)
    try:
        cursor = conn.execute(
            "SELECT 1 FROM messages WHERE session_id = ? LIMIT 1;",
            (session_id,)
        )
        return cursor.fetchone() is not None
    finally:
        conn.close()


def get_session_messages(session_id: str, custom_path: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Returns stored history of one session from SQLite, oldest first,
    without system prompt.
    """
    conn = get_connection(custom_path)
    try:
        cursor = conn.execute(
            "SELECT role, content, metadata, created_at FROM messages WHERE session_id = ? ORDER BY id ASC;",
            (session_id,)
        )
        rows = cursor.fetchall()
        result = []
        for row in rows:
            item: Dict[str, Any] = {
                "role": row["role"],
                "content": row["content"]
            }
            if row["role"] == "assistant" and row["metadata"]:
                try:
                    item["metadata"] = json.loads(row["metadata"])
                except Exception:
                    item["metadata"] = None
            result.append(item)
        return result
    finally:
        conn.close()


def save_turn(
    session_id: str,
    user_content: str,
    assistant_content: str,
    assistant_metadata: Dict[str, Any],
    custom_path: Optional[str] = None
) -> None:
    """
    Atomically saves both user message and assistant reply to the database.
    Failed requests are never saved.
    """
    now = datetime.now(timezone.utc).isoformat()
    meta_json = json.dumps(assistant_metadata)
    conn = get_connection(custom_path)
    try:
        with conn:
            conn.execute(
                "INSERT INTO messages (session_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?);",
                (session_id, "user", user_content, None, now)
            )
            conn.execute(
                "INSERT INTO messages (session_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?);",
                (session_id, "assistant", assistant_content, meta_json, now)
            )
    finally:
        conn.close()

