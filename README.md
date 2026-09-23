# HIGGSFIELD QUEUE PORTABLE — GTF Video AI Automation Platform

> **Tài liệu Bàn giao Kỹ thuật & Vận hành Hệ thống (Technical Handover & Operations Guide)**  
> **Phiên bản:** 2.0 (Cập nhật: 23/09/2026)  
> **Địa chỉ Dashboard Nội bộ:** [http://localhost:20140](http://localhost:20140)  
> **Cổng mặc định:** `HQ_PORT=20140`  
> **Trạng thái kiểm thử:** 526/526 Tests Passed (100% 4-Tier Test Suite)

---

## 📋 MỤC LỤC (Table of Contents)

1. [Tổng Quan Dự Án (Project Overview)](#1-tổng-quan-dự-án-project-overview)
2. [Kiến Trúc Hệ Thống (System Architecture)](#2-kiến-trúc-hệ-thống-system-architecture)
3. [Các Phân Hệ Chính (Core Subsystems)](#3-các-phân-hệ-chính-core-subsystems)
   - [3.1 Cổng Điều Hướng Gateway (`/`)](#31-cổng-điều-hướng-gateway-)
   - [3.2 Video-to-Video Studio (`/byteplus/video-to-video`) — TRỌNG TÂM](#32-video-to-video-studio-byteplusvideo-to-video--trọng-tâm)
   - [3.3 GTF Video AI Studio / Kie.ai (`/byteplus` hoặc `/0013`)](#33-gtf-video-ai-studio--kieai-byteplus-hoặc-0013)
   - [3.4 Higgsfield Classic V1 (`/higgsfield`) — LEGACY BẢO VỆ](#34-higgsfield-classic-v1-higgsfield--legacy-bảo-vệ)
   - [3.5 Google Flow Queue (`/byteplus/Flowqueue`)](#35-google-flow-queue-byteplusflowqueue)
4. [Môi Trường & Biến Cấu Hình (Environment & Config)](#4-môi-trường--biến-cấu-hình-environment--config)
5. [Hướng Dẫn Khởi Động & Vận Hành (Quick Start & Launchers)](#5-hướng-dẫn-khởi-động--vận-hành-quick-start--launchers)
6. [Cấu Trúc Thư Mục Dự Án (Project Structure)](#6-cấu-trúc-thư-mục-dự-án-project-structure)
7. [Dữ Liệu & Cơ Chế Lưu Trữ (Data Persistence & Storage)](#7-dữ-liệu--cơ-chế-lưu-trữ-data-persistence--storage)
8. [Quy Trình Kiểm Thử Tự Động (Testing Suite)](#8-quy-trình-kiểm-thử-tự-động-testing-suite)
9. [Lưu Ý Kỹ Thuật Quan Trọng Khi Bàn Giao (Technical Gotchas)](#9-lưu-ý-kỹ-thuật-quan-trọng-khi-bàn-giao-technical-gotchas)
10. [Tài Liệu Tham Khảo Liên Quan (Related Documentation)](#10-tài-liệu-tham-khảo-liên-quan-related-documentation)

---

## 1. TỔNG QUAN DỰ ÁN (Project Overview)

**HIGGSFIELD QUEUE PORTABLE** là nền tảng tự động hóa sản xuất video bán hàng ngắn (TikTok, Reels, Shorts) hàng loạt dành cho đội ngũ Media, Content và Marketing.

Hệ thống giải quyết 3 bài toán then chốt:
1. **Sản xuất video phái sinh từ đối thủ (Video-to-Video):** Phân tích video đối thủ viral, tự động bóc tách phân cảnh, chọn clip phù hợp trong kho nguyên liệu có sẵn, sinh kịch bản thuyết minh bám sát hành động khung hình (Footage-Driven) và render hàng loạt 10 video mới cùng lúc với phụ đề dồn chữ theo nhịp giọng đọc AI.
2. **Sinh video AI tạo sinh (Text/Image to Video):** Tích hợp nhà cung cấp Kie.ai (Bytedance Seedance 2.5 / 2.0 Mini / 2.0 Fast) với cơ chế xếp hàng tác vụ lăn song song, quản lý nhân vật KOL dùng lại và kế toán hạn mức chi phí.
3. **Duy trì luồng sản xuất cũ (Higgsfield Automation):** Tự động điều khiển trình duyệt Chrome qua CDP để sinh video trên higgsfield.ai mà không làm gián đoạn lịch sử 468 task của công ty.

---

## 2. KIẾN TRÚC HỆ THỐNG (System Architecture)

Hệ thống được thiết kế theo mô hình **Đa phân hệ độc lập (Multi-Subsystem)** chạy chung một tiến trình Node.js máy chủ qua cổng duy nhất `20140`:

```text
                                  NGƯỜI DÙNG / TRÌNH DUYỆT
                                             │
                                             ▼
                             http://localhost:20140 (Cổng LAN)
                                             │
                     ┌───────────────────────┴───────────────────────┐
                     ▼                                               ▼
              / (Gateway Portal)                             /huong-dan-nhan-vien
         Trang điều hướng chọn công cụ                    Sổ tay nhân viên (Non-Dev)
                     │
       ┌─────────────┼──────────────────────────────┬────────────────────────────┐
       ▼             ▼                              ▼                            ▼
  /higgsfield     /byteplus (hoặc /0013)  /byteplus/video-to-video      /byteplus/Flowqueue
  PHÂN HỆ V1      PHÂN HỆ V2 (AI STUDIO)   PHÂN HỆ V2V (VIDEO STUDIO)    PHÂN HỆ FLOWQ
Higgsfield.ai     Kie.ai Seedance 2.5      Footage-Driven Production      Google Flow Auto
 Chrome CDP 9333   Rolling Queue Provider   FFmpeg Render 10 Luồng        Chrome CDP 9334
Puppeteer 11 bước Thư viện KOL cục bộ      Whisper + Gemini 9Router      Playwright Driver
```

---

## 3. CÁC PHÂN HỆ CHÍNH (Core Subsystems)

### 3.1 Cổng Điều Hướng Gateway (`/`)
* **Tệp mã nguồn:** `public/gateway.html`
* **Mục đích:** Landing page cho nhân viên chọn phân hệ làm việc tương ứng (GTF Studio mới hoặc Higgsfield cũ). Tự động kiểm tra trạng thái live/mock của backend và hiển thị số lượng task đang hoạt động.

---

### 3.2 Video-to-Video Studio (`/byteplus/video-to-video`) — TRỌNG TÂM
* **Mục đích:** Tạo ra hàng loạt video thành phẩm hoàn chỉnh từ video đối thủ và kho clip sẵn có của công ty.
* **Pipeline sản xuất 6 bước chuẩn SRS:**
  1. **Bước 1 — Kho nguyên liệu (Local Media Library):**
     - Quét metadata, thời lượng, thumbnail của clip kho (`library.js`).
     - Phân loại rõ 3 nhóm: **Nguyên liệu** (Material), **Video đối thủ** (Reference), **Video Hook 3s** (Hook).
     - Phân tích tự động nội dung thị giác bằng 5 worker AI song song (`analyzer_bridge.js` + Python Gemini Vision/Whisper qua cổng 9Router `20128`).
  2. **Bước 2 — Tạo dự án (Project Setup):**
     - Đặt tên chiến dịch, cấu hình số lượng video muốn tạo (mặc định $N=10$).
     - Chọn hoặc kéo thả video đối thủ mẫu và video hook mở đầu.
  3. **Bước 3 — AI Phân tích đối thủ & Sinh kịch bản (Footage-Driven AI):**
     - Tự động bóc tách cấu trúc video đối thủ (Hook, Body, CTA).
     - Thuật toán `selectFootageSequence`: Ưu tiên chọn chuỗi clip nguyên liệu kho trước, sau đó AI mới viết lời bình bám sát hành động thị giác (`visualAction`).
     - Giới hạn ngân sách từ ngữ (Word Budget) vừa khít thời lượng phân cảnh (chuẩn 1–5 giây, tốc độ ~2 từ/giây).
     - Sinh ma trận 10 biến thể kịch bản đa góc tiếp cận (đa dạng đối tượng, nỗi đau, bối cảnh, CTA).
  4. **Bước 4 — Duyệt & Chỉnh sửa kịch bản (Production Timeline - Đợt J):**
     - **Tương tác 2 chiều:** Bấm vào bất kỳ thẻ kịch bản nào trong Ma trận biến thể (hoặc nhấn phím `Enter`/`Space`) sẽ nạp chi tiết kịch bản đó lên bảng sửa.
     - Cho phép đổi clip nguồn, mốc cắt giây (`sourceIn`/`sourceOut`), chữ phụ đề và lời thoại thuyết minh AI.
     - API `PUT /projects/:id/timeline` tự động ghi nhận chính xác vào biến thể mục tiêu (`batchTimelines[variantIndex]`), đảm bảo mọi chỉnh sửa của người dùng được giữ nguyên vẹn khi render.
  5. **Bước 5 — Dựng video tự động (FFmpeg Parallel Assembler):**
     - Dựng đồng thời tối đa 10 luồng video bằng FFmpeg (`assembler.js`).
     - Cơ chế kẹp thời lượng an toàn (`resolveEffectiveSegmentDuration`), đo chuẩn trên luồng video và nắn mốc chuyển cảnh `xfade`, triệt tiêu hoàn toàn lỗi đông cứng khung hình.
     - Dải che phụ đề đen mờ (drawbox 92%) che sạch 100% phụ đề tiếng Anh cũ trong footage.
     - Tạo giọng đọc AI tiếng Việt tự nhiên qua Edge TTS (Hoài My, Nam Minh) và phụ đề dồn chữ theo nhịp đọc (`buildWordRevealDrawtext`).
  6. **Bước 6 — Duyệt & Tải thành phẩm (Batch Gallery & Player):**
     - Xem trực tiếp từng video trên trình phát tích hợp (chống phát đè âm thanh).
     - Tải từng video hoặc bấm **"Tải trọn bộ video (ZIP)"** để đóng gói toàn bộ 10 video về máy tính chỉ với 1 click.

---

### 3.3 GTF Video AI Studio / Kie.ai (`/byteplus` hoặc `/0013`)
* **Mục đích:** Sinh video tạo sinh AI từ câu lệnh văn bản (Prompt) và ảnh/video tham chiếu.
* **Tích hợp Kie.ai (Bytedance Seedance):**
  - Hỗ trợ 3 mô hình: `bytedance/seedance-2-5` (480p/720p/1080p, 4-30s), `seedance-2-mini` và `seedance-2-fast`.
  - Quản lý nhân vật KOL cục bộ (`LocalKolAssetProvider`), nạp trực tiếp file gốc không cần LAS.
  - Tự động upload file tạm lên CDN Kie (TTL 24h) và tự refresh khi hết hạn (`KieFileStorageProvider`).
  - Hàng chờ tác vụ lăn song song (Rolling Concurrency Pool) tự động khôi phục sau sự cố khởi động lại server.
  - Sổ cái kế toán chi phí & hạn mức thời gian thực (`byteplus_usage.json`).

---

### 3.4 Higgsfield Classic V1 (`/higgsfield`) — LEGACY BẢO VỆ
* **Mục đích:** Tự động hóa tạo video trên nền tảng higgsfield.ai qua Chrome DevTools Protocol.
* **Cơ chế:** Puppeteer kết nối vào Chrome cổng `9333` qua profile định sẵn, mô phỏng 11 bước bấm click chuột tự động.
* **Lưu ý nguyên tắc:** **TUYỆT ĐỐI KHÔNG REFACTOR HOẶC SỬA ĐỔI LUỒNG V1** (`video_generate.js`, `queue_db.json`). Đây là hệ thống ổn định lâu năm của công ty.

---

### 3.5 Google Flow Queue (`/byteplus/Flowqueue`)
* **Mục đích:** Hàng chờ sinh video tự động từ Google Flow.
* **Cơ chế:** Điều khiển Chrome DevTools Protocol qua cổng `9334` (`MO_CHROME_GOOGLE_FLOW_9334.bat`), tự động xếp hàng và tải kết quả MP4 về thư mục `flow_outputs/`.

---

## 4. MÔI TRƯỜNG & BIẾN CẤU HÌNH (Environment & Config)

### Yêu Cầu Môi Trường (System Requirements)
* **Hệ điều hành:** Windows 10/11 64-bit.
* **Node.js:** `>= v20.0.0` (Đang chạy tối ưu trên `v24.18.0`).
* **FFmpeg / FFprobe:** Đã tích hợp sẵn trong PATH của hệ điều hành.
* **Python:** `>= 3.10` (phục vụ worker phân tích video Whisper + Gemini).
* **Google Chrome:** Dùng cho luồng CDP cổng 9333 và 9334.

### Danh Sách Cổng Mạng (Network Ports)

| Cổng (Port) | Dịch vụ tương ứng | Ghi chú quan trọng |
|---|---|---|
| **20140** | **Máy chủ Dashboard Web chính** (Node.js Express + Socket.IO) | Đọc từ biến `HQ_PORT`. **Không đọc `PORT`** để tránh xung đột với port 20129 cấp User. |
| **9333** | Chrome DevTools Protocol (CDP) cho Higgsfield V1 | Bật bằng `2_MO_CHROME_HIGGSFIELD.bat` hoặc `start-cdp.bat`. |
| **9334** | Chrome DevTools Protocol (CDP) cho Google Flow | Bật bằng `MO_CHROME_GOOGLE_FLOW_9334.bat`. |
| **20128** | 9Router AI Gateway | Cung cấp API LLM, Whisper Audio và Gemini Vision cho phân tích clip. |

### Các Biến Môi Trường Chính (`.env`)

```ini
# Cấu hình cổng máy chủ
HQ_PORT=20140
LOG_KEEP_DAYS=30

# Cấu hình nhà cung cấp AI Video V2
GTF_VIDEO_PROVIDER=kie
KIE_API_KEY=your_kie_api_key_here

# Cấu hình Gateway AI phân tích video (9Router)
NINE_ROUTER_API_KEY=your_9router_key
NINE_ROUTER_BASE_URL=http://localhost:20128/v1

# Thư mục chia sẻ lưu video thành phẩm (tùy chọn)
VIDEO_SAVE_DIR=./video_studio_outputs
```

---

## 5. HƯỚNG DẪN KHỞI ĐỘNG & VẬN HÀNH (Quick Start & Launchers)

### Cách 1: Vận Hành 1-Click (Dành cho Người Dùng & Nhân Viên)

Thư mục gốc đã chuẩn bị sẵn các kịch bản `.bat` tự động hóa:

1. **Khởi động toàn bộ hệ thống:**
   * Nhấp đúp chuột vào file: **`CHAY_TAT_CA_1_CLICK.bat`**
   * Hệ thống sẽ tự động bật các cửa sổ dịch vụ phụ trợ, bật server Node.js và tự động mở trình duyệt Chrome vào địa chỉ `http://localhost:20140`.
2. **Khởi động riêng từng dịch vụ khi cần:**
   * `1_CAI_DAT_BAN_DAU.bat`: Cài đặt thư viện dependencies khi setup máy mới.
   * `2_MO_CHROME_HIGGSFIELD.bat`: Bật Chrome CDP cổng 9333 cho Higgsfield.
   * `MO_CHROME_GOOGLE_FLOW_9334.bat`: Bật Chrome CDP cổng 9334 cho Google Flow.
   * `3_CHAY_DASHBOARD.bat`: Bật riêng server dashboard cổng 20140.
   * `MO_PORT_FIREWALL.bat`: Mở cổng tường lửa Windows để các máy khác trong mạng LAN truy cập.
   * `MO_CONG_INTERNET_TU_XA.bat`: Cấu hình mở cổng truy cập từ xa (Cloudflare Tunnel / ngrok).

### Cách 2: Vận Hành Thủ Công Bằng Dòng Lệnh (Dành cho Dev)

```bash
# 1. Cài đặt các gói phụ thuộc
npm install

# 2. Khởi chạy máy chủ Dashboard
npm start

# 3. Chạy toàn bộ bộ test kiểm thử chất lượng
npm test
```

---

## 6. CẤU TRÚC THƯ MỤC DỰ ÁN (Project Structure)

```text
HIGGSFIELD_QUEUE_PORTABLE/
├── server.js                      # Điểm vào chính của máy chủ Express & Socket.IO
├── package.json                   # Khai báo dependency và script lệnh npm
├── queue_db.json                  # Cơ sở dữ liệu 468 task của phân hệ V1 (Được bảo vệ)
│
├── byteplus/                      # Mã nguồn phân hệ V2 (Kie.ai & Video Studio)
│   ├── index.js                   # Khởi tạo subsystem V2 và Socket.IO /byteplus
│   ├── config.js                  # Quản lý cấu hình, an toàn bảo mật secret
│   ├── store.js                   # JsonStore ghi tệp nguyên tử (Atomic write)
│   ├── queue_manager.js           # Hàng đợi lăn song song và cơ chế phục hồi
│   ├── reference_manager.js       # Quản lý ảnh/video tham chiếu
│   ├── kol_library.js             # Quản lý thư viện nhân vật KOL
│   ├── providers/                 # Triển khai các API provider (Kie, ModelArk, OpenRouter)
│   │
│   ├── video_studio/              # Lõi pipeline Video-to-Video Studio (SRS)
│   │   ├── index.js               # Router REST API, FSM Engine, xử lý /timeline (Đợt J)
│   │   ├── library.js             # Quét thư viện clip kho, trích xuất metadata FFprobe
│   │   ├── analyzer_bridge.js     # Kết nối IPC NDJSON tới worker Python phân tích AI
│   │   ├── timeline_generator.js  # Thuật toán Footage-Driven, sinh kịch bản & ma trận
│   │   ├── assembler.js           # FFmpeg dựng song song 10 luồng, đồng bộ chữ, kẹp xfade
│   │   └── voice_generator.js     # Tạo giọng đọc Edge TTS tiếng Việt (Hoài My, Nam Minh)
│   │
│   └── google_flow/               # Lõi phân hệ Google Flow Queue qua Chrome CDP 9334
│       ├── runner.mjs             # Playwright điều khiển CDP
│       ├── queue.js               # Hàng chờ tác vụ Google Flow
│       └── index.js               # Router API /api/google-flow/*
│
├── public/                        # Toàn bộ giao diện người dùng Web (Frontend)
│   ├── gateway.html               # Cổng điều hướng phân hệ
│   ├── index.html, app.js         # Giao diện Higgsfield Classic V1
│   ├── huong-dan-nhan-vien.html   # Sổ tay hướng dẫn sử dụng cho nhân viên (Non-Dev)
│   └── studio/                    # Giao diện GTF Studio V2
│       ├── index.html, studio.js  # Giao diện AI Studio (Kie Seedance)
│       ├── video-to-video.html    # Giao diện 6 bước Video-to-Video Studio
│       ├── video-to-video.js      # Logic client, tương tác ma trận biến thể, timeline
│       ├── video-to-video.css     # Style hệ thống, tuân thủ Purple Ban
│       └── flow-queue.html        # Giao diện Google Flow Queue
│
├── video-analyzer-pipeline/       # Worker Python phân tích âm thanh & thị giác clip
│   └── video-analyzer-standalone/
│       ├── run_analyzer.py        # Worker Whisper (audio) + Gemini Vision (frames)
│       └── mcp-server.cjs         # Cầu nối MCP giao tiếp backend
│
├── tests/                         # Bộ kiểm thử tự động 4 Tier (526 tests)
│   ├── runner.js                  # Test runner tổng hợp
│   ├── pipeline_abc.test.js       # Test bộ pipeline V2V (Đợt A -> Đợt J)
│   ├── api_server.test.js         # Test tích hợp API server
│   └── kie_provider.test.js       # Test tích hợp Kie.ai provider
│
├── docs/                          # Tài liệu kỹ thuật chi tiết
│   ├── AI_RULES/
│   │   ├── HANDOFF.md             # Tài liệu snapshot lịch sử kiến trúc chuyên sâu
│   │   └── CRAWLER_POD_AGENT_RULES.md # Quy tắc kỹ thuật và tiêu chuẩn code
│   └── BACKUPS/                   # Bản sao lưu an toàn theo từng mốc task
│
├── HUONG_DAN_SU_DUNG_NHAN_VIEN.html # File HTML hướng dẫn nhân viên đặt ở thư mục gốc
└── README.md                      # Tài liệu này
```

---

## 7. DỮ LIỆU & CƠ CHẾ LƯU TRỮ (Data Persistence & Storage)

Hệ thống sử dụng mô hình **Lưu trữ Tệp Nguyên Tử (Atomic File Store)** thông qua `JsonStore`, ghi tạm qua file `.tmp` trước khi đổi tên thay thế file chính thức nhằm triệt tiêu hoàn toàn rủi ro hỏng dữ liệu khi mất điện hoặc tắt server đột ngột.

### Danh Sách Tệp Dữ Liệu:

| Tệp Dữ Liệu | Vai Trò & Nội Dung | Trạng Thái Git |
|---|---|---|
| `queue_db.json` | 468 task của Higgsfield Classic V1 | **Git-tracked** (Tuyệt đối không xoá) |
| `video_studio_library.json` | Chỉ mục metadata toàn bộ clip trong kho (mô tả AI tiếng Việt) | **Git-tracked** |
| `video_studio_projects.json` | Danh sách dự án V2V, kịch bản dựng, ma trận biến thể | **Git-tracked** |
| `byteplus_queue_db.json` | Danh sách task tạo video của AI Studio V2 | Gitignored |
| `byteplus_usage.json` | Sổ cái ghi nhận chi phí và mức tiêu thụ credit API | Gitignored |
| `byteplus_kol_library.json` | Thư viện nhân vật KOL | Gitignored |
| `flow_outputs/flow_queue_db.json` | Danh sách task tạo video của Google Flow | Gitignored |

### Thư Mục Xuất Bản Media:
* `video_studio_outputs/{projectId}/`: Chứa các video thành phẩm render từ Video-to-Video (`final.mp4`, `storyboard.html`, `production_timeline.json`).
* `byteplus_outputs/`: Chứa các video kết quả tải từ Kie.ai.
* `flow_outputs/outputs/`: Chứa video kết quả tải từ Google Flow.

---

## 8. QUY TRÌNH KIỂM THỬ TỰ ĐỘNG (Testing Suite)

Hệ thống áp dụng kiến trúc kiểm thử **4-Tier Test Framework** không phụ thuộc vào thư viện bên ngoài (zero-dependency runner):

```bash
npm test
```

### Kết Quả Kiểm Thử Hiện Tại (526/526 Tests PASS 100%):

```text
====================================================
         HIGGSFIELD TEST EXECUTION SUMMARY          
====================================================

4-Tier Breakdown:
  • Tier 1 (Đơn vị & Hợp đồng):          216/216 Passed (0 Failed)
  • Tier 2 (Tích hợp & Khả năng ghép):    200/200 Passed (0 Failed)
  • Tier 3 (UI, Tương tác & Khả năng chịu tải): 82/82 Passed (0 Failed)
  • Tier 4 (Phục hồi hệ thống E2E):         28/28 Passed (0 Failed)

Overall Metrics:
  • Total Tests:    526
  • Passed:         526
  • Failed:         0
  • Execution Time: ~13.5s
  ALL TESTS PASSED SUCCESSFULLY (100%)
```

---

## 9. LƯU Ý KỸ THUẬT QUAN TRỌNG KHI BÀN GIAO (Technical Gotchas)

Kỹ sư tiếp nhận hệ thống cần đặc biệt chú ý 5 điểm sống còn sau:

1. **Biến Môi Trường `PORT`:** Trên một số máy trạm Windows, biến `PORT=20129` có thể đã được cài đặt ở cấp độ User bởi phần mềm khác. **Luôn dùng `HQ_PORT` (mặc định 20140)**. Server đã được lập trình để bỏ qua biến `PORT` tránh tranh chấp cổng.
2. **Nguyên Tắc Bảo Vệ Phân Hệ Cũ (Legacy Safety):** Phân hệ V1 (`video_generate.js`, `public/app.js`, `queue_db.json`) đang phục vụ công việc hàng ngày của công ty. **Không được refactor hay thay đổi cấu trúc dữ liệu của V1.**
3. **Quy Tắc Render Video (Footage Clamp):** Khi render bằng FFmpeg, thời lượng clip phải luôn được kẹp an toàn bằng hàm `resolveEffectiveSegmentDuration`. Tuyệt đối không để cửa sổ cắt (`sourceOut - sourceIn`) dài hơn độ dài thực tế của file video, nếu không khung hình sẽ bị đứng (freeze) ở phân cảnh đó.
4. **Quy Tắc Màu Sắc Giao Diện (Purple Ban):** Thiết kế giao diện tuân thủ quy tắc Design System của dự án: Không sử dụng màu tím cố định (`#8A2BE2`, `#7b2cbf`, `violet`, `purple`) trong các thành phần mới. Hãy sử dụng hệ màu Semantic tokens (`var(--color-primary)`, slate, emerald, amber, blue).
5. **Chính Sách Sao Lưu (Backup Policy):** Khi thực hiện các thay đổi lớn về mã nguồn, luôn tạo bản sao lưu thư mục vào `docs/BACKUPS/YYYY-MM-DD/<task-name>/` trước khi chỉnh sửa.

---

## 10. TÀI LIỆU THAM KHẢO LIÊN QUAN (Related Documentation)

* 📖 **Sổ tay dành cho Nhân viên (Media & Marketing):**
  * Mở trên trình duyệt: [`http://localhost:20140/huong-dan-nhan-vien.html`](http://localhost:20140/huong-dan-nhan-vien.html)
  * Mở tệp offline: [`HUONG_DAN_SU_DUNG_NHAN_VIEN.html`](./HUONG_DAN_SU_DUNG_NHAN_VIEN.html)
* 📑 **Tài liệu Bàn giao Kỹ thuật Chi tiết cho AI / Dev:**
  * [`docs/AI_RULES/HANDOFF.md`](./docs/AI_RULES/HANDOFF.md)
* 📜 **Quy chuẩn Lập trình & Vận hành:**
  * [`docs/AI_RULES/CRAWLER_POD_AGENT_RULES.md`](./docs/AI_RULES/CRAWLER_POD_AGENT_RULES.md)
* 🌐 **Pull Request Đang Mở:**
  * [PR #6 trên GitHub (Mos-8124/HIGGSFIELD_QUEUE_PORTABLE)](https://github.com/Mos-8124/HIGGSFIELD_QUEUE_PORTABLE/pull/6)

---
*Tài liệu được biên soạn và chuẩn hóa phục vụ bàn giao dự án ngày 23/09/2026.*
