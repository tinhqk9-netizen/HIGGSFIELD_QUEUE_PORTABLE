"""Job workspace and lifecycle manager for individual video analysis requests."""

import logging
import shutil
import uuid
from pathlib import Path
from video_analyzer.config import settings
from video_analyzer.schemas import VideoArtifacts, VideoMetadata
from video_analyzer.utils.json import dumps_json
from video_analyzer.utils.paths import ensure_dir

logger = logging.getLogger("video_analyzer.jobs.manager")


class JobWorkspace:
    """Represents a job directory workspace on disk."""

    def __init__(self, job_id: str, base_dir: Path | str):
        self.job_id = job_id
        self.root_dir = ensure_dir(Path(base_dir) / job_id)
        self.frames_dir = self.root_dir / "frames"
        self.audio_dir = self.root_dir / "audio"
        self.analysis_dir = self.root_dir / "analysis"
        self.log_file = self.root_dir / "pipeline.log"
        self.metadata_file = self.root_dir / "metadata.json"

        # Create subdirectories
        ensure_dir(self.frames_dir)
        ensure_dir(self.audio_dir)
        ensure_dir(self.analysis_dir)

    @property
    def visual_json_path(self) -> Path:
        return self.analysis_dir / "visual.json"

    @property
    def audio_json_path(self) -> Path:
        return self.analysis_dir / "audio.json"

    @property
    def timeline_json_path(self) -> Path:
        return self.analysis_dir / "timeline.json"

    @property
    def final_json_path(self) -> Path:
        return self.analysis_dir / "final.json"

    @property
    def transcript_json_path(self) -> Path:
        return self.audio_dir / "transcript.json"

    @property
    def subtitle_srt_path(self) -> Path:
        return self.audio_dir / "subtitle.srt"

    def save_metadata(self, metadata: VideoMetadata) -> None:
        """Saves probed video metadata to metadata.json."""
        self.metadata_file.write_text(dumps_json(metadata.model_dump(), indent=True), encoding="utf-8")

    def get_artifacts(self) -> VideoArtifacts:
        """Returns relative or absolute artifact paths."""
        return VideoArtifacts(
            transcript=str(self.transcript_json_path),
            subtitle=str(self.subtitle_srt_path),
            visual=str(self.visual_json_path),
            audio=str(self.audio_json_path),
            timeline=str(self.timeline_json_path),
            final=str(self.final_json_path),
        )

    def cleanup_frames(self) -> None:
        """Removes the frames directory if KEEP_FRAMES is False."""
        if not settings.keep_frames and self.frames_dir.exists():
            try:
                shutil.rmtree(self.frames_dir)
                logger.info(f"Cleaned up extracted frame images for job {self.job_id}.")
            except Exception as e:
                logger.warning(f"Failed to cleanup frames directory {self.frames_dir}: {e}")


class JobManager:
    """Manages creation and lookup of job workspaces."""

    def __init__(self, job_root: Path | str | None = None):
        self.job_root = ensure_dir(job_root or settings.job_root)

    def create_job(self, job_id: str | None = None) -> JobWorkspace:
        """Creates a new unique job workspace."""
        jid = job_id or str(uuid.uuid4())
        return JobWorkspace(job_id=jid, base_dir=self.job_root)


job_manager = JobManager()
