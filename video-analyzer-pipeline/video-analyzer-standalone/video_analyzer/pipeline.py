"""Main video analysis orchestrator running visual and audio branches in parallel."""

import asyncio
import logging
from pathlib import Path
from typing import Any, Callable, Coroutine
from video_analyzer.audio.analyzer import run_audio_pipeline
from video_analyzer.config import settings
from video_analyzer.jobs.cache import cache_manager, compute_cache_key
from video_analyzer.jobs.manager import job_manager
from video_analyzer.media.probe import probe_video
from video_analyzer.merge.synthesis import run_final_synthesis
from video_analyzer.merge.timeline import merge_multimodal_timeline, save_merged_timeline
from video_analyzer.schemas import (
    AudioAnalysisResult,
    FinalAnalysisResult,
    VisualAnalysisResult,
)
from video_analyzer.utils.paths import validate_video_path
from video_analyzer.vision.analyzer import run_visual_pipeline

logger = logging.getLogger("video_analyzer.pipeline")

ProgressCallback = Callable[[str, float], Coroutine[Any, Any, None]] | None


async def analyze_video(
    video_path: str,
    language: str = "auto",
    frame_interval: float = 0.5,
    detail: str = "detailed",
    job_id: str | None = None,
    on_progress: ProgressCallback = None,
) -> FinalAnalysisResult:
    """
    Main multimodal video analysis pipeline:
    1. Validates path security.
    2. Checks cache.
    3. Probes media streams via ffprobe.
    4. Executes visual (FFmpeg + Gemini Vision) and audio (Whisper CUDA + Gemini Text) in parallel.
    5. Deterministically synchronizes visual and spoken events into a unified timeline.
    6. Synthesizes complete multimodal understanding via Gemini Text.
    7. Cleans up frame images (optional) and caches final result.
    """
    # 1. Path security check
    resolved_path = validate_video_path(video_path)

    # 2. Check cache
    _, cache_key = compute_cache_key(
        video_path=resolved_path,
        frame_interval=frame_interval,
        detail=detail,
        vision_model=settings.vision_model,
        text_model=settings.text_model,
        whisper_model=settings.whisper_model,
        language=language,
    )
    cached = cache_manager.get(cache_key)
    if cached is not None:
        if on_progress:
            await on_progress("completed", 1.0)
        return cached

    # 3. Probe video
    if on_progress:
        await on_progress("probing", 0.05)

    metadata = await probe_video(resolved_path)

    # 4. Create Job workspace
    job = job_manager.create_job(job_id)
    job.save_metadata(metadata)
    logger.info(f"Created job workspace {job.job_id} at {job.root_dir}.")

    # 5. Run visual and audio pipelines in parallel
    async def _on_visual_progress(stage: str, prog: float):
        if on_progress:
            await on_progress(stage, prog)

    async def _on_audio_progress(stage: str, prog: float):
        if on_progress:
            await on_progress(stage, prog)

    visual_task = asyncio.create_task(
        run_visual_pipeline(
            video_path=resolved_path,
            frames_dir=job.frames_dir,
            output_json_path=job.visual_json_path,
            interval=frame_interval,
            on_progress=_on_visual_progress,
        )
    )

    audio_task = asyncio.create_task(
        run_audio_pipeline(
            video_path=resolved_path,
            audio_dir=job.audio_dir,
            output_json_path=job.audio_json_path,
            language=language,
            has_audio=metadata.has_audio,
            on_progress=_on_audio_progress,
        )
    )

    logger.info("Executing visual and audio pipelines concurrently...")
    visual_res, audio_res = await asyncio.gather(
        visual_task,
        audio_task,
        return_exceptions=True,
    )

    # HARD-FAIL: AI thị giác (vision LLM) không chạy được → hỏng cả job, KHÔNG tiếp tục với
    # dữ liệu rỗng giả "thành công". Ném lỗi để worker trả ok:false → Node chặn done Step 2
    # (rule §13 mock≠real, §41 không nuốt lỗi).
    if isinstance(visual_res, Exception):
        logger.error(f"Visual pipeline failed with exception: {visual_res}")
        raise visual_res
    visual_result: VisualAnalysisResult = visual_res

    audio_result: AudioAnalysisResult | None = None
    if isinstance(audio_res, Exception):
        logger.error(f"Audio pipeline failed with exception: {audio_res}")
        audio_result = AudioAnalysisResult(
            status="failed",
            language="error",
            full_text="",
            segments=[],
            events=[],
            topics=[],
            claims=[],
            calls_to_action=[],
        )
    else:
        audio_result = audio_res

    # 6. Timeline merge
    if on_progress:
        await on_progress("merging", 0.7)

    timeline = merge_multimodal_timeline(visual_result, audio_result)
    save_merged_timeline(timeline, job.timeline_json_path)

    # 7. Final synthesis
    if on_progress:
        await on_progress("synthesizing", 0.85)

    final_result = await run_final_synthesis(
        job_id=job.job_id,
        metadata=metadata,
        timeline=timeline,
        visual_result=visual_result,
        audio_result=audio_result,
        artifacts=job.get_artifacts(),
        output_json_path=job.final_json_path,
        detail=detail,
        language=language,
    )

    # 8. Cleanup frames
    job.cleanup_frames()

    # 9. Cache successful results
    if final_result.status == "success":
        cache_manager.set(cache_key, final_result)

    if on_progress:
        await on_progress("completed", 1.0)

    logger.info(f"Video analysis job {job.job_id} completed with status: {final_result.status}.")
    return final_result
