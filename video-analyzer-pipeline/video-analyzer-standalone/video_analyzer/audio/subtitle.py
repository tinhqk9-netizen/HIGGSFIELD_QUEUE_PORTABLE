"""SRT generation and transcript chunking utilities."""

from pathlib import Path
from video_analyzer.config import settings
from video_analyzer.schemas import WhisperSegment, WhisperTranscript
from video_analyzer.utils.json import dumps_json
from video_analyzer.utils.paths import ensure_dir
from video_analyzer.utils.timestamps import seconds_to_srt_timestamp


def build_srt_content(segments: list[WhisperSegment]) -> str:
    """Builds standard SRT subtitle formatted string from Whisper segments."""
    srt_blocks: list[str] = []
    for idx, seg in enumerate(segments, 1):
        start_srt = seconds_to_srt_timestamp(seg.start)
        end_srt = seconds_to_srt_timestamp(seg.end)
        text = seg.text.strip()
        srt_blocks.append(f"{idx}\n{start_srt} --> {end_srt}\n{text}\n")
    return "\n".join(srt_blocks).strip() + "\n"


def generate_srt(segments: list[WhisperSegment], output_path: Path | str) -> str:
    """Saves SRT subtitle file to disk and returns content."""
    p = Path(output_path)
    ensure_dir(p.parent)
    content = build_srt_content(segments)
    p.write_text(content, encoding="utf-8")
    return content


def save_transcript_json(transcript: WhisperTranscript, output_path: Path | str) -> None:
    """Saves transcript JSON file to disk."""
    p = Path(output_path)
    ensure_dir(p.parent)
    json_str = dumps_json(transcript.model_dump(), indent=True)
    p.write_text(json_str, encoding="utf-8")


def chunk_transcript_segments(
    segments: list[WhisperSegment],
    window_sec: float | None = None,
) -> list[list[WhisperSegment]]:
    """
    Groups segments into time windows (default: 120 seconds).
    Avoids cutting in the middle of a Whisper segment.
    """
    window = window_sec or settings.audio_analysis_window_sec
    if window <= 0:
        window = 120.0

    if not segments:
        return []

    chunks: list[list[WhisperSegment]] = []
    current_chunk: list[WhisperSegment] = []
    chunk_start_time = segments[0].start

    for seg in segments:
        if current_chunk and (seg.end - chunk_start_time > window):
            chunks.append(current_chunk)
            current_chunk = [seg]
            chunk_start_time = seg.start
        else:
            current_chunk.append(seg)

    if current_chunk:
        chunks.append(current_chunk)

    return chunks
