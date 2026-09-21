"""JSON utility functions with repair and markdown codeblock stripping."""

import json
import re
from typing import Any

try:
    import orjson

    def dumps_json(obj: Any, indent: bool = False) -> str:
        option = orjson.OPT_INDENT_2 if indent else 0
        return orjson.dumps(obj, option=option).decode("utf-8")

    def loads_json(text: str) -> Any:
        return orjson.loads(text)

except ImportError:
    def dumps_json(obj: Any, indent: bool = False) -> str:
        return json.dumps(obj, indent=2 if indent else None, ensure_ascii=False)

    def loads_json(text: str) -> Any:
        return json.loads(text)


def extract_json_block(text: str) -> str:
    """Extracts JSON substring from LLM response, stripping markdown blocks if present."""
    trimmed = text.strip()
    # Match ```json ... ``` or ``` ... ```
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", trimmed, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return trimmed


def parse_llm_json(text: str) -> Any:
    """Parses LLM response text into JSON object with fallback repair strategies."""
    clean_text = extract_json_block(text)
    try:
        return loads_json(clean_text)
    except Exception:
        # Fallback 1: search for first { or [ to last } or ]
        first_curly = clean_text.find("{")
        first_square = clean_text.find("[")
        
        start = -1
        if first_curly != -1 and first_square != -1:
            start = min(first_curly, first_square)
        elif first_curly != -1:
            start = first_curly
        elif first_square != -1:
            start = first_square

        last_curly = clean_text.rfind("}")
        last_square = clean_text.rfind("]")
        end = max(last_curly, last_square)

        if start != -1 and end != -1 and end > start:
            snippet = clean_text[start : end + 1]
            try:
                return loads_json(snippet)
            except Exception:
                pass

        # Fallback 2: standard python json loads
        return json.loads(clean_text)
