import hashlib
import json
import logging
import time
from typing import Dict, List, Optional, Tuple, Any

import litellm
from litellm.exceptions import (
    RateLimitError,
    ServiceUnavailableError,
    InternalServerError,
    APIError,
    BadGatewayError,
    AuthenticationError,
    ContextWindowExceededError,
)
from fastapi import HTTPException
from app.config import settings
from app.models import ChatMetadata

logger = logging.getLogger("gateway")

# Enable LiteLLM's local in-memory cache
try:
    litellm.enable_cache(type="local")
except Exception as e:
    logger.warning(f"Failed to enable litellm local cache: {e}")

# In-memory deterministic response cache: cache_key -> dict of stored values
# cache_key is sha256(json of canonical payload: model + messages)
_DETERMINISTIC_CACHE: Dict[str, Dict[str, Any]] = {}


def get_model_for_key(key: str, index: int) -> str:
    """Selects the optimal model for a given key."""
    if key.startswith("AQ.") or key.startswith("AIzaSy"):
        return settings.PRIMARY_MODEL
    if key.startswith("gsk_"):
        return settings.FALLBACK_MODEL
    # Default alternate assignment if generic keys
    return settings.PRIMARY_MODEL if index == 0 else settings.FALLBACK_MODEL


def parse_simulate_failure_header(header_val: Optional[str]) -> Dict[str, int]:
    """
    Parses X-Simulate-Failure header:
    e.g. 'key_1=429, key_2=500' -> {'key_1': 429, 'key_2': 500}
    or '*=429' -> {'*': 429}
    """
    if not header_val or not settings.ENABLE_FAILURE_SIMULATION:
        return {}
    failures = {}
    for part in header_val.split(","):
        part = part.strip()
        if not part or "=" not in part:
            continue
        k, v = part.split("=", 1)
        k = k.strip()
        try:
            status_code = int(v.strip())
            if status_code in (429, 500, 502, 503):
                failures[k] = status_code
        except ValueError:
            continue
    return failures


def compute_cache_key(model: str, messages: List[Dict[str, str]]) -> str:
    """Computes a unique cache key based on model and full messages list."""
    canonical = {
        "model": model,
        "messages": [{"role": m["role"], "content": m["content"]} for m in messages]
    }
    dumped = json.dumps(canonical, sort_keys=True)
    return hashlib.sha256(dumped.encode("utf-8")).hexdigest()


def check_cache(cache_key: str) -> Optional[Dict[str, Any]]:
    """Checks the in-memory cache for an identical payload."""
    return _DETERMINISTIC_CACHE.get(cache_key)


def store_in_cache(cache_key: str, data: Dict[str, Any]) -> None:
    """Stores response in cache."""
    _DETERMINISTIC_CACHE[cache_key] = data


async def dispatch_chat_request(
    messages: List[Dict[str, str]],
    simulate_header: Optional[str] = None
) -> Tuple[str, ChatMetadata]:
    """
    Orchestrates the chat turn with caching, multi-key failover,
    and simulated failure hooks.
    """
    start_time = time.perf_counter()
    key_pool = settings.key_pool
    if not key_pool:
        raise HTTPException(status_code=503, detail="all providers unavailable")

    simulated_failures = parse_simulate_failure_header(simulate_header)
    is_simulating = bool(simulated_failures)

    # Primary model used for cache checking
    primary_model = get_model_for_key(key_pool[0], 0)
    cache_key = compute_cache_key(primary_model, messages)

    # Cache check: only if NOT simulating failure
    if not is_simulating:
        cached = check_cache(cache_key)
        if cached is not None:
            latency_ms = max(1, int(round((time.perf_counter() - start_time) * 1000)))
            meta = ChatMetadata(
                resolution_source="LLM_CACHE",
                model=cached["model"],
                latency_ms=latency_ms,
                input_tokens=cached["input_tokens"],
                output_tokens=cached["output_tokens"],
                key_id=None,
                fallback_attempts=0
            )
            return cached["reply"], meta

    # Cache miss: Iterate through the key pool with automatic fallback
    fallback_attempts = 0
    errors_encountered = []

    for index, api_key in enumerate(key_pool):
        key_id = f"key_{index + 1}"
        model = get_model_for_key(api_key, index)

        # Check for simulated failure on this key
        if is_simulating:
            simulated_status = simulated_failures.get(key_id) or simulated_failures.get("*")
            if simulated_status:
                logger.info(
                    f"Simulating failure on {key_id} with status {simulated_status}"
                )
                errors_encountered.append(f"{key_id} simulated {simulated_status}")
                fallback_attempts += 1
                continue

        # Execute live request using LiteLLM
        try:
            # Call litellm completion with configured gateway timeout
            response = litellm.completion(
                model=model,
                messages=messages,
                api_key=api_key,
                timeout=settings.LLM_TIMEOUT
            )

            # Check if litellm internal cache triggered
            litellm_cache_hit = getattr(response, "_hidden_params", {}).get("cache_hit") is True

            reply = response.choices[0].message.content or ""
            usage = getattr(response, "usage", None)
            input_tokens = getattr(usage, "prompt_tokens", 0) if usage else 0
            output_tokens = getattr(usage, "completion_tokens", 0) if usage else 0

            # Fallback estimation if usage was 0
            if input_tokens == 0:
                try:
                    input_tokens = litellm.token_counter(model=model, messages=messages)
                except Exception:
                    input_tokens = max(1, sum(len(m.get("content", "")) for m in messages) // 4)
            if output_tokens == 0:
                try:
                    output_tokens = litellm.token_counter(model=model, text=reply)
                except Exception:
                    output_tokens = max(1, len(reply) // 4)

            latency_ms = max(1, int(round((time.perf_counter() - start_time) * 1000)))

            if litellm_cache_hit:
                res_source = "LLM_CACHE"
                assigned_key_id = None
                assigned_fallback = 0
            else:
                res_source = "LIVE_INFERENCE"
                assigned_key_id = key_id
                assigned_fallback = fallback_attempts

            # Populate cache if this was a fresh live inference
            if res_source == "LIVE_INFERENCE" and not is_simulating:
                store_in_cache(cache_key, {
                    "reply": reply,
                    "model": model,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens
                })

            meta = ChatMetadata(
                resolution_source=res_source,
                model=model,
                latency_ms=latency_ms,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                key_id=assigned_key_id,
                fallback_attempts=assigned_fallback
            )
            return reply, meta

        except (
            RateLimitError,
            ServiceUnavailableError,
            InternalServerError,
            APIError,
            BadGatewayError,
            AuthenticationError,
            Exception
        ) as err:
            logger.warning(f"Error calling {key_id} ({model}): {err}")
            errors_encountered.append(f"{key_id} failed: {type(err).__name__}")
            fallback_attempts += 1
            # Continue to next key in pool

    # If all keys in pool failed
    logger.error(f"All keys failed. Attempts: {fallback_attempts}. Errors: {errors_encountered}")
    raise HTTPException(status_code=503, detail="all providers unavailable")

