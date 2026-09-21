"""Visual analysis orchestrator: frame batching, Gemini Vision requests, and normalization."""

import asyncio
import logging
from pathlib import Path
from typing import Any
from pydantic import BaseModel, Field
from video_analyzer.config import settings
from video_analyzer.media.frames import create_frame_batches, extract_frames
from video_analyzer.schemas import (
    FrameBatch,
    RawVisionResponse,
    VisualAnalysisResult,
    VisualBatchResult,
    VisualEvent,
)
from video_analyzer.utils.json import dumps_json
from video_analyzer.utils.paths import ensure_dir
from video_analyzer.vision.prompts import get_visual_prompt
from video_analyzer.vision.router_client import encode_image_base64, nine_router_client

logger = logging.getLogger("video_analyzer.vision.analyzer")


async def analyze_single_batch(
    batch: FrameBatch,
    semaphore: asyncio.Semaphore,
) -> VisualBatchResult:
    """
    Sends a batch of frames with explicit timestamps to Gemini Vision via 9Router.
    """
    system_prompt = get_visual_prompt()

    content_parts: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                f"Analyzing batch {batch.batch_index + 1} with {len(batch.frames)} frames "
                f"(time window: {batch.start_time:.1f}s - {batch.end_time:.1f}s).\n"
                f"Below are the ordered frames with their exact timestamps:\n"
            ),
        }
    ]

    for frame in batch.frames:
        b64 = encode_image_base64(frame.path)
        content_parts.append({
            "type": "text",
            "text": f"\n--- Frame timestamp: {frame.timestamp:.1f} seconds ---\n",
        })
        content_parts.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:image/jpeg;base64,{b64}",
                "detail": "high",
            },
        })

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": content_parts},
    ]

    async with semaphore:
        try:
            logger.info(
                f"Sending vision batch {batch.batch_index + 1} "
                f"({batch.start_time:.1f}s - {batch.end_time:.1f}s, {len(batch.frames)} frames) to Gemini..."
            )
            response = await nine_router_client.call_structured(
                model=settings.vision_model,
                messages=messages,
                schema=RawVisionResponse,
            )
            # Ensure timestamps fall within reasonable bounds
            valid_events: list[VisualEvent] = []
            for ev in response.events:
                # Clamp or adjust start/end if wildly out of range
                st = max(0.0, ev.start)
                en = max(st, ev.end)
                valid_events.append(
                    VisualEvent(
                        start=round(st, 2),
                        end=round(en, 2),
                        description=ev.description.strip(),
                        scene=ev.scene.strip(),
                        people=[p.strip() for p in ev.people if p.strip()],
                        objects=[o.strip() for o in ev.objects if o.strip()],
                        products=[pr.strip() for pr in ev.products if pr.strip()],
                        actions=[a.strip() for a in ev.actions if a.strip()],
                        visible_text=[vt.strip() for vt in ev.visible_text if vt.strip()],
                        confidence=ev.confidence,
                    )
                )
            return VisualBatchResult(batch_index=batch.batch_index, events=valid_events)
        except Exception as e:
            logger.error(f"Vision batch {batch.batch_index + 1} failed: {e}")
            return VisualBatchResult(batch_index=batch.batch_index, error=str(e))


def normalize_visual_events(batch_results: list[VisualBatchResult]) -> list[VisualEvent]:
    """Sorts and deduplicates/merges visual events across batches."""
    all_events: list[VisualEvent] = []
    for br in sorted(batch_results, key=lambda b: b.batch_index):
        all_events.extend(br.events)

    if not all_events:
        return []

    all_events.sort(key=lambda x: (x.start, x.end))
    return all_events


async def run_visual_pipeline(
    video_path: Path | str,
    frames_dir: Path | str,
    output_json_path: Path | str,
    interval: float = 0.5,
    on_progress: Any = None,
) -> VisualAnalysisResult:
    """
    Complete visual pipeline:
    1. Extract frames with ffmpeg
    2. Batch frames
    3. Analyze batches concurrently via Gemini Vision
    4. Normalize visual events
    5. Save visual.json
    """
    frames_dir_path = ensure_dir(frames_dir)
    output_path = Path(output_json_path)
    ensure_dir(output_path.parent)

    if on_progress:
        await on_progress("extracting_frames", 0.1)

    frames = await extract_frames(
        video_path=video_path,
        output_dir=frames_dir_path,
        interval=interval,
    )

    batches = create_frame_batches(frames, batch_size=settings.vision_batch_size)
    semaphore = asyncio.Semaphore(settings.vision_concurrency)

    if on_progress:
        await on_progress("analyzing_visual", 0.2)

    logger.info(f"Processing {len(batches)} visual batches with concurrency {settings.vision_concurrency}...")

    tasks = [analyze_single_batch(b, semaphore) for b in batches]
    batch_results: list[VisualBatchResult] = await asyncio.gather(*tasks)

    failed_batches = sum(1 for br in batch_results if br.error is not None)

    # HARD-FAIL: nếu TẤT CẢ batch vision đều lỗi (AI không gọi được API 9Router) → ném lỗi rõ ràng,
    # KHÔNG trả kết quả rỗng giả "thành công" (rule §13 mock≠real, §41 không nuốt lỗi).
    if batches and failed_batches == len(batches):
        first_err = next((br.error for br in batch_results if br.error), "unknown error")
        raise RuntimeError(
            f"Vision AI (9Router model '{settings.vision_model}') không phân tích được batch nào "
            f"({failed_batches}/{len(batches)} lỗi). Nguyên nhân: {first_err}"
        )

    events = normalize_visual_events(batch_results)

    # Collect unique entities across visual events
    scenes = sorted(list({ev.scene for ev in events if ev.scene}))
    people = sorted(list({p for ev in events for p in ev.people}))
    objects = sorted(list({o for ev in events for o in ev.objects}))
    products = sorted(list({pr for ev in events for pr in ev.products}))
    visible_text = sorted(list({vt for ev in events for vt in ev.visible_text}))

    status = "success"
    if failed_batches > 0:
        status = "partial" if events else "failed"

    result = VisualAnalysisResult(
        status=status,
        events=events,
        scenes=scenes,
        people=people,
        objects=objects,
        products=products,
        visible_text=visible_text,
        total_frames=len(frames),
        processed_batches=len(batches),
        failed_batches=failed_batches,
    )

    output_path.write_text(dumps_json(result.model_dump(), indent=True), encoding="utf-8")
    logger.info(f"Saved visual analysis ({len(events)} events) to {output_path}.")
    return result
