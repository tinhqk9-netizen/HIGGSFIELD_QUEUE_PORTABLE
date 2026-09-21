"""9Router direct OpenAI-compatible API client with retry and error handling."""

import base64
import logging
from pathlib import Path
from typing import Any, TypeVar
from openai import AsyncOpenAI, APIConnectionError, RateLimitError, APIStatusError
from pydantic import BaseModel
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
    before_sleep_log,
)
from video_analyzer.config import settings
from video_analyzer.utils.json import parse_llm_json

logger = logging.getLogger("video_analyzer.vision.router_client")

T = TypeVar("T", bound=BaseModel)


def encode_image_base64(image_path: Path | str) -> str:
    """Encodes an image file to base64 string."""
    p = Path(image_path)
    with open(p, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


class NineRouterClient:
    """Async OpenAI-compatible client for 9Router."""

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
    ):
        self.base_url = base_url or settings.nine_router_base_url
        self.api_key = api_key or settings.nine_router_api_key or "sk-dummy"
        self._client = AsyncOpenAI(
            base_url=self.base_url,
            api_key=self.api_key,
        )

    def update_config(self, base_url: str | None = None, api_key: str | None = None) -> None:
        """Updates connection credentials."""
        if base_url:
            self.base_url = base_url
        if api_key:
            self.api_key = api_key
        self._client = AsyncOpenAI(
            base_url=self.base_url,
            api_key=self.api_key,
        )

    @retry(
        retry=retry_if_exception_type((RateLimitError, APIConnectionError, APIStatusError, ValueError, KeyError)),
        stop=stop_after_attempt(settings.llm_max_retries),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    async def create_chat_completion(
        self,
        model: str,
        messages: list[dict[str, Any]],
        temperature: float = 0.2,
        max_tokens: int = 4096,
        response_format: dict[str, str] | None = None,
    ) -> str:
        """
        Executes chat completion against 9Router with automatic retry.
        """
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if response_format:
            kwargs["response_format"] = response_format

        logger.debug(f"Calling 9Router model '{model}' with {len(messages)} messages...")
        response = await self._client.chat.completions.create(**kwargs)

        if not response.choices:
            raise ValueError(f"9Router returned no completion choices for model {model}")

        content = response.choices[0].message.content or ""
        return content

    async def call_structured(
        self,
        model: str,
        messages: list[dict[str, Any]],
        schema: type[T],
        temperature: float = 0.1,
        max_tokens: int = 8192,
    ) -> T:
        """
        Calls 9Router and parses the returned JSON string into a Pydantic schema.
        Includes a self-repair attempt if JSON is malformed.
        """
        raw_text = await self.create_chat_completion(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )

        try:
            parsed = parse_llm_json(raw_text)
            return schema.model_validate(parsed)
        except Exception as first_err:
            logger.warning(f"Initial schema validation failed for {schema.__name__}: {first_err}. Attempting repair...")
            # Repair prompt
            repair_messages = [
                *messages,
                {"role": "assistant", "content": raw_text},
                {
                    "role": "user",
                    "content": (
                        f"The previous output had an issue: {str(first_err)}.\n"
                        f"Please return ONLY a valid JSON object strictly matching the required schema."
                    ),
                },
            ]
            repaired_text = await self.create_chat_completion(
                model=model,
                messages=repair_messages,
                temperature=0.0,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
            )
            parsed_repair = parse_llm_json(repaired_text)
            return schema.model_validate(parsed_repair)


nine_router_client = NineRouterClient()
