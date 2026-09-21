"""Prompt templates and loader for Gemini Vision, Subtitle, and Synthesis."""

from pathlib import Path
from video_analyzer.config import settings

_PROMPTS_CACHE: dict[str, str] = {}


def load_prompt(name: str) -> str:
    """Loads a prompt file from the prompts directory, caching in memory."""
    if name in _PROMPTS_CACHE:
        return _PROMPTS_CACHE[name]

    prompts_dir = Path(settings.prompts_dir)
    file_path = prompts_dir / f"{name}.txt"
    if not file_path.exists():
        # Fallback to local package relative
        fallback_dir = Path(__file__).resolve().parent.parent.parent.parent / "prompts"
        file_path = fallback_dir / f"{name}.txt"

    if file_path.exists():
        content = file_path.read_text(encoding="utf-8").strip()
    else:
        # Fallback default built-in prompts
        if name == "visual":
            content = (
                "You are analyzing ordered frames extracted from a video.\n"
                "Each image has an exact timestamp supplied by the system.\n"
                "IMPORTANT: All output text, descriptions, scene names, and actions MUST be in natural Vietnamese (Tiếng Việt).\n"
                "Analyze only information that is visually observable.\n"
                "For each visual event identify when relevant:\n"
                "- start timestamp\n- end timestamp\n- scene/environment (in Vietnamese)\n- people\n- objects\n- products\n- actions (in Vietnamese)\n"
                "- facial expressions when clearly visible\n- visible text\n- UI elements\n- camera framing\n- camera movement\n"
                "- transitions\n- significant visual changes\n"
                "Merge consecutive frames that show one continuous event.\n"
                "Do not infer dialogue. Do not infer sounds. Do not invent information outside the images.\n"
                "Return valid structured JSON only with a list under 'events' in Vietnamese."
            )
        elif name == "subtitle":
            content = (
                "You are analyzing timestamped speech extracted from a video.\n"
                "Analyze the spoken content.\n"
                "Identify:\n- main topic\n- speaker intent\n- claims\n- instructions\n- questions\n"
                "- important statements\n- product/entity mentions\n- calls to action\n- narrative progression\n"
                "- changes of topic\n- relevant emotional tone when inferable from language\n"
                "Preserve timestamps.\nDo not infer visual information.\n"
                "Return structured JSON only with a list under 'events'."
            )
        else:
            content = (
                "You are given a synchronized multimodal timeline of a video.\n"
                "The timeline contains VISUAL (what is visible) and AUDIO (what is spoken).\n"
                "IMPORTANT: All summaries, purposes, and descriptions MUST be in fluent Vietnamese (Tiếng Việt).\n"
                "Create a complete analysis of the video.\n"
                "Return structured JSON only in Vietnamese."
            )

    _PROMPTS_CACHE[name] = content
    return content


def get_visual_prompt() -> str:
    return load_prompt("visual")


def get_subtitle_prompt() -> str:
    return load_prompt("subtitle")


def get_final_prompt() -> str:
    return load_prompt("final")
