"""FFprobe media metadata inspection module."""

import asyncio
import json
import logging
from pathlib import Path
from video_analyzer.config import settings
from video_analyzer.schemas import VideoMetadata

logger = logging.getLogger("video_analyzer.media.probe")


class ProbeError(Exception):
    """Raised when ffprobe execution or parsing fails."""
    pass


async def probe_video(video_path: Path | str) -> VideoMetadata:
    """
    Executes ffprobe to extract stream, codec, resolution, and duration information.
    Validates that the file contains a valid video stream.
    """
    path_obj = Path(video_path).resolve()
    if not path_obj.exists():
        raise FileNotFoundError(f"Video file not found: {path_obj}")

    cmd = [
        settings.ffprobe_bin,
        "-v", "error",
        "-show_entries", "format=duration,size:stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,duration",
        "-of", "json",
        str(path_obj),
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
    except Exception as e:
        logger.error(f"Failed to execute ffprobe: {e}")
        raise ProbeError(f"Failed to launch ffprobe: {e}") from e

    if proc.returncode != 0:
        err_msg = stderr.decode("utf-8", errors="replace").strip()
        logger.error(f"ffprobe failed with exit code {proc.returncode}: {err_msg}")
        raise ProbeError(f"ffprobe failed: {err_msg}")

    try:
        data = json.loads(stdout.decode("utf-8"))
    except json.JSONDecodeError as e:
        raise ProbeError(f"Failed to parse ffprobe JSON output: {e}") from e

    format_info = data.get("format", {})
    streams = data.get("streams", [])

    duration_str = format_info.get("duration")
    duration = float(duration_str) if duration_str else 0.0

    file_size_str = format_info.get("size")
    file_size = int(file_size_str) if file_size_str else path_obj.stat().st_size

    has_video = False
    has_audio = False
    width = 0
    height = 0
    fps = 0.0
    video_codec = ""
    audio_codec = ""

    for stream in streams:
        codec_type = stream.get("codec_type")
        if codec_type == "video" and not has_video:
            has_video = True
            video_codec = stream.get("codec_name", "")
            width = int(stream.get("width", 0))
            height = int(stream.get("height", 0))

            # Duration fallback
            if duration == 0.0 and stream.get("duration"):
                try:
                    duration = float(stream["duration"])
                except (ValueError, TypeError):
                    pass

            # Calculate FPS
            r_fps = stream.get("r_frame_rate", "")
            avg_fps = stream.get("avg_frame_rate", "")
            fps_val = avg_fps or r_fps
            if fps_val and "/" in fps_val:
                try:
                    num, den = fps_val.split("/")
                    if float(den) > 0:
                        fps = round(float(num) / float(den), 2)
                except (ValueError, ZeroDivisionError):
                    fps = 30.0
            elif fps_val:
                try:
                    fps = round(float(fps_val), 2)
                except ValueError:
                    fps = 30.0

        elif codec_type == "audio" and not has_audio:
            has_audio = True
            audio_codec = stream.get("codec_name", "")
            if duration == 0.0 and stream.get("duration"):
                try:
                    duration = float(stream["duration"])
                except (ValueError, TypeError):
                    pass

    if not has_video:
        raise ProbeError(f"No video stream found in file: {path_obj}")

    return VideoMetadata(
        path=str(path_obj),
        duration=round(duration, 2),
        width=width,
        height=height,
        fps=fps,
        video_codec=video_codec,
        audio_codec=audio_codec,
        has_video=has_video,
        has_audio=has_audio,
        file_size=file_size,
    )
