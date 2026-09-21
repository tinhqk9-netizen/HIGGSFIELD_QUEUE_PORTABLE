"""Configuration settings for video_analyzer using Pydantic Settings."""

import shutil
from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _resolve_prompts_dir() -> str:
    base = Path(__file__).resolve().parent
    for candidate in [base.parent / "prompts", base.parent.parent / "prompts", Path.cwd() / "prompts"]:
        if candidate.exists() and candidate.is_dir():
            return str(candidate)
    return str(base.parent / "prompts")


def _resolve_job_root() -> str:
    for candidate in [Path.cwd() / "data" / "jobs", Path.home() / ".video_analyzer" / "jobs", Path("/tmp/video_analyzer_jobs")]:
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            return str(candidate)
        except OSError:
            continue
    return str(Path.cwd() / "data" / "jobs")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Media paths and security
    video_root: str = Field(
        default="",
        description="Allowed root directory for video files (empty allows user home and cwd).",
    )
    allowed_video_roots: list[str] = Field(
        default_factory=lambda: ["*"],
        description="List of allowed directory roots for video paths ('*' allows any path).",
    )
    job_root: str = Field(
        default_factory=_resolve_job_root,
        description="Workspace directory for storing video analysis jobs.",
    )

    # Binaries
    ffmpeg_bin: str = Field(default_factory=lambda: shutil.which("ffmpeg") or "/usr/bin/ffmpeg", description="Path to ffmpeg binary.")
    ffprobe_bin: str = Field(default_factory=lambda: shutil.which("ffprobe") or "/usr/bin/ffprobe", description="Path to ffprobe binary.")

    # Frame extraction
    frame_interval: float = Field(default=0.5, description="Interval in seconds between extracted frames.")
    frame_max_width: int = Field(default=1280, description="Maximum width of extracted frames while keeping aspect ratio.")
    frame_jpeg_quality: int = Field(default=3, description="FFmpeg JPEG quality factor (1-31, lower is better).")

    # Vision pipeline
    vision_batch_size: int = Field(default=12, description="Number of frames per Gemini Vision batch.")
    vision_concurrency: int = Field(default=3, description="Maximum concurrent Gemini Vision batch requests.")
    worker_concurrency: int = Field(
        default=5,
        description=(
            "So video duoc phan tich SONG SONG. Truoc day worker chi co 1 luong tieu thu nen "
            "tang Node ban 5 viec sang cung luc thi 4 viec dung im o 'starting 0%%' (do that: "
            "1 clip / 43-60 giay). Whisper co asyncio.Lock rieng nen khau GPU van tuan tu, "
            "chi vision + synthesis (goi mang) la chong lan duoc."
        ),
    )

    # 9Router & Models
    nine_router_base_url: str = Field(
        default="http://127.0.0.1:20128/v1",
        description="9Router OpenAI-compatible API base URL.",
    )
    nine_router_api_key: str = Field(
        # Khong nhung key that vao ma nguon — khai trong .env
        default="",
        description="API key for 9Router.",
    )
    vision_model: str = Field(
        default="ag/gemini-3.7-flash-high",
        description="Gemini Vision model identifier via 9Router.",
    )
    text_model: str = Field(
        default="ag/gemini-3.7-flash-high",
        description="Gemini Text model identifier via 9Router.",
    )

    # Whisper configuration
    whisper_model: str = Field(default="turbo", description="Whisper model name (e.g., turbo, base, small, medium, large).")
    whisper_device: str = Field(default="cuda", description="Device for Whisper inference (cuda or cpu).")
    allow_cpu_fallback: bool = Field(default=True, description="Allow falling back to CPU if CUDA is unavailable.")

    # Audio analysis
    audio_analysis_window_sec: float = Field(
        default=120.0,
        description="Duration in seconds for chunking transcript before Gemini analysis.",
    )

    # Reliability and Concurrency
    llm_max_retries: int = Field(default=3, description="Maximum retries for 9Router LLM calls.")
    max_video_jobs: int = Field(default=1, description="Maximum concurrent video analysis jobs.")
    keep_frames: bool = Field(default=False, description="Keep extracted frame images after visual analysis.")
    keep_intermediate: bool = Field(default=True, description="Keep intermediate JSON artifacts in job directory.")

    # Prompts
    prompts_dir: str = Field(
        default_factory=_resolve_prompts_dir,
        description="Path to prompts directory.",
    )


settings = Settings()
