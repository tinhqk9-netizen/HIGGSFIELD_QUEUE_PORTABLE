"""Local Whisper Engine singleton running on NVIDIA RTX 3060 CUDA."""

import asyncio
import logging
from pathlib import Path
import torch
import whisper
from video_analyzer.config import settings
from video_analyzer.schemas import WhisperSegment, WhisperTranscript

logger = logging.getLogger("video_analyzer.audio.whisper")


class WhisperEngineError(Exception):
    """Raised when Whisper fails to load or transcribe."""
    pass


class WhisperEngine:
    """
    Persistent Whisper model singleton.
    Loads model once into GPU memory and keeps it alive across video requests.
    """

    def __init__(self):
        self.model: whisper.Whisper | None = None
        self._model_name: str = ""
        self._device: str = ""
        self._lock = asyncio.Lock()

    def get_device_info(self) -> tuple[str, str]:
        """Returns active device and GPU name if available."""
        cuda_ok = torch.cuda.is_available()
        if cuda_ok:
            gpu_name = torch.cuda.get_device_name(0)
            return "cuda", gpu_name
        return "cpu", "CPU"

    def load(
        self,
        model_name: str | None = None,
        device: str | None = None,
    ) -> None:
        """
        Loads the Whisper model into memory.
        Validates CUDA availability based on configuration.
        """
        target_model = model_name or settings.whisper_model
        target_device = device or settings.whisper_device

        cuda_available = torch.cuda.is_available()

        if target_device == "cuda" and not cuda_available:
            if settings.allow_cpu_fallback:
                logger.warning("CUDA is not available. Falling back to CPU because ALLOW_CPU_FALLBACK=True.")
                target_device = "cpu"
            else:
                raise WhisperEngineError(
                    "CUDA is not available on this system and ALLOW_CPU_FALLBACK is False. "
                    "Cannot start Whisper on CPU."
                )

        if self.model is not None and self._model_name == target_model and self._device == target_device:
            logger.debug(f"Whisper model {target_model} is already loaded on {target_device}.")
            return

        logger.info(f"Loading Whisper model '{target_model}' on device '{target_device}'...")
        try:
            if target_device == "cuda":
                torch.backends.cudnn.benchmark = False
                if hasattr(torch.backends.cuda.matmul, "allow_tf32"):
                    torch.backends.cuda.matmul.allow_tf32 = True
            self.model = whisper.load_model(target_model, device=target_device)
            self._model_name = target_model
            self._device = target_device
            logger.info(f"Successfully loaded Whisper '{target_model}' on '{target_device}'.")
        except Exception as e:
            if ("CUDA out of memory" in str(e) or "CUDA" in str(e)) and (settings.allow_cpu_fallback or target_device == "cuda"):
                logger.warning(f"CUDA allocation failed: {e}. Falling back to CPU for Whisper...")
                self.model = whisper.load_model(target_model, device="cpu")
                self._model_name = target_model
                self._device = "cpu"
                logger.info(f"Successfully loaded Whisper '{target_model}' on 'cpu' fallback.")
            else:
                logger.error(f"Failed to load Whisper model: {e}")
                raise WhisperEngineError(f"Failed to load Whisper model: {e}") from e

    async def transcribe(
        self,
        video_path: Path | str,
        language: str = "auto",
    ) -> WhisperTranscript:
        """
        Transcribes the audio track of the video file using the local Whisper model.
        Runs transcription in a background thread to avoid blocking the asyncio event loop.
        """
        if self.model is None:
            self.load()

        video_file = str(Path(video_path).resolve())
        lang_arg = None if (not language or language == "auto") else language.strip().lower()

        logger.info(f"Transcribing audio from '{video_file}' (language: {language})...")

        def _sync_transcribe() -> dict:
            options = {
                "verbose": False,
                "task": "transcribe",
                "fp16": (self._device == "cuda"),
            }
            if lang_arg:
                options["language"] = lang_arg
            
            import contextlib, sys
            with contextlib.redirect_stdout(sys.stderr):
                try:
                    return self.model.transcribe(video_file, **options)
                except Exception as cuda_err:
                    if "CUDA" in str(cuda_err) or "cuDNN" in str(cuda_err):
                        logger.warning(f"CUDA transcription encountered error: {cuda_err}. Retrying with CPU fallback...")
                        cpu_model = whisper.load_model(self._model_name, device="cpu")
                        options["fp16"] = False
                        return cpu_model.transcribe(video_file, **options)
                    raise

        async with self._lock:
            try:
                result = await asyncio.to_thread(_sync_transcribe)
            except Exception as e:
                logger.error(f"Whisper transcription failed: {e}")
                raise WhisperEngineError(f"Whisper transcription failed: {e}") from e

        detected_lang = result.get("language", language)
        full_text = result.get("text", "").strip()
        raw_segments = result.get("segments", [])

        segments: list[WhisperSegment] = []
        for seg in raw_segments:
            segments.append(
                WhisperSegment(
                    id=int(seg.get("id", len(segments))),
                    start=round(float(seg.get("start", 0.0)), 3),
                    end=round(float(seg.get("end", 0.0)), 3),
                    text=str(seg.get("text", "")).strip(),
                )
            )

        logger.info(
            f"Transcription complete: {len(segments)} segments, detected language '{detected_lang}'."
        )

        return WhisperTranscript(
            language=detected_lang,
            text=full_text,
            segments=segments,
        )

    def unload(self) -> None:
        """Releases model from memory and clears CUDA cache."""
        if self.model is not None:
            logger.info("Unloading Whisper model...")
            self.model = None
            self._model_name = ""
            self._device = ""
            if torch.cuda.is_available():
                torch.cuda.empty_cache()


whisper_engine = WhisperEngine()
