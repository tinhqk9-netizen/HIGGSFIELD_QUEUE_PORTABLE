"""FFmpeg frame extraction and batching module."""

import asyncio
import logging
from pathlib import Path
from video_analyzer.config import settings
from video_analyzer.schemas import FrameBatch, FrameItem
from video_analyzer.utils.paths import ensure_dir
from video_analyzer.utils.timestamps import calculate_frame_timestamp

logger = logging.getLogger("video_analyzer.media.frames")


class FrameExtractionError(Exception):
    """Raised when frame extraction via ffmpeg fails."""
    pass


async def extract_frames(
    video_path: Path | str,
    output_dir: Path | str,
    interval: float = 0.5,
    max_width: int | None = None,
    jpeg_quality: int | None = None,
) -> list[FrameItem]:
    """
    Extracts frames from a video file at regular time intervals using ffmpeg.
    Frames are saved as JPEG images in output_dir (frame_%06d.jpg).
    """
    video_file = Path(video_path).resolve()
    frames_dir = ensure_dir(output_dir)

    if not video_file.exists():
        raise FileNotFoundError(f"Video file not found: {video_file}")

    if interval <= 0:
        interval = settings.frame_interval

    fps_val = round(1.0 / interval, 4)
    width_limit = max_width or settings.frame_max_width
    quality = jpeg_quality or settings.frame_jpeg_quality

    # FFmpeg command: extract at fps=1/interval, resize with aspect ratio preserved
    # vf: fps=X,scale='min(max_width,iw)':-2
    filter_graph = f"fps={fps_val},scale='min({width_limit},iw)':-2"
    output_pattern = str(frames_dir / "frame_%06d.jpg")

    cmd = [
        settings.ffmpeg_bin,
        "-nostdin",
        "-y",
        "-i", str(video_file),
        "-vf", filter_graph,
        "-q:v", str(quality),
        output_pattern,
    ]

    logger.info(f"Extracting frames from {video_file.name} at {fps_val} fps (interval: {interval}s)...")

    # stdin=DEVNULL bắt buộc: worker chạy dưới Node và stdin của nó là pipe NDJSON không bao giờ
    # đóng. Nếu để ffmpeg kế thừa stdin đó, ffmpeg ghi xong toàn bộ frame vẫn nằm chờ đọc stdin và
    # không thoát -> communicate() treo vô hạn -> analyze timeout. Cờ -nostdin là lớp chặn thứ hai.
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()

    if proc.returncode != 0:
        err_msg = stderr.decode("utf-8", errors="replace").strip()
        logger.error(f"ffmpeg frame extraction failed: {err_msg}")
        raise FrameExtractionError(f"ffmpeg frame extraction failed: {err_msg}")

    # Discover and sort generated frame files
    extracted_files = sorted(frames_dir.glob("frame_*.jpg"))
    if not extracted_files:
        raise FrameExtractionError("No frames were extracted from video.")

    frame_items: list[FrameItem] = []
    for idx, file_path in enumerate(extracted_files):
        ts = calculate_frame_timestamp(idx, interval)
        frame_items.append(
            FrameItem(
                index=idx,
                timestamp=ts,
                path=str(file_path.resolve()),
            )
        )

    logger.info(f"Successfully extracted {len(frame_items)} frames into {frames_dir}.")
    return frame_items


def create_frame_batches(
    frames: list[FrameItem],
    batch_size: int | None = None,
) -> list[FrameBatch]:
    """
    Groups ordered frame items into batches for Gemini Vision processing.
    """
    size = batch_size or settings.vision_batch_size
    if size <= 0:
        size = 12

    batches: list[FrameBatch] = []
    for i in range(0, len(frames), size):
        chunk = frames[i : i + size]
        if not chunk:
            continue
        start_ts = chunk[0].timestamp
        end_ts = chunk[-1].timestamp
        batches.append(
            FrameBatch(
                batch_index=len(batches),
                frames=chunk,
                start_time=start_ts,
                end_time=end_ts,
            )
        )

    return batches
