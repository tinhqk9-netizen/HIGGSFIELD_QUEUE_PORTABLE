"""Timestamp utilities for seconds, SRT format, and frame indexing."""

import math


def calculate_frame_timestamp(frame_index: int, interval: float) -> float:
    """Calculate exact timestamp in seconds for a zero-based frame index."""
    return round(frame_index * interval, 3)


def seconds_to_srt_timestamp(seconds: float) -> str:
    """Format seconds into standard SRT timestamp format: HH:MM:SS,mmm."""
    if seconds < 0:
        seconds = 0.0
    
    hrs = int(seconds // 3600)
    rem = seconds % 3600
    mins = int(rem // 60)
    secs = rem % 60
    whole_secs = int(secs)
    millis = int(round((secs - whole_secs) * 1000))
    if millis >= 1000:
        whole_secs += 1
        millis -= 1000

    return f"{hrs:02d}:{mins:02d}:{whole_secs:02d},{millis:03d}"


def srt_timestamp_to_seconds(ts_str: str) -> float:
    """Parse SRT timestamp (HH:MM:SS,mmm or HH:MM:SS.mmm) into float seconds."""
    clean = ts_str.strip().replace(",", ".")
    parts = clean.split(":")
    if len(parts) == 3:
        hrs = float(parts[0])
        mins = float(parts[1])
        secs = float(parts[2])
        return hrs * 3600 + mins * 60 + secs
    elif len(parts) == 2:
        mins = float(parts[0])
        secs = float(parts[1])
        return mins * 60 + secs
    return float(clean)


def format_timestamp_display(seconds: float) -> str:
    """Format seconds into clean human-readable MM:SS or HH:MM:SS."""
    if seconds < 0:
        seconds = 0.0
    hrs = int(seconds // 3600)
    rem = seconds % 3600
    mins = int(rem // 60)
    secs = int(rem % 60)
    if hrs > 0:
        return f"{hrs:02d}:{mins:02d}:{secs:02d}"
    return f"{mins:02d}:{secs:02d}"
