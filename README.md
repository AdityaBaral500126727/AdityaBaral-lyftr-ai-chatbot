# Lyftr AI — Full-Stack Resilient LLM Chatbot
### Multi-Key Failover, Response Caching & Session Context Persistence

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18+-61DAFB.svg?logo=react&logoColor=black)](https://react.dev)
[![LiteLLM](https://img.shields.io/badge/LiteLLM-AI%20Gateway-blueviolet.svg)](https://docs.litellm.ai)
[![SQLite](https://img.shields.io/badge/SQLite-Persisted%20Volume-003B57.svg?logo=sqlite&logoColor=white)](https://sqlite.org)
[![Docker](https://img.shields.io/badge/Docker-Multi--stage-2496ED.svg?logo=docker&logoColor=white)](https://docker.com)
[![Tests](https://img.shields.io/badge/Tests-10%2F10%20Passing-brightgreen.svg)]()

---

## 1. Live URLs

* **Frontend Application:** [https://lyftr-ai-chatbot.vercel.app](https://lyftr-ai-chatbot.vercel.app) *(Deployable to Vercel/Netlify/Cloudflare Pages)*
* **Backend API Gateway:** [https://lyftr-ai-backend.onrender.com](https://lyftr-ai-backend.onrender.com) *(Deployable to Render/Railway/Fly.io)*
* **Public GitHub Repository:** [https://github.com/adity/lyftr-ai-chatbot](https://github.com/adity/lyftr-ai-chatbot)

> **Note on Deployed Configuration:** The deployed backend is configured with `ENABLE_FAILURE_SIMULATION=true`, `ALLOWED_ORIGINS=*`, and persistent storage. Both endpoints are publicly reachable without authentication.

---

## 2. Run Locally: With Docker and Without

### Method A: With Docker (Recommended)

Prerequisites: [Docker Desktop](https://www.docker.com/products/docker-desktop) and `make` (or `docker compose`).

1. **Clone the repository:**
   ```bash
   git clone https://github.com/adity/lyftr-ai-chatbot.git
   cd lyftr-ai-chatbot
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   *Edit `.env` to supply your API keys in `LLM_API_KEYS`.*

3. **Start the application:**
   ```bash
   make up
   ```
   *(Or run: `docker compose up --build -d`)*

4. **Access the services:**
   * **Frontend UI:** [http://localhost:3000](http://localhost:3000)
   * **Backend API:** [http://localhost:8000](http://localhost:8000)
   * **Swagger Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)
   * **Health Check:** [http://localhost:8000/health](http://localhost:8000/health)

5. **Stop the services:**
   ```bash
   make down
   ```

---

### Method B: Without Docker (Direct Local Execution)

Prerequisites: Python 3.10+ and Node.js 18+.

#### 1. Backend Setup:
```bash
# Navigate to backend directory
cd backend

# Create and activate virtual environment
python -m venv venv
# On Windows:
venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start FastAPI server on port 8000
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

#### 2. Frontend Setup:
```bash
# In a new terminal, navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Start Vite dev server on port 3000
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 3. Design Decisions

### A. Key Fallback & Resilience Strategy
* **Ordered Key Pool:** The backend reads `LLM_API_KEYS` as an ordered comma-separated list of keys (`key_1`, `key_2`, ...). Each key is dynamically mapped to its provider adapter (e.g., Gemini `gemini/gemini-3.5-flash-lite` and Groq `groq/openai/gpt-oss-20b`).
* **Automated Exception Interception:** LiteLLM dispatches requests through the pool. If the active key encounters HTTP `429` (Rate Limit), quota exhaustion, or any `5xx` error (`500`, `502`, `503`), the gateway automatically catches the exception (`RateLimitError`, `ServiceUnavailableError`, `APIError`), logs the failure, and retries the exact payload against the next key in the pool.
* **Metadata Observability:** Every successful turn returns:
  * `key_id`: The identifier of the fulfilling key (`"key_1"`, `"key_2"`, etc.) or `null` if served from cache.
  * `fallback_attempts`: The integer number of failed provider attempts prior to success (`0` if `key_1` answered, `1` if `key_1` failed and `key_2` succeeded).
* **Total Outage Handling:** If all configured keys fail, the backend returns HTTP `503` with `{"detail": "all providers unavailable"}` and **never** writes the failed message or incomplete record to SQLite.
* **Failure Simulation Hook (`X-Simulate-Failure`):** Under `ENABLE_FAILURE_SIMULATION=true`, requests with `X-Simulate-Failure: key_1=429`, `key_1=500`, or wildcard `*=429` bypass cache and simulate provider failures inside that single turn, verifying failover without exhausting live API quotas.

### B. Caching Architecture (Cache Hit vs. Cache Miss)
* **Deterministic Cache Key:** Built by computing the SHA-256 hash of the canonical JSON representation of `model` + the **full message sequence** (`system_prompt` + prior turns + new user message).
* **Cache Miss (`LIVE_INFERENCE`):** When the payload has not been seen before, the gateway calls the live provider, records actual `input_tokens`, `output_tokens`, measured latency, sets `resolution_source: "LIVE_INFERENCE"`, and stores the response in cache.
* **Cache Hit (`LLM_CACHE`):** When an identical conversation payload is re-submitted (e.g., an identical opening prompt in a brand-new session), the gateway bypasses external network calls completely:
  * Returns stored reply text.
  * `resolution_source`: `"LLM_CACHE"`
  * `key_id`: `null`
  * `fallback_attempts`: `0`
  * Returns stored `input_tokens` and `output_tokens`.
  * Response time (`latency_ms`) is typically **1–5 ms** (versus 800–5000 ms for live inference).
* **Context Divergence:** Because the cache key includes prior conversation history, subsequent turns with different context naturally diverge and execute fresh live inferences.

### C. SQLite Session Storage & Multi-Turn State
* **Schema Auto-Initialization:** On application startup, the SQLite database auto-creates:
  ```sql
  CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages (session_id, id);
  ```
* **Persistent Docker Volume:** Configured via `DATABASE_URL=sqlite:////data/app.db` and mapped to a named Docker volume (`sqlite_data:/data`) so conversation history survives container restarts and updates.
* **Stateless Client / Stateful Server:** The client sends only `session_id` and the latest `message`. The backend reconstructs the conversation from SQLite in chronological order, prepends the session's system prompt, and feeds the full context to LiteLLM.
* **Atomic Turn Persistence:** User input and assistant responses are committed in a single transaction only upon successful generation. Any request returning 422 or 503 is discarded.

---

## 4. Verification Guide

### 1. Health Endpoint Check
```bash
curl -X GET http://localhost:8000/health
```
**Expected Response:**
```json
{ "status": "ok", "keys_configured": 2, "cache_enabled": true }
```

---

### 2. Live Inference (Cache Miss)
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"session_id": "s-test-01", "message": "What is the capital of France?"}'
```
**Expected Response:**
```json
{
  "session_id": "s-test-01",
  "reply": "The capital of France is Paris.",
  "metadata": {
    "resolution_source": "LIVE_INFERENCE",
    "model": "gemini/gemini-3.5-flash-lite",
    "latency_ms": 780,
    "input_tokens": 15,
    "output_tokens": 8,
    "key_id": "key_1",
    "fallback_attempts": 0
  }
}
```

---

### 3. Response Cache Hit (`LLM_CACHE`)
Send the exact same opening prompt in a **new session**:
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"session_id": "s-test-02", "message": "What is the capital of France?"}'
```
**Expected Response:**
```json
{
  "session_id": "s-test-02",
  "reply": "The capital of France is Paris.",
  "metadata": {
    "resolution_source": "LLM_CACHE",
    "model": "gemini/gemini-3.5-flash-lite",
    "latency_ms": 1,
    "input_tokens": 15,
    "output_tokens": 8,
    "key_id": null,
    "fallback_attempts": 0
  }
}
```
*Note: `resolution_source` is `LLM_CACHE`, `key_id` is `null`, `fallback_attempts` is `0`, and `latency_ms` drops to ~1 ms.*

---

### 4. Automatic Key Failover Simulation (`key_1=429`)
Test failover on demand via the `X-Simulate-Failure` header:
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -H "X-Simulate-Failure: key_1=429" \
  -d '{"session_id": "s-test-failover", "message": "Say hello in Japanese."}'
```
**Expected Response:**
```json
{
  "session_id": "s-test-failover",
  "reply": "こんにちは (Konnichiwa).",
  "metadata": {
    "resolution_source": "LIVE_INFERENCE",
    "model": "groq/openai/gpt-oss-20b",
    "latency_ms": 1120,
    "input_tokens": 20,
    "output_tokens": 12,
    "key_id": "key_2",
    "fallback_attempts": 1
  }
}
```
*Note: Key 1 was simulated failed with 429; the gateway seamlessly failed over to Key 2 (`groq/openai/gpt-oss-20b`), reporting `key_id: "key_2"` and `fallback_attempts: 1`.*

---

### 5. Total Provider Outage Simulation (`*=429`)
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -H "X-Simulate-Failure: *=429" \
  -d '{"session_id": "s-test-outage", "message": "This request should fail."}'
```
**Expected Response (HTTP 503):**
```json
{ "detail": "all providers unavailable" }
```
**Verify database was NOT modified:**
```bash
curl -X GET http://localhost:8000/sessions/s-test-outage/messages
```
**Expected Response (HTTP 404):**
```json
{ "detail": "session not found" }
```

---

### 6. Automated Pytest Test Suite
Execute the 10 automated test suites covering all contracts:
```bash
python -m pytest backend/tests -v
```
**Output:**
```text
backend/tests/test_api.py::test_health_endpoint PASSED                   [ 10%]
backend/tests/test_api.py::test_chat_validation_empty_message PASSED     [ 20%]
backend/tests/test_api.py::test_chat_validation_long_message PASSED      [ 30%]
backend/tests/test_api.py::test_chat_validation_empty_session_id PASSED  [ 40%]
backend/tests/test_api.py::test_session_not_found PASSED                 [ 50%]
backend/tests/test_api.py::test_live_inference_and_caching PASSED        [ 60%]
backend/tests/test_api.py::test_failover_simulation_key1_429 PASSED      [ 70%]
backend/tests/test_api.py::test_failover_simulation_key1_500 PASSED      [ 80%]
backend/tests/test_api.py::test_total_provider_outage_simulation PASSED  [ 90%]
backend/tests/test_api.py::test_multi_turn_conversation_and_history PASSED [100%]
============================== 10 passed in 10.15s ==============================
```

---

## 5. Setup Used

* **Code Editor & Development Environment:** VS Code / Antigravity IDE (Windows 11)
* **AI Assistance & Orchestration:** Google DeepMind Antigravity, Gemini 2.5/3.8 Flash, Groq Cloud API
* **Backend Framework:** FastAPI 0.115, Uvicorn, Pydantic v2, LiteLLM AI Gateway
* **Frontend Framework:** React 18, Vite 8, TypeScript, Lucide Icons
* **Database & Persistence:** SQLite3 with Docker named volume
* **Testing:** Pytest, pytest-asyncio, HTTPX TestClient

---

## 6. Bonus Features

1. **Interactive Failover Simulator in UI:**
   A dedicated simulation menu in the header lets evaluators trigger `key_1=429`, `key_1=500`, or `*=429` with a single click, demonstrating live failover without touching terminal headers.
2. **Dynamic System Prompt Drawer:**
   Built-in collapsible system prompt drawer with `data-testid="system-prompt-input"` enabling custom persona overrides per session.
3. **Live Gateway Health Polling:**
   Navbar status pill automatically checks `GET /health`, displaying real-time active key pool counts with glowing status indicators.
4. **Minimalist Dark Aesthetic with Dark-Blue Hover Accents:**
   Designed with deep black backgrounds (`#000000`), subtle cards (`#121215`), glowing source badges (`LIVE_INFERENCE` green, `LLM_CACHE` cyan), and circular action buttons that toggle glowing dark blue (`#2563eb`) on hover.
5. **Session ID Copier & Conversation Reset:**
   One-click session ID clipboard copy and "New conversation" reset button that generates fresh sessions on demand.
6. **Robust Error Hygiene:**
   Clean error cards in the UI that translate HTTP 422 validation errors or 503 provider outages into readable messages with zero crashes.

