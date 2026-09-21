"""Deterministic Multimodal Timeline Merger (Union of Visual and Audio events)."""

import logging
from pathlib import Path
from typing import Any
from video_analyzer.schemas import (
    AudioAnalysisResult,
    AudioEvent,
    MergedEventItem,
    MergedTimeline,
    VisualAnalysisResult,
    VisualEvent,
)
from video_analyzer.utils.json import dumps_json
from video_analyzer.utils.paths import ensure_dir

logger = logging.getLogger("video_analyzer.merge.timeline")


def is_overlapping(start_a: float, end_a: float, start_b: float, end_b: float) -> bool:
    """Checks if two time intervals overlap."""
    return start_a < end_b and start_b < end_a


def merge_multimodal_timeline(
    visual_result: VisualAnalysisResult | None,
    audio_result: AudioAnalysisResult | None,
) -> MergedTimeline:
    """
    Deterministically merges visual and audio event timelines into a synchronized union.
    Preserves visual-only events, audio-only events, and combined events.
    """
    visual_events: list[VisualEvent] = visual_result.events if visual_result else []
    audio_events: list[AudioEvent] = audio_result.events if audio_result else []

    if not visual_events and not audio_events:
        return MergedTimeline(events=[])

    # If only visual events exist
    if not audio_events:
        items = [
            MergedEventItem(
                start=v.start,
                end=v.end,
                visual=[v.model_dump()],
                audio=[],
            )
            for v in visual_events
        ]
        return MergedTimeline(events=items)

    # If only audio events exist
    if not visual_events:
        items = [
            MergedEventItem(
                start=a.start,
                end=a.end,
                visual=[],
                audio=[a.model_dump()],
            )
            for a in audio_events
        ]
        return MergedTimeline(events=items)

    # Union timeline algorithm:
    # 1. Collect all boundary timestamps
    boundaries = set()
    for v in visual_events:
        boundaries.add(round(v.start, 2))
        boundaries.add(round(v.end, 2))
    for a in audio_events:
        boundaries.add(round(a.start, 2))
        boundaries.add(round(a.end, 2))

    sorted_bounds = sorted(list(boundaries))

    slices: list[dict[str, Any]] = []
    for i in range(len(sorted_bounds) - 1):
        s_start = sorted_bounds[i]
        s_end = sorted_bounds[i + 1]
        if s_end <= s_start:
            continue

        mid_point = (s_start + s_end) / 2.0

        # Find active visual events during this slice
        matching_visuals = [
            v for v in visual_events
            if v.start <= mid_point <= v.end or (v.start < s_end and v.end > s_start)
        ]
        # Find active audio events during this slice
        matching_audios = [
            a for a in audio_events
            if a.start <= mid_point <= a.end or (a.start < s_end and a.end > s_start)
        ]

        if matching_visuals or matching_audios:
            slices.append({
                "start": s_start,
                "end": s_end,
                "visuals": matching_visuals,
                "audios": matching_audios,
            })

    if not slices:
        return MergedTimeline(events=[])

    # 2. Coalesce consecutive slices with identical visual and audio sets
    merged_items: list[MergedEventItem] = []
    current_start = slices[0]["start"]
    current_end = slices[0]["end"]
    current_visuals = slices[0]["visuals"]
    current_audios = slices[0]["audios"]

    for s in slices[1:]:
        same_v = set(id(v) for v in s["visuals"]) == set(id(v) for v in current_visuals)
        same_a = set(id(a) for a in s["audios"]) == set(id(a) for a in current_audios)

        if same_v and same_a:
            current_end = s["end"]
        else:
            merged_items.append(
                MergedEventItem(
                    start=current_start,
                    end=current_end,
                    visual=[v.model_dump() for v in current_visuals],
                    audio=[a.model_dump() for a in current_audios],
                )
            )
            current_start = s["start"]
            current_end = s["end"]
            current_visuals = s["visuals"]
            current_audios = s["audios"]

    merged_items.append(
        MergedEventItem(
            start=current_start,
            end=current_end,
            visual=[v.model_dump() for v in current_visuals],
            audio=[a.model_dump() for a in current_audios],
        )
    )

    return MergedTimeline(events=merged_items)


def save_merged_timeline(
    timeline: MergedTimeline,
    output_path: Path | str,
) -> None:
    """Saves merged timeline JSON file to disk."""
    p = Path(output_path)
    ensure_dir(p.parent)
    json_str = dumps_json(timeline.model_dump(), indent=True)
    p.write_text(json_str, encoding="utf-8")
