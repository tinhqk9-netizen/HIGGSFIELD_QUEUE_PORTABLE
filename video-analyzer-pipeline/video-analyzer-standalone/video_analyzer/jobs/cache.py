"""Pipeline result caching based on video content hash and model parameters."""

import hashlib
import json
import logging
from pathlib import Path
from video_analyzer.config import settings
from video_analyzer.schemas import FinalAnalysisResult
from video_analyzer.utils.paths import calculate_file_sha256, ensure_dir

logger = logging.getLogger("video_analyzer.jobs.cache")

PIPELINE_VERSION = "3.0.0_vi_scorecard"  # 2026-09-18: thêm 7 tiêu chí chấm điểm ⇒ cache 2.x không còn đủ trường


def compute_cache_key(
    video_path: Path | str,
    frame_interval: float,
    detail: str,
    vision_model: str,
    text_model: str,
    whisper_model: str,
    language: str = "auto",
) -> tuple[str, str]:
    """
    Computes a deterministic cache key based on video SHA256 and configuration.
    Returns (video_sha256, composite_cache_key).
    """
    video_sha = calculate_file_sha256(video_path)
    composite_str = (
        f"{video_sha}:{PIPELINE_VERSION}:{language}:{frame_interval:.2f}:{detail}:"
        f"{vision_model}:{text_model}:{whisper_model}"
    )
    cache_key = hashlib.sha256(composite_str.encode("utf-8")).hexdigest()
    return video_sha, cache_key


class CacheManager:
    """Manages reading and writing cached analysis results."""

    def __init__(self, cache_dir: Path | str | None = None):
        base_dir = Path(cache_dir or settings.job_root).parent / "cache"
        self.cache_dir = ensure_dir(base_dir)

    def get(self, cache_key: str) -> FinalAnalysisResult | None:
        """Retrieves cached FinalAnalysisResult if present."""
        cache_file = self.cache_dir / f"{cache_key}.json"
        if not cache_file.exists():
            return None

        try:
            content = cache_file.read_text(encoding="utf-8")
            data = json.loads(content)
            result = FinalAnalysisResult.model_validate(data)
            logger.info(f"Cache HIT for video analysis (key: {cache_key[:12]}...).")
            return result
        except Exception as e:
            logger.warning(f"Failed to read cache file {cache_file}: {e}")
            return None

    def set(self, cache_key: str, result: FinalAnalysisResult) -> None:
        """Saves FinalAnalysisResult to cache."""
        cache_file = self.cache_dir / f"{cache_key}.json"
        try:
            cache_file.write_text(result.model_dump_json(indent=2), encoding="utf-8")
            logger.debug(f"Saved analysis to cache (key: {cache_key[:12]}...).")
        except Exception as e:
            logger.warning(f"Failed to write cache file {cache_file}: {e}")


cache_manager = CacheManager()
