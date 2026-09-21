"""Pydantic data schemas for video_analyzer with robust LLM output normalization."""

import re
from typing import Any, Literal
from pydantic import BaseModel, Field, model_validator


def _parse_time_value(val: Any, default: float = 0.0) -> float:
    """Safely parses float seconds from numbers, '0.5s', or '00:00:01,234'."""
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        val_clean = val.strip().lower().rstrip("s")
        if ":" in val_clean:
            parts = val_clean.replace(",", ".").split(":")
            try:
                if len(parts) == 3:
                    return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
                elif len(parts) == 2:
                    return float(parts[0]) * 60 + float(parts[1])
            except ValueError:
                return default
        try:
            return float(val_clean)
        except ValueError:
            return default
    return default


def _parse_list_of_strings(val: Any) -> list[str]:
    """Converts strings, numbers, or lists into a list of clean non-empty strings."""
    if val is None:
        return []
    if isinstance(val, list):
        out = []
        for item in val:
            if isinstance(item, (str, int, float)):
                s = str(item).strip()
                if s:
                    out.append(s)
            elif isinstance(item, dict):
                s = " ".join(str(v) for v in item.values() if v)
                if s:
                    out.append(s)
        return out
    if isinstance(val, (str, int, float)):
        s = str(val).strip()
        return [s] if s else []
    return []


# ---------------------------------------------------------------------------
# Protocol Messages (TypeScript <-> Python NDJSON)
# ---------------------------------------------------------------------------

class ReadyWhisperInfo(BaseModel):
    model: str = "turbo"
    device: str = "cuda"


class ReadyMessage(BaseModel):
    type: Literal["ready"] = "ready"
    whisper: ReadyWhisperInfo
    gpu: str


class AnalyzeVideoParams(BaseModel):
    video_path: str
    language: str = "auto"
    frame_interval: float = 0.5
    detail: Literal["summary", "normal", "detailed"] = "detailed"


class RequestMessage(BaseModel):
    type: Literal["request"] = "request"
    request_id: str
    action: Literal["analyze_video", "ping", "shutdown"] = "analyze_video"
    params: AnalyzeVideoParams | dict[str, Any] = Field(default_factory=dict)


class ProgressMessage(BaseModel):
    type: Literal["progress"] = "progress"
    request_id: str
    stage: str
    progress: float = 0.0
    message: str = ""


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class ResponseMessage(BaseModel):
    type: Literal["response"] = "response"
    request_id: str
    ok: bool = True
    result: dict[str, Any] | None = None
    error: ErrorDetail | None = None


# ---------------------------------------------------------------------------
# Media / Probe Schemas
# ---------------------------------------------------------------------------

class VideoMetadata(BaseModel):
    path: str
    duration: float
    width: int = 0
    height: int = 0
    fps: float = 0.0
    video_codec: str = ""
    audio_codec: str = ""
    has_video: bool = True
    has_audio: bool = False
    file_size: int = 0


# ---------------------------------------------------------------------------
# Visual Pipeline Schemas
# ---------------------------------------------------------------------------

class FrameItem(BaseModel):
    index: int
    timestamp: float
    path: str


class FrameBatch(BaseModel):
    batch_index: int
    frames: list[FrameItem]
    start_time: float
    end_time: float


class VisualEvent(BaseModel):
    start: float
    end: float
    description: str
    scene: str = ""
    people: list[str] = Field(default_factory=list)
    objects: list[str] = Field(default_factory=list)
    products: list[str] = Field(default_factory=list)
    actions: list[str] = Field(default_factory=list)
    visible_text: list[str] = Field(default_factory=list)
    confidence: float | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_visual_event(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        # Normalize start
        start_val = data.get("start") or data.get("start_timestamp") or data.get("start_time") or data.get("timestamp")
        start = _parse_time_value(start_val, 0.0)

        # Normalize end
        end_val = data.get("end") or data.get("end_timestamp") or data.get("end_time")
        end = _parse_time_value(end_val, start + 0.5)
        if end < start:
            end = start + 0.5

        # Normalize description: avoid duplicating scene when actions or people contain detailed activity
        candidate = (
            data.get("description")
            or data.get("event")
            or data.get("action")
            or data.get("summary")
            or data.get("significant_changes")
        )
        scene_name = str(data.get("scene", "") or data.get("environment", "")).strip()

        if not candidate or str(candidate).strip().lower() == scene_name.lower():
            people_items = _parse_list_of_strings(data.get("people"))
            action_items = _parse_list_of_strings(data.get("actions"))
            parts = []
            if action_items:
                parts.append(", ".join(action_items))
            if people_items:
                parts.append(" · ".join(people_items))
            if parts:
                candidate = " | ".join(parts)
            elif scene_name:
                candidate = scene_name
            else:
                candidate = "Visual event observed"

        desc = candidate

        return {
            "start": round(start, 2),
            "end": round(end, 2),
            "description": str(desc).strip(),
            "scene": str(data.get("scene", "") or data.get("environment", "")).strip(),
            "people": _parse_list_of_strings(data.get("people")),
            "objects": _parse_list_of_strings(data.get("objects")),
            "products": _parse_list_of_strings(data.get("products")),
            "actions": _parse_list_of_strings(data.get("actions")),
            "visible_text": _parse_list_of_strings(data.get("visible_text") or data.get("text")),
            "confidence": data.get("confidence"),
        }


class RawVisionResponse(BaseModel):
    events: list[VisualEvent] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def normalize_raw_response(cls, data: Any) -> Any:
        if isinstance(data, list):
            return {"events": data}
        if isinstance(data, dict):
            if "events" not in data:
                # Check for alternative keys like "visual_events", "items"
                for alt_key in ["visual_events", "items", "data", "results"]:
                    if alt_key in data and isinstance(data[alt_key], list):
                        return {"events": data[alt_key]}
        return data


class VisualBatchResult(BaseModel):
    batch_index: int
    events: list[VisualEvent] = Field(default_factory=list)
    error: str | None = None


class VisualAnalysisResult(BaseModel):
    status: Literal["success", "partial", "failed"] = "success"
    events: list[VisualEvent] = Field(default_factory=list)
    scenes: list[str] = Field(default_factory=list)
    people: list[str] = Field(default_factory=list)
    objects: list[str] = Field(default_factory=list)
    products: list[str] = Field(default_factory=list)
    visible_text: list[str] = Field(default_factory=list)
    total_frames: int = 0
    processed_batches: int = 0
    failed_batches: int = 0


# ---------------------------------------------------------------------------
# Audio Pipeline Schemas
# ---------------------------------------------------------------------------

class WhisperSegment(BaseModel):
    id: int
    start: float
    end: float
    text: str


class WhisperTranscript(BaseModel):
    language: str = "auto"
    text: str = ""
    segments: list[WhisperSegment] = Field(default_factory=list)


class AudioEvent(BaseModel):
    start: float
    end: float
    speech: str
    meaning: str = ""
    topics: list[str] = Field(default_factory=list)
    entities: list[str] = Field(default_factory=list)
    claims: list[str] = Field(default_factory=list)
    cta: str | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_audio_event(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        start_val = data.get("start") or data.get("start_timestamp") or data.get("start_time") or data.get("timestamp")
        start = _parse_time_value(start_val, 0.0)

        end_val = data.get("end") or data.get("end_timestamp") or data.get("end_time")
        end = _parse_time_value(end_val, start + 1.0)
        if end < start:
            end = start + 1.0

        speech = data.get("speech") or data.get("text") or data.get("transcript") or ""
        meaning = data.get("meaning") or data.get("intent") or data.get("summary") or ""
        cta = data.get("cta") or data.get("call_to_action")

        return {
            "start": round(start, 2),
            "end": round(end, 2),
            "speech": str(speech).strip(),
            "meaning": str(meaning).strip(),
            "topics": _parse_list_of_strings(data.get("topics")),
            "entities": _parse_list_of_strings(data.get("entities")),
            "claims": _parse_list_of_strings(data.get("claims")),
            "cta": str(cta).strip() if cta else None,
        }


class RawAudioResponse(BaseModel):
    events: list[AudioEvent] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def normalize_raw_audio(cls, data: Any) -> Any:
        if isinstance(data, list):
            return {"events": data}
        if isinstance(data, dict):
            if "events" not in data:
                for alt_key in ["audio_events", "items", "data", "results", "dialogues"]:
                    if alt_key in data and isinstance(data[alt_key], list):
                        return {"events": data[alt_key]}
        return data


class AudioAnalysisResult(BaseModel):
    status: Literal["success", "partial", "failed", "skipped"] = "success"
    language: str = "auto"
    full_text: str = ""
    segments: list[WhisperSegment] = Field(default_factory=list)
    events: list[AudioEvent] = Field(default_factory=list)
    topics: list[str] = Field(default_factory=list)
    claims: list[str] = Field(default_factory=list)
    calls_to_action: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Multimodal Merge & Final Synthesis Schemas
# ---------------------------------------------------------------------------

class MergedEventItem(BaseModel):
    start: float
    end: float
    visual: list[dict[str, Any]] = Field(default_factory=list)
    audio: list[dict[str, Any]] = Field(default_factory=list)


class MergedTimeline(BaseModel):
    events: list[MergedEventItem] = Field(default_factory=list)


class KeyMoment(BaseModel):
    timestamp: float
    description: str

    @model_validator(mode="before")
    @classmethod
    def normalize_key_moment(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        ts = data.get("timestamp") or data.get("time") or data.get("start")
        desc = data.get("description") or data.get("event") or data.get("summary") or "Key moment"
        return {
            "timestamp": round(_parse_time_value(ts, 0.0), 2),
            "description": str(desc).strip(),
        }


class TimelineSynthesisItem(BaseModel):
    start: float
    end: float
    visual: str = ""
    speech: str = ""
    analysis: str = ""

    @model_validator(mode="before")
    @classmethod
    def normalize_synthesis_item(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        st = _parse_time_value(data.get("start") or data.get("start_time"), 0.0)
        en = _parse_time_value(data.get("end") or data.get("end_time"), st + 1.0)
        vis = data.get("visual") or data.get("visual_description") or ""
        sp = data.get("speech") or data.get("dialogue") or data.get("spoken") or ""
        an = data.get("analysis") or data.get("relationship") or data.get("description") or ""
        return {
            "start": round(st, 2),
            "end": round(en, 2),
            "visual": str(vis).strip() if isinstance(vis, str) else str(vis),
            "speech": str(sp).strip() if isinstance(sp, str) else str(sp),
            "analysis": str(an).strip(),
        }


class VisualSummary(BaseModel):
    scenes: list[str] = Field(default_factory=list)
    people: list[str] = Field(default_factory=list)
    objects: list[str] = Field(default_factory=list)
    products: list[str] = Field(default_factory=list)
    visible_text: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def normalize_visual_summary(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        return {
            "scenes": _parse_list_of_strings(data.get("scenes")),
            "people": _parse_list_of_strings(data.get("people")),
            "objects": _parse_list_of_strings(data.get("objects")),
            "products": _parse_list_of_strings(data.get("products")),
            "visible_text": _parse_list_of_strings(data.get("visible_text")),
        }


class AudioSummary(BaseModel):
    language: str = "auto"
    topics: list[str] = Field(default_factory=list)
    claims: list[str] = Field(default_factory=list)
    calls_to_action: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def normalize_audio_summary(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        return {
            "language": str(data.get("language", "auto")),
            "topics": _parse_list_of_strings(data.get("topics")),
            "claims": _parse_list_of_strings(data.get("claims")),
            "calls_to_action": _parse_list_of_strings(data.get("calls_to_action") or data.get("cta")),
        }


def _clamp_score(val: Any) -> int | None:
    """Kẹp điểm về thang 1-10. Trả None khi AI không chấm (KHÔNG bịa điểm mặc định)."""
    if val is None or isinstance(val, bool):
        return None
    try:
        n = float(val)
    except (TypeError, ValueError):
        return None
    if n != n:  # NaN
        return None
    return int(max(1, min(10, round(n))))


_HOOK_TYPES = {"cau-hoi","gay-soc","van-de","truoc-sau","so-sanh","demo","loi-chung","con-so","khac"}


class HookAnalysis(BaseModel):
    """Phân tích 3 giây đầu — quyết định người xem có dừng lại hay không."""
    type: str = ""
    first_3s: str = ""
    score_1_10: int | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_hook(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return {"type": "", "first_3s": "", "score_1_10": None}
        raw_type = str(data.get("type") or data.get("hook_type") or "").strip().lower()
        return {
            "type": raw_type if raw_type in _HOOK_TYPES else ("khac" if raw_type else ""),
            "first_3s": str(data.get("first_3s") or data.get("first_three_seconds") or "").strip(),
            "score_1_10": _clamp_score(data.get("score_1_10") or data.get("score")),
        }


class CriteriaScores(BaseModel):
    """7 tiêu chí chấm quảng cáo short-form, mỗi tiêu chí 1-10."""
    hook: int | None = None
    structure: int | None = None
    pacing: int | None = None
    visual: int | None = None
    audio: int | None = None
    message: int | None = None
    cta: int | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_scores(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return {}
        return {k: _clamp_score(data.get(k)) for k in
                ("hook", "structure", "pacing", "visual", "audio", "message", "cta")}


class ScriptStructure(BaseModel):
    """Mạch kịch bản: vấn đề -> giải pháp -> bằng chứng -> kêu gọi hành động."""
    problem: str = ""
    solution: str = ""
    proof: str = ""
    cta: str = ""

    @model_validator(mode="before")
    @classmethod
    def normalize_structure(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return {}
        return {k: str(data.get(k) or "").strip() for k in ("problem", "solution", "proof", "cta")}


class SynthesisLLMResponse(BaseModel):
    summary: str
    purpose: str = ""
    timeline: list[TimelineSynthesisItem] = Field(default_factory=list)
    key_moments: list[KeyMoment] = Field(default_factory=list)
    visual_summary: VisualSummary = Field(default_factory=VisualSummary)
    audio_summary: AudioSummary = Field(default_factory=AudioSummary)
    entities: list[str] = Field(default_factory=list)
    calls_to_action: list[str] = Field(default_factory=list)
    conclusion: str = ""
    hook_analysis: HookAnalysis = Field(default_factory=HookAnalysis)
    criteria_scores: CriteriaScores = Field(default_factory=CriteriaScores)
    overall_score_1_10: int | None = None
    structure: ScriptStructure = Field(default_factory=ScriptStructure)
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def normalize_synthesis(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        summary = (
            data.get("summary")
            or data.get("overall_summary")
            or data.get("overview")
            or data.get("description")
            or data.get("overall_purpose")
            or "Video multimodal analysis completed."
        )

        purpose = (
            data.get("purpose")
            or data.get("overall_purpose")
            or data.get("main_subject")
            or data.get("intent")
            or ""
        )

        conclusion = (
            data.get("conclusion")
            or data.get("overall_conclusion")
            or data.get("final_conclusion")
            or ""
        )

        tl_raw = data.get("timeline") or data.get("scene_by_scene") or data.get("events") or []
        km_raw = data.get("key_moments") or data.get("important_moments") or data.get("highlights") or []
        ctas = data.get("calls_to_action") or data.get("calls_to_action_list") or []

        return {
            "summary": str(summary).strip(),
            "purpose": str(purpose).strip(),
            "timeline": tl_raw if isinstance(tl_raw, list) else [],
            "key_moments": km_raw if isinstance(km_raw, list) else [],
            "visual_summary": data.get("visual_summary") or {},
            "audio_summary": data.get("audio_summary") or {},
            "entities": _parse_list_of_strings(data.get("entities")),
            "calls_to_action": _parse_list_of_strings(ctas),
            "conclusion": str(conclusion).strip(),
            "hook_analysis": data.get("hook_analysis") or {},
            "criteria_scores": data.get("criteria_scores") or data.get("scores") or {},
            "overall_score_1_10": _clamp_score(
                data.get("overall_score_1_10") or data.get("overall_score") or data.get("score")
            ),
            "structure": data.get("structure") or data.get("script_structure") or {},
            "strengths": _parse_list_of_strings(data.get("strengths")),
            "weaknesses": _parse_list_of_strings(data.get("weaknesses")),
            "improvements": _parse_list_of_strings(
                data.get("improvements") or data.get("suggestions")
            ),
        }


class VideoArtifacts(BaseModel):
    transcript: str = ""
    subtitle: str = ""
    visual: str = ""
    audio: str = ""
    timeline: str = ""
    final: str = ""


class VideoBasicInfo(BaseModel):
    path: str
    duration: float
    width: int = 0
    height: int = 0
    fps: float = 0.0


class FinalAnalysisResult(BaseModel):
    job_id: str
    status: Literal["success", "partial", "failed"] = "success"
    visual_status: Literal["success", "partial", "failed"] | None = None
    audio_status: Literal["success", "partial", "failed", "skipped"] | None = None
    video: VideoBasicInfo
    summary: str
    purpose: str = ""
    timeline: list[TimelineSynthesisItem] = Field(default_factory=list)
    key_moments: list[KeyMoment] = Field(default_factory=list)
    visual_summary: VisualSummary = Field(default_factory=VisualSummary)
    audio_summary: AudioSummary = Field(default_factory=AudioSummary)
    entities: list[str] = Field(default_factory=list)
    calls_to_action: list[str] = Field(default_factory=list)
    conclusion: str = ""
    hook_analysis: HookAnalysis = Field(default_factory=HookAnalysis)
    criteria_scores: CriteriaScores = Field(default_factory=CriteriaScores)
    overall_score_1_10: int | None = None
    structure: ScriptStructure = Field(default_factory=ScriptStructure)
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)
    visual_events: list[VisualEvent] = Field(default_factory=list)
    artifacts: VideoArtifacts = Field(default_factory=VideoArtifacts)
