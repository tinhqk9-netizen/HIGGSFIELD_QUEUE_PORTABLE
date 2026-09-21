#!/usr/bin/env python3
"""
Standalone CLI Runner for Multimodal Video Analysis Pipeline.

Usage:
    python analyze.py path/to/video.mp4 [options]

Examples:
    python analyze.py sample.mp4
    python analyze.py sample.mp4 --language vi --interval 1.0 --output result.json
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

# Ensure video_analyzer is importable from current directory
sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from video_analyzer.pipeline import analyze_video
    from video_analyzer.config import settings
except ImportError as e:
    print(f"[Error] Failed to import video_analyzer: {e}")
    print("Make sure dependencies are installed: pip install -r requirements.txt")
    sys.exit(1)


async def progress_printer(stage: str, progress: float):
    percent = int(progress * 100)
    bar_length = 30
    filled = int(bar_length * progress)
    bar = "=" * filled + "-" * (bar_length - filled)
    sys.stderr.write(f"\r[{bar}] {percent:3d}% | Stage: {stage:<20}")
    sys.stderr.flush()
    if progress >= 1.0:
        sys.stderr.write("\n")


def print_formatted_summary(result_dict: dict):
    print("\n" + "=" * 60)
    print("           VIDEO ANALYSIS REPORT")
    print("=" * 60)

    video_info = result_dict.get("video") or {}
    duration = video_info.get("duration")
    width = video_info.get("width")
    height = video_info.get("height")
    fps = video_info.get("fps")
    meta_parts = []
    if duration is not None:
        meta_parts.append(f"Duration: {duration:.1f}s")
    if width and height:
        meta_parts.append(f"Resolution: {width}x{height}")
    if fps is not None:
        meta_parts.append(f"FPS: {fps:.1f}")
    if meta_parts:
        print(f"Metadata: {' | '.join(meta_parts)}")
        print("-" * 60)

    if result_dict.get("summary"):
        print("\n[SUMMARY]")
        print(result_dict["summary"])

    if result_dict.get("purpose"):
        print("\n[PURPOSE]")
        print(result_dict["purpose"])

    if result_dict.get("visual_summary"):
        print("\n[WHAT IS SEEN]")
        print(result_dict["visual_summary"])

    if result_dict.get("audio_summary"):
        print("\n[WHAT IS SAID (TRANSCRIPT)]")
        print(result_dict["audio_summary"])

    key_moments = result_dict.get("key_moments") or []
    if key_moments:
        print("\n[KEY MOMENTS]")
        for m in key_moments:
            ts = m.get("timestamp") or m.get("time")
            desc = m.get("description") or ""
            print(f" - [{ts}s] {desc}")

    ctas = result_dict.get("calls_to_action") or []
    if ctas:
        print("\n[CALLS TO ACTION]")
        for cta in ctas:
            print(f" - {cta}")

    if result_dict.get("conclusion"):
        print("\n[CONCLUSION]")
        print(result_dict["conclusion"])

    print("=" * 60 + "\n")


async def main():
    parser = argparse.ArgumentParser(description="Multimodal Video Analysis CLI")
    parser.add_argument("video", help="Path to video file to analyze")
    parser.add_argument("--language", default="auto", help="Speech language code (e.g. 'vi', 'en', 'auto')")
    parser.add_argument("--interval", type=float, default=0.5, help="Frame extraction interval in seconds (default: 0.5)")
    parser.add_argument("--detail", choices=["summary", "normal", "detailed"], default="detailed", help="Analysis detail level")
    parser.add_argument("--output", "-o", help="Save output JSON to this file path")
    parser.add_argument("--json", action="store_true", help="Print raw JSON to stdout")

    args = parser.parse_args()
    video_path = Path(args.video).resolve()

    if not video_path.exists():
        print(f"[Error] File not found: {video_path}", file=sys.stderr)
        sys.exit(1)

    print(f"Analyzing video: {video_path}")
    print(f"Settings: Frame interval = {args.interval}s | Language = {args.language} | Whisper = {settings.whisper_model} ({settings.whisper_device})")
    print(f"Vision API: {settings.nine_router_base_url} (Model: {settings.vision_model})\n")

    try:
        result = await analyze_video(
            video_path=str(video_path),
            language=args.language,
            frame_interval=args.interval,
            detail=args.detail,
            on_progress=progress_printer,
        )

        result_dict = result.model_dump() if hasattr(result, "model_dump") else dict(result)

        if args.output:
            out_path = Path(args.output).resolve()
            out_path.parent.mkdir(parents=True, exist_ok=True)
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(result_dict, f, ensure_ascii=False, indent=2)
            print(f"\n[Success] Full result saved to {out_path}")

        if args.json:
            print(json.dumps(result_dict, ensure_ascii=False, indent=2))
        else:
            print_formatted_summary(result_dict)

    except Exception as exc:
        print(f"\n[Error] Pipeline failed: {exc}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
