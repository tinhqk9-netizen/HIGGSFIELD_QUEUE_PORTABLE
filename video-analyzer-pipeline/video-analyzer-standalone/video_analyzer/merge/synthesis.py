"""Final video multimodal synthesis using Gemini via 9Router."""

import logging
from pathlib import Path
from pydantic import BaseModel, Field
from video_analyzer.config import settings
from video_analyzer.schemas import (
    AudioAnalysisResult,
    AudioSummary,
    FinalAnalysisResult,
    KeyMoment,
    MergedTimeline,
    SynthesisLLMResponse,
    TimelineSynthesisItem,
    VideoArtifacts,
    VideoBasicInfo,
    VideoMetadata,
    VisualAnalysisResult,
    VisualSummary,
)
from video_analyzer.utils.json import dumps_json
from video_analyzer.utils.paths import ensure_dir
from video_analyzer.vision.prompts import get_final_prompt
from video_analyzer.vision.router_client import nine_router_client

logger = logging.getLogger("video_analyzer.merge.synthesis")


async def run_final_synthesis(
    job_id: str,
    metadata: VideoMetadata,
    timeline: MergedTimeline,
    visual_result: VisualAnalysisResult | None,
    audio_result: AudioAnalysisResult | None,
    artifacts: VideoArtifacts,
    output_json_path: Path | str,
    detail: str = "detailed",
    language: str = "auto",
) -> FinalAnalysisResult:
    """
    Executes final multimodal video synthesis:
    Sends merged timeline and metadata to Gemini Text via 9Router.
    """
    output_path = Path(output_json_path)
    ensure_dir(output_path.parent)

    system_prompt = get_final_prompt()

    timeline_json = dumps_json(timeline.model_dump())

    lang_req = "BẮT BUỘC TRẢ VỀ TOÀN BỘ BẰNG TIẾNG VIỆT (VIETNAMESE). All summaries, purpose, conclusion, and descriptions MUST be in natural Vietnamese." if language in ("vi", "auto") else f"Target Language: {language}"

    user_prompt = (
        f"Video Metadata:\n"
        f"- Path: {metadata.path}\n"
        f"- Duration: {metadata.duration} seconds\n"
        f"- Resolution: {metadata.width}x{metadata.height}\n"
        f"- FPS: {metadata.fps}\n"
        f"- Video Codec: {metadata.video_codec}\n"
        f"- Audio Codec: {metadata.audio_codec}\n"
        f"- Requested detail level: {detail}\n"
        f"- Language Requirement: {lang_req}\n\n"
        f"Synchronized Multimodal Timeline (JSON):\n"
        f"{timeline_json}\n\n"
        f"Synthesize a complete, coherent video analysis matching the required JSON schema in natural Vietnamese."
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    try:
        logger.info(f"Synthesizing final multimodal video analysis for job {job_id} using {settings.text_model}...")
        llm_resp = await nine_router_client.call_structured(
            model=settings.text_model,
            messages=messages,
            schema=SynthesisLLMResponse,
        )
    except Exception as e:
        # HARD-FAIL: KHÔNG bịa summary dự phòng khi AI (text LLM) không gọi được API.
        # Ném lỗi rõ ràng để tầng trên (worker → Node) CHẶN hoàn tất Step 2
        # (rule §13 mock≠real, §41 không nuốt lỗi).
        logger.error(f"Synthesis (text LLM '{settings.text_model}') failed: {e}")
        raise RuntimeError(
            f"AI tổng hợp (text LLM '{settings.text_model}') không gọi được API 9Router: {e}"
        )

    # HARD-FAIL: nếu AI tổng hợp KHÔNG ra nội dung thật (summary rỗng/generic mặc định + purpose
    # rỗng) → coi như AI không phân tích được (bịa) → ném lỗi để CHẶN done Step 2 (§13/§41).
    _generic = {
        "video multimodal analysis completed.",
        "video analysis completed.",
    }
    _summary = (llm_resp.summary or "").strip()
    _purpose = (llm_resp.purpose or "").strip()
    if (not _summary or _summary.lower() in _generic) and not _purpose:
        raise RuntimeError(
            f"AI tổng hợp (text LLM '{settings.text_model}') trả về rỗng/generic — không phân tích "
            f"thật được nội dung video (kiểm tra model/prompt/response_format)."
        )

    # Determine overall status
    vis_status = visual_result.status if visual_result else "failed"
    aud_status = audio_result.status if audio_result else "skipped"

    overall_status = "success"
    if vis_status == "failed" and aud_status == "failed":
        overall_status = "failed"
    elif vis_status in ("partial", "failed") or aud_status in ("partial", "failed"):
        overall_status = "partial"

    final_result = FinalAnalysisResult(
        job_id=job_id,
        status=overall_status,
        visual_status=vis_status,
        audio_status=aud_status,
        video=VideoBasicInfo(
            path=metadata.path,
            duration=metadata.duration,
            width=metadata.width,
            height=metadata.height,
            fps=metadata.fps,
        ),
        summary=llm_resp.summary,
        purpose=llm_resp.purpose,
        timeline=llm_resp.timeline,
        key_moments=llm_resp.key_moments,
        visual_summary=llm_resp.visual_summary,
        audio_summary=llm_resp.audio_summary,
        entities=llm_resp.entities,
        calls_to_action=llm_resp.calls_to_action,
        conclusion=llm_resp.conclusion,
        hook_analysis=llm_resp.hook_analysis,
        criteria_scores=llm_resp.criteria_scores,
        overall_score_1_10=llm_resp.overall_score_1_10,
        structure=llm_resp.structure,
        strengths=llm_resp.strengths,
        weaknesses=llm_resp.weaknesses,
        improvements=llm_resp.improvements,
        visual_events=visual_result.events if visual_result else [],
        artifacts=artifacts,
    )

    output_path.write_text(dumps_json(final_result.model_dump(), indent=True), encoding="utf-8")
    logger.info(f"Saved final synthesis to {output_path}.")
    return final_result
