"""Persistent STDIO NDJSON worker process for OpenClaw Video Analyzer."""

import asyncio
import json
import logging
import os
import sys
from pathlib import Path

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
import torch
from video_analyzer.audio.whisper_engine import whisper_engine
from video_analyzer.config import settings
from video_analyzer.pipeline import analyze_video
from video_analyzer.schemas import (
    AnalyzeVideoParams,
    ErrorDetail,
    ProgressMessage,
    ReadyMessage,
    ReadyWhisperInfo,
    RequestMessage,
    ResponseMessage,
)
from video_analyzer.utils.paths import SecurityPathError, VideoNotFoundError

# Configure logging strictly to STDERR so STDOUT remains clean for NDJSON protocol
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(name)s] [%(levelname)s] %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("video_analyzer.worker")


def send_ndjson_message(msg_dict: dict) -> None:
    """Writes a single-line JSON string to stdout and flushes immediately."""
    line = json.dumps(msg_dict, ensure_ascii=False)
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


class VideoAnalyzerWorker:
    """
    Main persistent worker loop reading NDJSON requests from stdin
    and processing video analysis sequentially.
    """

    def __init__(self):
        self._queue: asyncio.Queue[tuple[str, RequestMessage]] = asyncio.Queue()
        self._running: bool = False
        self._worker_tasks: list[asyncio.Task] = []

    async def initialize(self) -> None:
        """Validates environment, CUDA, ffmpeg, and loads Whisper model."""
        logger.info("Initializing Video Analyzer Worker...")

        # 1. Validate binaries
        if not Path(settings.ffmpeg_bin).exists() and not shutil_which(settings.ffmpeg_bin):
            logger.warning(f"ffmpeg binary not found at '{settings.ffmpeg_bin}'. Please verify path.")
        if not Path(settings.ffprobe_bin).exists() and not shutil_which(settings.ffprobe_bin):
            logger.warning(f"ffprobe binary not found at '{settings.ffprobe_bin}'. Please verify path.")

        # 2. Check CUDA & Load Whisper model
        cuda_ok = torch.cuda.is_available()
        gpu_name = torch.cuda.get_device_name(0) if cuda_ok else "None"
        logger.info(f"CUDA available: {cuda_ok}, Device: {gpu_name}")

        if not cuda_ok and not settings.allow_cpu_fallback:
            logger.error("CUDA is not available and ALLOW_CPU_FALLBACK is False. Startup aborted.")
            raise RuntimeError("CUDA is required for Video Analyzer Worker.")

        # 3. Pre-load Whisper model into VRAM
        logger.info(f"Pre-loading Whisper '{settings.whisper_model}' model...")
        whisper_engine.load()

        device_mode, _ = whisper_engine.get_device_info()

        # 4. Emit READY event to TypeScript plugin
        ready_msg = ReadyMessage(
            whisper=ReadyWhisperInfo(
                model=settings.whisper_model,
                device=device_mode,
            ),
            gpu=gpu_name,
        )
        send_ndjson_message(ready_msg.model_dump())
        logger.info("Worker is READY and listening on stdin.")

    async def _process_queue(self) -> None:
        """Worker task processing video jobs sequentially."""
        while self._running:
            try:
                request_id, req = await self._queue.get()
            except asyncio.CancelledError:
                break

            try:
                if req.action == "ping":
                    resp = ResponseMessage(
                        request_id=request_id,
                        ok=True,
                        result={"pong": True},
                    )
                    send_ndjson_message(resp.model_dump())
                    continue

                if req.action == "shutdown":
                    logger.info("Received shutdown action in queue.")
                    self._running = False
                    whisper_engine.unload()
                    resp = ResponseMessage(
                        request_id=request_id,
                        ok=True,
                        result={"status": "shutdown_complete"},
                    )
                    send_ndjson_message(resp.model_dump())
                    break

                if req.action == "analyze_video":
                    params_dict = req.params if isinstance(req.params, dict) else req.params.model_dump()
                    params = AnalyzeVideoParams.model_validate(params_dict)

                    async def progress_cb(stage: str, prog: float):
                        prog_msg = ProgressMessage(
                            request_id=request_id,
                            stage=stage,
                            progress=round(prog, 2),
                        )
                        send_ndjson_message(prog_msg.model_dump())

                    logger.info(f"Processing analyze_video request {request_id} for {params.video_path}...")

                    result = await analyze_video(
                        video_path=params.video_path,
                        language=params.language,
                        frame_interval=params.frame_interval,
                        detail=params.detail,
                        job_id=request_id,
                        on_progress=progress_cb,
                    )

                    resp = ResponseMessage(
                        request_id=request_id,
                        ok=True,
                        result=result.model_dump(),
                    )
                    send_ndjson_message(resp.model_dump())

            except VideoNotFoundError as e:
                logger.error(f"VideoNotFoundError for request {request_id}: {e}")
                resp = ResponseMessage(
                    request_id=request_id,
                    ok=False,
                    error=ErrorDetail(code="VIDEO_NOT_FOUND", message=str(e)),
                )
                send_ndjson_message(resp.model_dump())
            except SecurityPathError as e:
                logger.error(f"SecurityPathError for request {request_id}: {e}")
                resp = ResponseMessage(
                    request_id=request_id,
                    ok=False,
                    error=ErrorDetail(code="PATH_OUTSIDE_VIDEO_ROOT", message=str(e)),
                )
                send_ndjson_message(resp.model_dump())
            except Exception as e:
                logger.exception(f"Unhandled error processing request {request_id}: {e}")
                resp = ResponseMessage(
                    request_id=request_id,
                    ok=False,
                    error=ErrorDetail(code="PIPELINE_ERROR", message=str(e)),
                )
                send_ndjson_message(resp.model_dump())
            finally:
                self._queue.task_done()

    async def run(self) -> None:
        """Starts worker listening loop reading lines from stdin."""
        self._running = True
        await self.initialize()

        # Nhieu luong tieu thu hang doi. Whisper tu xep hang bang asyncio.Lock cua no,
        # nen chay song song KHONG lam hai GPU; phan chong lan that su la vision + synthesis.
        n = max(1, int(getattr(settings, "worker_concurrency", 1) or 1))
        self._worker_tasks = [asyncio.create_task(self._process_queue()) for _ in range(n)]
        logger.info(f"Started {n} analysis worker task(s).")

        logger.info("STDIN reader loop started.")

        try:
            while self._running:
                line_str = await asyncio.to_thread(sys.stdin.readline)
                if not line_str:
                    logger.info("STDIN reached EOF. Shutting down worker.")
                    break

                line_str = line_str.strip()
                if not line_str:
                    continue

                try:
                    data = json.loads(line_str)
                    request_id = data.get("request_id") or "req_default"
                    req = RequestMessage.model_validate(data)
                    await self._queue.put((request_id, req))
                except Exception as parse_err:
                    logger.error(f"Failed to parse incoming JSON request line: {parse_err}")
                    err_resp = ResponseMessage(
                        request_id=data.get("request_id", "unknown") if "data" in locals() and isinstance(data, dict) else "unknown",
                        ok=False,
                        error=ErrorDetail(code="INVALID_JSON", message=str(parse_err)),
                    )
                    send_ndjson_message(err_resp.model_dump())

        except asyncio.CancelledError:
            logger.info("Worker loop cancelled.")
        finally:
            self._running = False
            for t in self._worker_tasks:
                t.cancel()
            whisper_engine.unload()
            logger.info("Worker shutdown complete.")


def shutil_which(binary_name: str) -> bool:
    import shutil
    return bool(shutil.which(binary_name))


def main() -> None:
    """Entry point for python -m video_analyzer.worker."""
    try:
        asyncio.run(VideoAnalyzerWorker().run())
    except KeyboardInterrupt:
        logger.info("Worker interrupted by user.")
    except Exception as e:
        logger.critical(f"Worker crashed with fatal error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
