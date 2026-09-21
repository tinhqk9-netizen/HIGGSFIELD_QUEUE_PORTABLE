# Multimodal Video Analyzer Pipeline (Độc lập / Standalone)

Bộ công cụ phân tích video đa phương thức hoàn chỉnh: **Whisper Speech-to-Text (local) + FFmpeg Frame Extraction + Vision Model (Gemini/OpenAI) + Đồng bộ Timeline tự động**.

Pipeline này có thể đem sang bất kỳ thiết bị nào (Linux, macOS, Windows) và chạy độc lập mà không phụ thuộc vào hệ thống mẹ GTF hay OpenClaw.

---

## 🌟 Tính năng nổi bật

1. **Thị giác (Visual)**: Dùng FFmpeg bóc tách khung hình đều đặn theo chu kỳ (mặc định mỗi `0.5s`), gửi qua Vision model để nhận diện:
   - Bối cảnh, không gian, các nhân vật / vật thể.
   - Hành động và diễn biến từng khoảnh khắc.
   - Chữ hiển thị trên màn hình (on-screen text / slide / phụ đề có sẵn).
2. **Âm thanh (Audio)**: Chạy mô hình **Whisper** 100% offline trên thiết bị:
   - Tự động nhận diện ngôn ngữ hoặc chỉ định tiếng Việt (`vi`), tiếng Anh (`en`).
   - Khớp mốc thời gian (timestamp) đến từng câu thoại.
   - Xuất file phụ đề chuẩn SRT / VTT và JSON transcript.
3. **Đồng bộ dòng thời gian (Deterministic Timeline Merging)**:
   - Tự động gộp 2 dòng thời gian (hình ảnh nhìn thấy + âm thanh nghe thấy) thành một timeline logic:
     `[Xs–Ys] seen: <hình ảnh> | said: "<lời thoại>" | note: <ghi chú>`
4. **Tổng hợp báo cáo chuyên sâu (Multimodal Synthesis)**:
   - Tóm tắt tổng thể (Executive Summary) & Mục đích video.
   - Phân tích chi tiết: Những gì nhìn thấy (What is seen) vs Những gì nghe thấy (What is said).
   - Các khoảnh khắc quan trọng theo giây (Key Moments).
   - Lời kêu gọi hành động (Calls to Action) và Kết luận (Conclusion).

---

## 💻 Yêu cầu hệ thống

1. **Python**: Phiên bản `>= 3.11`.
2. **FFmpeg & FFprobe**:
   - **Ubuntu/Debian**: `sudo apt update && sudo apt install ffmpeg -y`
   - **macOS** (Homebrew): `brew install ffmpeg`
   - **Windows** (Chocolatey hoặc Scoop): `choco install ffmpeg` hoặc tải file zip từ `ffmpeg.org` và thêm vào `PATH`.
3. **Phần cứng**:
   - **Tốt nhất**: Máy có GPU NVIDIA (hỗ trợ CUDA) để Whisper chạy siêu nhanh (chỉ mất vài giây).
   - **Vẫn chạy tốt**: CPU thông thường hoặc chip Apple Silicon (M1/M2/M3). Hệ thống có cờ `ALLOW_CPU_FALLBACK=true` tự động dùng CPU nếu không có GPU.
4. **API Vision / LLM**:
   - Cần một endpoint OpenAI-compatible hỗ trợ Vision (ví dụ: OpenAI `gpt-4o-mini`, 9Router `gemini-3.7-flash`, OpenRouter, hoặc Ollama local).

---

## 🚀 Hướng dẫn cài đặt nhanh

### Bước 1: Tạo môi trường ảo Python
```bash
cd video-analyzer-standalone

# Tạo venv
python3 -m venv .venv

# Kích hoạt venv:
# Trên Linux/macOS:
source .venv/bin/activate
# Trên Windows:
# .venv\Scripts\activate
```

### Bước 2: Cài đặt thư viện
```bash
pip install --upgrade pip
pip install -r requirements.txt
```

> **Mẹo cho thiết bị có GPU NVIDIA (CUDA):**
> Nếu muốn Whisper chạy với GPU tối ưu nhất, bạn có thể cài PyTorch với CUDA tương ứng:
> ```bash
> pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
> ```

### Bước 3: Cấu hình file `.env`
Sao chép file `.env.example` thành `.env`:
```bash
cp .env.example .env
```
Mở file `.env` và cấu hình:
- `NINE_ROUTER_BASE_URL`: Endpoint API (ví dụ `https://api.openai.com/v1` hoặc `http://127.0.0.1:20128/v1`).
- `NINE_ROUTER_API_KEY`: API Key của bạn.
- `VISION_MODEL` & `TEXT_MODEL`: Tên model (ví dụ `gpt-4o-mini` hoặc `ag/gemini-3.7-flash-high`).
- `WHISPER_MODEL`: Mặc định `turbo`. Nếu máy yếu có thể đổi thành `base` hoặc `small`.
- `WHISPER_DEVICE`: `cuda` (nếu có card NVIDIA) hoặc `cpu`.

---

## 🛠️ Cách sử dụng

### Cách 1: Chạy trực tiếp qua lệnh CLI (Khuyên dùng)
```bash
# Phân tích video đơn giản (tự động in báo cáo chi tiết ra màn hình)
python analyze.py /path/to/video.mp4

# Chỉ định ngôn ngữ tiếng Việt, cắt frame mỗi 1.0 giây, lưu kết quả ra file JSON
python analyze.py /path/to/video.mp4 --language vi --interval 1.0 --output ket_qua.json

# In chuỗi JSON thô (raw JSON)
python analyze.py /path/to/video.mp4 --json
```

---

### Cách 2: Tích hợp vào mã nguồn Python của dự án khác
```python
import asyncio
from video_analyzer.pipeline import analyze_video

async def main():
    result = await analyze_video(
        video_path="video_cua_ban.mp4",
        language="vi",          # hoặc "auto", "en"
        frame_interval=0.5,     # 0.5s / frame
        detail="detailed"
    )

    print("Tóm tắt:", result.summary)
    print("Mục đích:", result.purpose)
    print("Các mốc quan trọng:", result.key_moments)
    print("Lời thoại:", result.audio_summary)

if __name__ == "__main__":
    asyncio.run(main())
```

---

### Cách 3: Sử dụng như một MCP Server (Dành cho Claude Desktop, Cursor, Antigravity)
Trong thư mục đã có sẵn file `mcp-server.cjs`. Bạn chỉ cần thêm vào file cấu hình MCP của Cursor / Claude Desktop:

```json
{
  "mcpServers": {
    "video-analyzer": {
      "command": "node",
      "args": ["/duong/dan/tuyet/doi/toi/video-analyzer-standalone/mcp-server.cjs"],
      "env": {
        "VIDEO_ANALYZER_PLUGIN_ROOT": "/duong/dan/tuyet/doi/toi/video-analyzer-standalone",
        "VIDEO_ANALYZER_PYTHON": "/duong/dan/tuyet/doi/toi/video-analyzer-standalone/.venv/bin/python"
      }
    }
  }
}
```
Khi đó AI trong Cursor / Claude Desktop sẽ có ngay công cụ `analyze_video` để phân tích mọi video trên máy tính của bạn!

---

### Cách 4: Chạy tiến trình Worker nền (giao tiếp qua Stdio NDJSON)
Dành cho các ứng dụng backend (Node.js, Go, Rust, Java) muốn gọi phân tích video qua tiến trình con (child process):
```bash
python -m video_analyzer.worker
```
Worker sẽ gửi dòng JSON:
`{"type": "ready"}`
Bạn chỉ việc gửi lệnh phân tích dạng JSON qua `stdin`:
```json
{"type":"request","request_id":"req-01","action":"analyze_video","params":{"video_path":"sample.mp4","language":"auto","frame_interval":0.5}}
```
Và đọc kết quả trả về từ `stdout`.

---

## 📁 Cấu trúc thư mục gói standalone

```
video-analyzer-standalone/
├── analyze.py              # CLI runner tiện lợi, dễ dùng nhất
├── mcp-server.cjs          # MCP Server cho Claude / Cursor
├── pyproject.toml          # File cấu hình module Python
├── requirements.txt        # Danh sách thư viện cần cài đặt
├── .env.example            # File mẫu cấu hình biến môi trường
├── .env                    # File cấu hình hoạt động
├── README.md               # Tài liệu hướng dẫn sử dụng
├── prompts/                # Toàn bộ prompt thị giác & tổng hợp
│   ├── visual.txt
│   ├── subtitle.txt
│   └── final.txt
└── video_analyzer/         # Bộ lõi logic của pipeline
    ├── pipeline.py         # Bộ điều phối chính (Orchestrator)
    ├── worker.py           # Worker chạy nền qua stdio
    ├── config.py           # Quản lý cấu hình
    ├── schemas.py          # Data models (Pydantic)
    ├── audio/              # Trích xuất âm thanh & Whisper
    ├── vision/             # Trích xuất khung hình & gọi Vision Model
    ├── media/              # Bóc tách codec & metadata qua ffprobe
    ├── merge/              # Ghép timeline & synthesis
    ├── jobs/               # Quản lý cache & workspace
    └── utils/              # Tiện ích bổ trợ
```
