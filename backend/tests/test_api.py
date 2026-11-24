import pytest
from fastapi.testclient import TestClient


def test_health_endpoint(client: TestClient):
    """GET /health must return status ok, keys_configured, and cache_enabled."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["keys_configured"] >= 2
    assert data["cache_enabled"] is True


def test_chat_validation_empty_message(client: TestClient):
    """Missing or empty message must return HTTP 422 with JSON detail."""
    response = client.post("/chat", json={"session_id": "s-test-val", "message": "   "})
    assert response.status_code == 422
    assert "detail" in response.json()


def test_chat_validation_long_message(client: TestClient):
    """Message over 4000 characters must return HTTP 422 with JSON detail."""
    long_msg = "a" * 4001
    response = client.post("/chat", json={"session_id": "s-test-val", "message": long_msg})
    assert response.status_code == 422
    assert "detail" in response.json()


def test_chat_validation_empty_session_id(client: TestClient):
    """Empty session_id must return HTTP 422 with JSON detail."""
    response = client.post("/chat", json={"session_id": "", "message": "Hello"})
    assert response.status_code == 422
    assert "detail" in response.json()


def test_session_not_found(client: TestClient):
    """Unknown session in GET /sessions/... must return HTTP 404 with {'detail': 'session not found'}."""
    response = client.get("/sessions/s-nonexistent-9999/messages")
    assert response.status_code == 404
    assert response.json() == {"detail": "session not found"}


def test_live_inference_and_caching(client: TestClient):
    """
    Tests cache miss (LIVE_INFERENCE) followed by cache hit (LLM_CACHE)
    with an identical prompt in a new session.
    """
    unique_prompt = "What is the capital of Australia? Answer in one word."

    # Turn 1: Brand new prompt -> Live Inference
    res1 = client.post(
        "/chat",
        json={"session_id": "s-cache-turn1", "message": unique_prompt}
    )
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["session_id"] == "s-cache-turn1"
    assert "Canberra" in data1["reply"] or len(data1["reply"]) > 0
    assert data1["metadata"]["resolution_source"] == "LIVE_INFERENCE"
    assert data1["metadata"]["key_id"] in ["key_1", "key_2"]
    assert data1["metadata"]["input_tokens"] > 0
    assert data1["metadata"]["output_tokens"] > 0
    assert data1["metadata"]["latency_ms"] > 0

    # Turn 2: Exact same prompt in a brand-new session -> LLM_CACHE
    res2 = client.post(
        "/chat",
        json={"session_id": "s-cache-turn2", "message": unique_prompt}
    )
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["session_id"] == "s-cache-turn2"
    assert data2["reply"] == data1["reply"]
    assert data2["metadata"]["resolution_source"] == "LLM_CACHE"
    assert data2["metadata"]["key_id"] is None
    assert data2["metadata"]["fallback_attempts"] == 0
    assert data2["metadata"]["input_tokens"] == data1["metadata"]["input_tokens"]
    assert data2["metadata"]["output_tokens"] == data1["metadata"]["output_tokens"]
    # Cache hit must be faster than live call
    assert data2["metadata"]["latency_ms"] <= data1["metadata"]["latency_ms"] + 50


def test_failover_simulation_key1_429(client: TestClient):
    """
    X-Simulate-Failure: key_1=429
    Must failover to key_2 and return HTTP 200 with key_id: 'key_2' and fallback_attempts: 1.
    """
    headers = {"X-Simulate-Failure": "key_1=429"}
    response = client.post(
        "/chat",
        json={"session_id": "s-failover-429", "message": "Tell me a fun fact about space in 5 words."},
        headers=headers
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["reply"]) > 0
    assert data["metadata"]["key_id"] == "key_2"
    assert data["metadata"]["fallback_attempts"] == 1
    assert data["metadata"]["resolution_source"] == "LIVE_INFERENCE"


def test_failover_simulation_key1_500(client: TestClient):
    """
    X-Simulate-Failure: key_1=500
    Must failover to key_2 and return HTTP 200 with key_id: 'key_2' and fallback_attempts: 1.
    """
    headers = {"X-Simulate-Failure": "key_1=500"}
    response = client.post(
        "/chat",
        json={"session_id": "s-failover-500", "message": "Tell me a fun fact about oceans in 5 words."},
        headers=headers
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["reply"]) > 0
    assert data["metadata"]["key_id"] == "key_2"
    assert data["metadata"]["fallback_attempts"] == 1
    assert data["metadata"]["resolution_source"] == "LIVE_INFERENCE"


def test_total_provider_outage_simulation(client: TestClient):
    """
    X-Simulate-Failure: *=429
    When all providers fail, returns HTTP 503 {'detail': 'all providers unavailable'}.
    Failed request is NOT saved to SQLite.
    """
    headers = {"X-Simulate-Failure": "*=429"}
    session_id = "s-total-outage-test"
    response = client.post(
        "/chat",
        json={"session_id": session_id, "message": "This request should fail."},
        headers=headers
    )
    assert response.status_code == 503
    assert response.json() == {"detail": "all providers unavailable"}

    # Verify session was NOT created or persisted in SQLite
    get_res = client.get(f"/sessions/{session_id}/messages")
    assert get_res.status_code == 404
    assert get_res.json() == {"detail": "session not found"}


def test_multi_turn_conversation_and_history(client: TestClient):
    """
    Verifies multi-turn state in SQLite:
    Turn 1 -> User: What is Java?
    Turn 2 -> User: What are its main features?
    History retrieved via GET /sessions/{session_id}/messages contains both turns.
    """
    session_id = "s-multi-turn-001"

    # Turn 1
    res1 = client.post(
        "/chat",
        json={"session_id": session_id, "message": "What is Python?"}
    )
    assert res1.status_code == 200
    assert len(res1.json()["reply"]) > 0

    # Turn 2
    res2 = client.post(
        "/chat",
        json={"session_id": session_id, "message": "Give two main advantages."}
    )
    assert res2.status_code == 200
    assert len(res2.json()["reply"]) > 0

    # Verify history
    history_res = client.get(f"/sessions/{session_id}/messages")
    assert history_res.status_code == 200
    history = history_res.json()
    assert history["session_id"] == session_id
    messages = history["messages"]
    assert len(messages) == 4

    assert messages[0]["role"] == "user"
    assert messages[0]["content"] == "What is Python?"

    assert messages[1]["role"] == "assistant"
    assert "metadata" in messages[1]
    assert messages[1]["metadata"]["resolution_source"] in ["LIVE_INFERENCE", "LLM_CACHE"]

    assert messages[2]["role"] == "user"
    assert messages[2]["content"] == "Give two main advantages."

    assert messages[3]["role"] == "assistant"
    assert "metadata" in messages[3]

