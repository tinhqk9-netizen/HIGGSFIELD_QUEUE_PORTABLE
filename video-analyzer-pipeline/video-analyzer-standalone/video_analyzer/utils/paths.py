"""Path validation, security boundary checking, and hashing utilities."""

import hashlib
import os
from pathlib import Path
from video_analyzer.config import settings


class SecurityPathError(ValueError):
    """Raised when path traversal or unauthorized directory access is detected."""
    pass


class VideoNotFoundError(FileNotFoundError):
    """Raised when the specified video file does not exist."""
    pass


def validate_video_path(video_path: str, custom_roots: list[str] | None = None) -> Path:
    """
    Validates that a video path exists and is located within allowed directory boundaries.
    Prevents path traversal attacks and arbitrary file reads.
    """
    if not video_path or not isinstance(video_path, str):
        raise ValueError("Invalid video path specified.")

    path_obj = Path(video_path).expanduser().resolve()

    if not path_obj.exists():
        raise VideoNotFoundError(f"Video file not found: {video_path}")

    if not path_obj.is_file():
        raise ValueError(f"Path is not a regular file: {video_path}")

    # Gather allowed roots
    roots = custom_roots if custom_roots is not None else settings.allowed_video_roots
    if "*" in roots or not roots:
        return path_obj

    if settings.video_root and settings.video_root not in roots:
        roots = [settings.video_root] + roots

    resolved_roots = [Path(r).expanduser().resolve() for r in roots if r != "*"]

    # Verify path is under at least one allowed root
    is_allowed = False
    for root in resolved_roots:
        try:
            path_obj.relative_to(root)
            is_allowed = True
            break
        except ValueError:
            continue

    if not is_allowed:
        raise SecurityPathError(
            f"Access denied: {video_path} is outside allowed video directories."
        )

    return path_obj


def ensure_dir(dir_path: Path | str) -> Path:
    """Ensures a directory exists, creating parents if necessary."""
    p = Path(dir_path).resolve()
    try:
        p.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    return p


def calculate_file_sha256(file_path: Path | str, chunk_size: int = 65536) -> str:
    """Computes SHA-256 hash of a file efficiently in streaming chunks."""
    p = Path(file_path)
    hasher = hashlib.sha256()
    with open(p, "rb") as f:
        while chunk := f.read(chunk_size):
            hasher.update(chunk)
    return hasher.hexdigest()
