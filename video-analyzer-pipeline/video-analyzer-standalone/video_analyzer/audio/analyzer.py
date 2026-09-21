"""Audio analysis pipeline: local Whisper transcription, SRT generation, and Gemini text analysis."""

import logging
from pathlib import Path
from typing import Any
from pydantic import BaseModel, Field
from video_analyzer.audio.subtitle import chunk_transcript_segments, generate_srt, save_transcript_json
from video_analyzer.audio.whisper_engine import whisper_engine
from video_analyzer.config import settings
from video_analyzer.schemas import AudioAnalysisResult, AudioEvent, RawAudioResponse, WhisperTranscript
from video_analyzer.utils.json import dumps_json
from video_analyzer.utils.paths import ensure_dir
from video_analyzer.vision.prompts import get_subtitle_prompt
from video_analyzer.vision.router_client import nine_router_client

logger = logging.getLogger("video_analyzer.audio.analyzer")


async def analyze_transcript_chunk(
    chunk_segments: list[Any],
    chunk_index: int,
) -> list[AudioEvent]:
    """
    Sends a time-windowed subtitle chunk to Gemini Text via 9Router.
    """
    system_prompt = get_subtitle_prompt()

    lines = []
    for seg in chunk_segments:
        lines.append(f"[{seg.start:.2f}s - {seg.end:.2f}s]: {seg.text}")
    chunk_text = "\n".join(lines)

    user_prompt = (
        f"Analyze the following timestamped spoken lines from the video (Chunk {chunk_index + 1}):\n\n"
        f"{chunk_text}\n\n"
        f"Extract key spoken events, meanings, topics, claims, and calls to action with exact timestamps.\n"
        f"Return structured JSON matching the schema."
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    try:
        logger.info(f"Analyzing audio chunk {chunk_index + 1} with {len(chunk_segments)} segments...")
        response = await nine_router_client.call_structured(
            model=settings.text_model,
            messages=messages,
            schema=RawAudioResponse,
        )
        return response.events
    except Exception as e:
        logger.error(f"Failed to analyze audio chunk {chunk_index + 1}: {e}")
        # Fallback: create basic audio events directly from segments without Gemini inference
        fallback_events: list[AudioEvent] = []
        for seg in chunk_segments:
            fallback_events.append(
                AudioEvent(
                    start=seg.start,
                    end=seg.end,
                    speech=seg.text,
                    meaning="",
                    topics=[],
                    entities=[],
                    claims=[],
                    cta=None,
                )
            )
        return fallback_events


async def run_audio_pipeline(
    video_path: Path | str,
    audio_dir: Path | str,
    output_json_path: Path | str,
    language: str = "auto",
    has_audio: bool = True,
    on_progress: Any = None,
) -> AudioAnalysisResult:
    """
    Complete audio pipeline:
    1. Transcribe with local Whisper on CUDA
    2. Generate transcript.json and subtitle.srt
    3. Analyze spoken content with Gemini Text via 9Router
    4. Save audio.json
    """
    audio_dir_path = ensure_dir(audio_dir)
    output_path = Path(output_json_path)
    ensure_dir(output_path.parent)

    if not has_audio:
        logger.info(f"Video {video_path} has no audio stream. Skipping audio pipeline.")
        result = AudioAnalysisResult(
            status="skipped",
            language="none",
            full_text="",
            segments=[],
            events=[],
            topics=[],
            claims=[],
            calls_to_action=[],
        )
        output_path.write_text(dumps_json(result.model_dump(), indent=True), encoding="utf-8")
        return result

    if on_progress:
        await on_progress("transcribing", 0.3)

    # 1. Local Whisper transcription
    transcript: WhisperTranscript = await whisper_engine.transcribe(
        video_path=video_path,
        language=language,
    )

    # 2. Save transcript.json and subtitle.srt
    transcript_file = audio_dir_path / "transcript.json"
    subtitle_file = audio_dir_path / "subtitle.srt"

    save_transcript_json(transcript, transcript_file)
    generate_srt(transcript.segments, subtitle_file)

    if not transcript.segments:
        logger.info("Whisper returned no speech segments in video.")
        result = AudioAnalysisResult(
            status="success",
            language=transcript.language,
            full_text=transcript.text,
            segments=[],
            events=[],
            topics=[],
            claims=[],
            calls_to_action=[],
        )
        output_path.write_text(dumps_json(result.model_dump(), indent=True), encoding="utf-8")
        return result

    if on_progress:
        await on_progress("analyzing_audio", 0.5)

    # 3. Chunk and analyze with Gemini
    chunks = chunk_transcript_segments(transcript.segments, window_sec=settings.audio_analysis_window_sec)
    all_events: list[AudioEvent] = []

    for idx, chunk in enumerate(chunks):
        chunk_events = await analyze_transcript_chunk(chunk, idx)
        all_events.extend(chunk_events)

    all_events.sort(key=lambda x: (x.start, x.end))

    # Aggregation
    topics = sorted(list({t for ev in all_events for t in ev.topics if t}))
    claims = sorted(list({c for ev in all_events for c in ev.claims if c}))
    ctas = sorted(list({ev.cta for ev in all_events if ev.cta}))

    result = AudioAnalysisResult(
        status="success",
        language=transcript.language,
        full_text=transcript.text,
        segments=transcript.segments,
        events=all_events,
        topics=topics,
        claims=claims,
        calls_to_action=ctas,
    )

    output_path.write_text(dumps_json(result.model_dump(), indent=True), encoding="utf-8")
    logger.info(f"Saved audio analysis ({len(all_events)} events) to {output_path}.")
    return result
