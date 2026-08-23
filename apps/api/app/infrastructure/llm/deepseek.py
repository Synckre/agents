"""Cliente DeepSeek. Solo HTTP: retries, timeout y usage. Sin heurística de negocio."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

import httpx

from app.application.agent.ports import LlmAttempt, LlmResult
from app.infrastructure.config import DEEPSEEK_PLACEHOLDER_KEY, settings

logger = logging.getLogger("llm.deepseek")

_TIMEOUT_S = 30.0
_MAX_ATTEMPTS = 2
_RETRY_SLEEP_S = 1.0


class DeepseekLlm:
    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        skip: Optional[bool] = None,
    ):
        self._api_key = api_key if api_key is not None else settings.DEEPSEEK_API_KEY
        self._base_url = (base_url or settings.DEEPSEEK_BASE_URL).rstrip("/")
        self._model = model or settings.DEEPSEEK_MODEL
        self._skip = settings.SKIP_LLM_KEY_CHECK if skip is None else skip

    def _configured(self) -> bool:
        key = (self._api_key or "").strip()
        if self._skip:
            return False
        return bool(key) and key != DEEPSEEK_PLACEHOLDER_KEY

    async def complete(self, system_prompt: str, user_input: str) -> LlmResult:
        if not self._configured():
            return LlmResult(ok=False, source="skipped")

        attempts: list[LlmAttempt] = []
        ultimo_error = "sin respuesta de DeepSeek"
        url = f"{self._base_url}/chat/completions"
        headers = {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_input},
            ],
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
        }

        for intento in range(1, _MAX_ATTEMPTS + 1):
            t0 = time.perf_counter()
            try:
                async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
                    res = await client.post(url, headers=headers, json=payload)
                latency_ms = int((time.perf_counter() - t0) * 1000)
                if res.status_code == 200:
                    body = res.json()
                    content = body["choices"][0]["message"]["content"]
                    usage = body.get("usage") or {}
                    prompt_tokens = int(usage.get("prompt_tokens") or 0)
                    completion_tokens = int(usage.get("completion_tokens") or 0)
                    attempts.append(
                        LlmAttempt(
                            status="success",
                            latency_ms=latency_ms,
                            attempt=intento,
                            http_status=200,
                            prompt_tokens=prompt_tokens,
                            completion_tokens=completion_tokens,
                        )
                    )
                    return LlmResult(
                        ok=True,
                        content=content,
                        source="llm",
                        prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                        attempts=attempts,
                    )
                ultimo_error = f"HTTP {res.status_code}"
                logger.error("Error DeepSeek API %s: %s", res.status_code, res.text[:300])
                attempts.append(
                    LlmAttempt(
                        status="http_error",
                        latency_ms=latency_ms,
                        attempt=intento,
                        http_status=res.status_code,
                    )
                )
            except Exception as exc:
                latency_ms = int((time.perf_counter() - t0) * 1000)
                ultimo_error = str(exc) or ultimo_error
                logger.error("Error invocando DeepSeek API (intento %s): %s", intento, exc)
                status = "timeout" if "timeout" in ultimo_error.lower() else "error"
                attempts.append(
                    LlmAttempt(status=status, latency_ms=latency_ms, attempt=intento)
                )
            if intento < _MAX_ATTEMPTS:
                await asyncio.sleep(_RETRY_SLEEP_S)

        logger.error("DeepSeek no respondió tras reintentar (%s)", ultimo_error)
        return LlmResult(ok=False, source="error", attempts=attempts)
