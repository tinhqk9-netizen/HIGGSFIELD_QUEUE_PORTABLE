# HANDOFF — HIGGSFIELD QUEUE PORTABLE

> Tài liệu trạng thái dự án dành cho AI Agent, theo `CRAWLER_POD_AGENT_RULES.md` §34.
> Đây không phải log dump. Chỉ giữ thông tin để agent sau tiếp tục đúng trạng thái.

---

# 0. PROJECT CONFIGURATION

```text
PROJECT_ROOT         = D:\Tinh\Work\HIGGSFIELD_QUEUE_PORTABLE
RULES_ROOT           = D:\Tinh\Work\HIGGSFIELD_QUEUE_PORTABLE\docs\AI_RULES
BACKUP_ROOT          = D:\Tinh\Work\HIGGSFIELD_QUEUE_PORTABLE\docs\BACKUPS
RUNTIME_URL          = http://localhost:20140
CANONICAL_HANDOFF    = D:\Tinh\Work\HIGGSFIELD_QUEUE_PORTABLE\docs\AI_RULES\HANDOFF.md
PRIMARY_TEST_COMMAND = npm test
START_COMMAND        = npm start
```

**Chính sách rollback:** backup filesystem vào `BACKUP_ROOT/YYYY-MM-DD/<task-id>/`, giữ
relative path. Git là cơ chế phụ, không thay thế backup.

**Cổng:** dự án đọc biến `HQ_PORT`, mặc định `20140`. **Không** đọc biến `PORT`
chung — trên máy hiện tại `PORT=20129` được đặt ở cấp User cho một tool khác và
sẽ chiếm mất cổng của dashboard nếu server đọc nó.

---

# 1. PROJECT OBJECTIVE

Dashboard hàng chờ nội bộ (LAN) để một team media sản xuất video AI hàng loạt.
Người dùng nhập prompt + ảnh/video tham chiếu, hệ thống xếp hàng và tự sinh video,
rồi tải MP4 về thư mục chia sẻ.

Hiện có **hai hệ thống độc lập** chạy chung một server, chung một cổng:

```text
                    http://localhost:20140
                              │
                ┌─────────────┴─────────────┐
                ▼                           ▼
        /higgsfield               /deeplove (alias /byteplus)
   HIGGSFIELD CLASSIC (V1)         GTF VIDEO AI STUDIO (V2)
   production, đang dùng           active Kie luồng mới
```

`/` là gateway cho người dùng chọn hệ thống.

---

# 2. CURRENT ARCHITECTURE

## 2.1 Entry point

`server.js` (Express + Socket.IO). Đây là **shared component** duy nhất mà cả hai
hệ thống cùng chạm. Thứ tự middleware quan trọng:

```text
cors → express.json → express.urlencoded
    → /api/byteplus router (V2)
    → gateway routes  /  /higgsfield  /deeplove  /Deeplove  /byteplus
    → express.static(public, { index:false })   ← index:false là bắt buộc
    → multipart middleware của V1
    → toàn bộ route của V1
```

`index:false` giữ cho `express.static` không chiếm mất `/` bằng `public/index.html`.

## 2.2 V1 — Higgsfield Classic (LEGACY, PROTECTED)

| Thành phần | File | Cách chạy |
|---|---|---|
| Pipeline CDP | `video_generate.js` (1.882 dòng) | Puppeteer nối Chrome cổng 9333, bấm 11 bước trên UI higgsfield.ai |
| Chế độ credit | `cli_generate.js` | spawn `higgsfield` CLI, tối đa 20 job song song |
| Vòng lặp queue | `server.js` `processQueueLoop()` | tuần tự, 1 task/lần |
| DB | `queue_db.json` | 468 task |
| UI | `public/index.html`, `app.js`, `styles.css` | dark theme |
| Socket | namespace mặc định `/` | |

**Không refactor V1.** Xem §8 của rule (legacy/stable flow protection).

## 2.3 V2 — GTF Video AI Studio & Video to Video Studio

```text
byteplus/
├── index.js               lắp ráp + Socket.IO namespace /byteplus
├── config.js              §0 config, providerStatus() không lộ secret
├── store.js               JsonStore ghi nguyên tử, safeSegment/safeJoin
├── queue_manager.js       rolling concurrency, recovery
├── task_factory.js        schema task + validation
├── reference_manager.js   chuẩn hoá tham chiếu, bí danh @Image/@Video
├── kol_library.js         CRUD KOL
├── routes.js              /api/byteplus/*
├── multipart.js           parser upload riêng
├── providers/  storage/  assets/    mock + stub provider thật
├── fixtures/mock_output.mp4          4s 480x854 H.264+AAC, 40KB
├── google_flow/           Flowq — Google Flow qua Chrome CDP 9334 (luồng copy từ Canvas-AI)
│   ├── runner.mjs         Playwright connectOverCDP — copy NGUYÊN VĂN Canvas-AI (1 chuỗi message khác)
│   ├── queue.js           hàng chờ tuần tự 1 job/lần, JsonStore flow_outputs/flow_queue_db.json, §17
│   └── index.js           Router /api/google-flow/* (status/jobs/media/worker/settings/files)
└── video_studio/          GTF Video Studio (Video to Video §3-§14)
    ├── index.js           Router + Store + FSM transitions + package export + streaming
    ├── library.js         ffprobe metadata scanner, thumbnail generator
    ├── analyzer_bridge.js Bridge kết nối worker video-analyzer Python (NDJSON)
    ├── timeline_generator.js Sinh Production Timeline + voice qua 9Router LLM
    ├── assembler.js       FFmpeg cắt ghép clip kho, audio ducking, text overlay
    └── voice_generator.js Edge TTS giọng đọc tiếng Việt (Hoài My, Nam Minh)

video-analyzer-pipeline/video-analyzer-standalone/
└── Pipeline phân tích video độc lập: Whisper audio transcription + Gemini Vision trích xuất khung hình và phân tích hành động chi tiết theo giây qua 9Router (port 20128)
```

UI: `public/gateway.html`, `public/studio/{index.html,studio.css,studio.js}`, `public/studio/{video-to-video.html,video-to-video.css,video-to-video.js}`, `public/studio/{flow-queue.html,flow-queue.css,flow-queue.js}`


---

# 3. RUNTIME / ENVIRONMENT

```text
Node             v24.18.0  (fetch/FormData/Blob/AbortController có sẵn ở global)
npm              11.16.0
OS               Windows 11
Runtime URL      http://localhost:20140
Chrome CDP       http://127.0.0.1:9333   (chỉ V1 cần; mở bằng start-cdp.bat)
Chrome CDP Flowq http://127.0.0.1:9334   (Flowq; mở bằng MO_CHROME_GOOGLE_FLOW_9334.bat, profile %LOCALAPPDATA%\GTF\GoogleFlowChrome)
Higgsfield CLI   CHƯA CÀI trên máy này   (chỉ ảnh hưởng chế độ credit của V1)
```

**Cảnh báo môi trường:** biến `PORT=20129` tồn tại ở cấp User Windows, thuộc về
một tool khác của người dùng. Dự án cố tình **không** đọc biến này. Nếu thấy
dashboard bind nhầm 20129 thì đó là tiến trình cũ chạy code trước 2026-09-07.

Hai cảnh báo dưới đây là **bình thường** trên máy chưa cài Chrome CDP và CLI,
không phải lỗi ứng dụng:

```text
📡 Connected to Chrome CDP ...      ← in lạc quan lúc boot, huy hiệu UI mới là thật
⚠️ Higgsfield CLI không sẵn sàng     ← chỉ tắt chế độ credit của V1
```

---

# 4. CURRENT FUNCTIONAL STATUS

| Hệ thống | Trạng thái |
|---|---|
| V1 Higgsfield CDP | Đang dùng production. Không thay đổi trong các phiên gần đây. |
| V1 CLI credit mode | Không chạy được trên máy này (thiếu CLI). |
| V2 Mock E2E | **COMPLETED** — RUNTIME CONFIRMED |
| V2 Kie.ai (Seedance 2.5 / 2.0 Mini / 2.0 Fast) | **ACTIVE — 3 MODEL** — chung 1 `KIE_API_KEY`. Model chọn per-task, UI gửi đúng model id lên Kie (`bytedance/seedance-2-5` / `-2-mini` / `-2-fast`). Giá per-model theo bảng chuẩn Kie (2.5: 480/720/1080p 4-30s; Mini & Fast: 480/720p 4-15s). KieFileStorageProvider + LocalKolAssetProvider + Live Pricing & Usage Ledger. Chờ user điền `KIE_API_KEY` |
| V2 OpenRouter (Seedance 2.5) | **INACTIVE FALLBACK** — code giữ nguyên, không nằm trong luồng active |
| V2 BytePlus ModelArk (Seedance 1.5 Pro) | **INACTIVE FALLBACK** — code giữ nguyên, không nằm trong luồng active |
| V2 BytePlus TOS | **NOT USED khi provider=kie** — không được khởi tạo; chỉ dùng khi quay lại provider byteplus/openrouter |
| V2 LAS | **NOT USED** — KOL dùng file gốc cục bộ qua LocalKolAssetProvider, không cần LAS |
| Flowq — Google Flow Queue (Chrome CDP 9334) | **LIVE GENERATION CONFIRMED — E2E PASS** (domain mới `flow.google.com`, Omni 1.1 Flash 4s 720p 3.1 MB lưu đĩa thành công `flow_mu12j1bm_25d01d`, xem/tải trên UI, npm test 194/194, đóng risk §12.9-10). Trang `/byteplus/Flowqueue` + button 🎬 FLOWQ cạnh badge LAN. |

---

# 5. CURRENT DATA / PERSISTENCE STATUS

| File | Nội dung | Ghi chú |
|---|---|---|
| `queue_db.json` | 468 task V1 (453 completed / 4 failed / 11 pending) | **4,3 MB**, git-tracked, KHÔNG được migrate |
| `byteplus_queue_db.json` | task V2 | gitignored, ghi nguyên tử |
| `byteplus_usage.json` | bản ghi usage accounting 13 trường | gitignored, ghi nguyên tử |
| `byteplus_kol_library.json` | thư viện KOL | gitignored |
| `byteplus_mock_jobs.json` | registry job mock, cần cho resume sau restart | gitignored |
| `byteplus_outputs/` | `{creator}/{taskName}/{taskId}.mp4` | gitignored |
| `byteplus_uploads/` | file tham chiếu V2 | gitignored, tách khỏi `uploads/` của V1 |
| `video_studio_store.json` | metadata thư viện video kho local & danh sách project GTF | gitignored, ghi nguyên tử |
| `video_studio_thumbs/` | cache ảnh thumbnail sinh từ ffmpeg cho từng clip kho | gitignored |
| `video_studio_outputs/` | thư mục xuất bản thành phẩm video `{projectId}/final.mp4`, `storyboard.html`, `episode_manifest.json`, `production_timeline.json` | gitignored |
| `video-analyzer-pipeline/.../data/jobs/` | dữ liệu trung gian của video analyzer worker (frames, audio, analysis JSON) | gitignored |
| `flow_outputs/` | Flowq: `flow_queue_db.json` (jobs/media/settings) + `uploads/` (ảnh khung hình) + `outputs/<jobId>/` (video/ảnh Flow trả về) | gitignored, ghi nguyên tử |

Hai hệ thống **không dùng chung state nào**.

---

# 6. IMPORTANT ARCHITECTURE DECISIONS

1. **V2 là hệ thống song song, không phải bản thay thế V1.** Lý do bắt buộc:
   BytePlus **chặn ảnh/video tham chiếu chứa mặt người thật**. Workload thật của
   team hiện là UGC người thật, nên V2 không phủ được nghiệp vụ của V1.
   Lối thoát chính thức của BytePlus: digital character library, trusted model
   outputs (30 ngày), hoặc kho ảnh người thật đã cấp quyền.

2. **Cổng đọc từ `HQ_PORT`, không đọc `PORT`.** Tên `PORT` quá chung, bị tool khác
   trên cùng máy chiếm. Đây là thay đổi shared component có chủ đích (§7).

3. **Video tham chiếu phải là URL công khai.** API BytePlus nhận base64 cho ảnh
   nhưng `content.video_url.url` chỉ nhận URL hoặc `asset://`. Kiến trúc đã sẵn
   các trường `storageProvider / remoteObjectKey / remoteUrl / expiresAt` để
   transport thật cắm vào mà không đổi schema.

4. **Bí danh tham chiếu tính lại từ thứ tự hiển thị**, id tham chiếu bất biến.
   Kéo thả đổi chỗ không phá liên kết bên dưới.

5. **Đổi tên KOL chỉ đổi metadata hiển thị.** `assetId` không đổi, task lịch sử
   giữ bản sao tên tại thời điểm chạy nên không bị hỏng khi KOL bị đổi tên/xoá.

6. **Giao diện GTF Studio dùng theme dark CỐ ĐỊNH.** Không đọc `prefers-color-scheme`
   và không có công tắc sáng/tối: nhân viên dùng nhiều máy, giao diện phải giống
   nhau ở mọi nơi. Dùng system font stack, không phụ thuộc Google Fonts. Một accent
   duy nhất (#7567ef); xanh/đỏ/amber chỉ dùng theo nghĩa xong / lỗi / mock.

---

# 7. EXTERNAL PROVIDER DECISIONS

```text
GTF_VIDEO_PROVIDER = mock | kie | byteplus | openrouter (mặc định 'mock'; luồng active là 'kie')
BYTEPLUS_MODE      = mock | live     (tương thích ngược)

Seedance 2.5 (Kie.ai)       KieSeedanceProvider    +  KieFileStorageProvider      (REAL IMPLEMENTED — ACTIVE PATH)
KOL không cần LAS           LocalKolAssetProvider  —  file gốc cục bộ là nguồn sự thật
Seedance 2.5 (OpenRouter)   MockSeedanceProvider   ⇄  OpenRouterSeedanceProvider  (INACTIVE FALLBACK)
Seedance 1.5 Pro (ModelArk) MockSeedanceProvider   ⇄  BytePlusGenerationProvider  (INACTIVE FALLBACK)
TOS storage                 MockTosProvider        ⇄  BytePlusTosStorageProvider  (NOT USED khi provider=kie)
LAS asset library           MockLasAssetProvider   ⇄  LasAssetLibraryProvider     (NOT USED)
```

Thông số API Kie.ai (SOURCE CONFIRMED từ docs.kie.ai, 2026-09-09):

```text
POST  https://api.kie.ai/api/v1/jobs/createTask          body: { model: "bytedance/seedance-2-5", input: {...} }
GET   https://api.kie.ai/api/v1/jobs/recordInfo?taskId=  state: waiting|queuing|generating|success|fail
GET   https://api.kie.ai/api/v1/chat/credit              số dư credit (backend-only)
POST  https://kieai.redpandaai.co/api/file-stream-upload multipart: file, uploadPath, fileName
input: prompt, reference_image_urls[≤30], reference_video_urls[≤10], reference_audio_urls,
       duration 4-30, resolution 480p|720p|1080p, aspect_ratio, generate_audio, output_format
result: data.resultJson (CHUỖI JSON) -> {"resultUrls":["https://...mp4"]}
File upload là TẠM THỜI (TTL ~24h) — hệ thống lưu expiresAt, hết hạn tự upload lại từ file gốc.
Lỗi HTTP: 401 KIE_AUTH_FAILED · 402 KIE_INSUFFICIENT_CREDITS · 422 KIE_INVALID_REQUEST · 451 KIE_CONTENT_REJECTED
```

`OpenRouterSeedanceProvider` đã hoàn tất triển khai cho model **ByteDance Seedance 2.5** (`bytedance/seedance-2.5`).
`BytePlusGenerationProvider` đã hoàn tất triển khai cho model **ByteDance Seedance 1.5 Pro** (`seedance-1-5-pro-251215`).
Đã kiểm thử tự động 14 test case mock HTTP (100% không tốn credit, không gọi mạng).

Thông số API ModelArk Seedance 1.5 Pro (SOURCE CONFIRMED):

```text
POST  https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks
GET   https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks/{id}
Body: { "model": "<ENDPOINT_ID>", "content": [{ "type": "text", "text": "prompt --duration 4 --camerafixed false" }, { "type": "image_url", "image_url": { "url": "https://..." } }] }
model seedance-1-5-pro-251215 (gửi Endpoint ID ep-xxx)
durations: [4, 30] mặc định 4s, camerafixed: true/false (mặc định false)
```

**Các chốt bảo vệ an toàn (Safety Guards):**
1. Preflight chặn ngay trước khi gửi request nếu thiếu API Key (`BYTEPLUS_API_KEY_MISSING`) hoặc Endpoint ID (`BYTEPLUS_ENDPOINT_ID_MISSING`).
2. Seedance 1.5 Pro không hỗ trợ video tham chiếu: chặn ngay với `BYTEPLUS_SEEDANCE_1_5_VIDEO_REFERENCE_UNSUPPORTED`.
3. Ảnh tham chiếu bắt buộc là HTTPS URL công khai (chặn localhost, 127.0.0.1, LAN IP) với `BYTEPLUS_IMAGE_REQUIRES_ACCESSIBLE_URL`.
4. Khóa an toàn `ALLOW_LIVE_BYTEPLUS_TESTS=false`: chặn mọi request ra mạng thật trong quá trình kiểm thử tự động.
5. Chống sinh trùng (Duplicate Generation Protection): nếu task đã có `providerTaskId`, hệ thống chỉ gọi GET query/poll, tuyệt đối không gửi lại POST. Nếu sinh video xong mà download thất bại, task giữ nguyên `providerTaskId` và `outputUrl`, khi retry chỉ tải lại file mà không trừ tiền.

---

# 8. QUEUE / WORKER / CONCURRENCY DECISIONS

| | V1 Higgsfield | V2 GTF Studio |
|---|---|---|
| Điều phối | `processQueueLoop()` | `ByteplusQueueManager.dispatch()` |
| Song song | 1 (CDP) / 20 (CLI) | **10**, cấu hình qua `BYTEPLUS_MAX_CONCURRENCY` |
| Kiểu nạp | tuần tự | **cuốn chiếu** — slot trống nạp ngay |
| Chống vượt trần | — | chiếm slot **đồng bộ**, không có `await` giữa lúc kiểm tra và lúc đánh dấu running |

Ngữ nghĩa điều khiển V2 (§42):

```text
PAUSE   ngừng nạp task mới, job đang chạy VẪN hoàn tất
RESUME  lấp đầy slot trống ngay
STOP    ngừng nạp + huỷ job đang chạy, trả chúng về pending
RETRY   xoá lỗi, providerTaskId về null, đưa lại vào hàng chờ
```

**Chống submit trùng sau restart (§17)** — quan trọng nhất khi chuyển sang provider tính tiền:

```text
providerTaskId == null   →  an toàn trả về pending, chạy lại từ đầu
providerTaskId != null   →  KHÔNG BAO GIỜ submit lại, chỉ resume job cũ
```

`submitCount` trên task là bằng chứng kiểm chứng được. Mock provider tính tiến độ
từ mốc thời gian thật lưu trong registry nên job sống sót qua restart.

---

# 9. KNOWN ISSUES

1. **`queue_db.json` 4,3 MB ghi lại toàn bộ mỗi nhịp tiến độ** (`saveDB()` trong `broadcastState()`). Sẽ nặng dần. Thuộc V1, giữ nguyên.
2. **`HUONG_DAN_CAI_DAT_VA_SU_DUNG_MAY_MOI.docx`** vẫn ghi cổng cũ (file nhị phân).
3. **Higgsfield CLI chưa cài** trên máy hiện tại (chỉ ảnh hưởng chế độ credit của V1).
4. **`docker-compose.yml`** còn hardcode đường dẫn Windows của máy cũ.
5. **UI Settings & History chuyên biệt**: Lịch sử hiện đã tích hợp trực tiếp trong Bảng Hàng Chờ và tab Quản Lý Tín Dụng; màn hình Settings nâng cao có thể bổ sung nếu người dùng yêu cầu chỉnh sửa thông số API trực tiếp trên UI.

*(Các lỗi nghiêm trọng trước đây như: duration 422 NaN, nút sync-videos 404, mất nút Tải/Xem video, thiếu mục KOL trên UI, thiếu realtime progress % đều đã được giải quyết triệt để trong `task-deeplove-kol-fixes`).*

---

# 10. LATEST MEANINGFUL CHANGES

## 2026-09-15 — `task-inline-style-phase2` (MỚI NHẤT)

Phase 2: **gom inline-style → design token + utility class** (hết cảnh "mỗi trang một kiểu"). TDD, sub-agent sonnet implement, quản lý = phiên chính. Pilot video-to-video → nhân ra index/flow-queue. KHÔNG đụng V1.
- **Nguyên tắc an toàn:** chỉ ép **màu hardcode** + **block inline lặp** ra khỏi inline; **GIỮ** `display:none`/toggle (JS điều khiển qua `.style.display`, 60×) và giá trị động (`${...}`, width động). Mọi thay thế **giá trị y hệt** (pixel-faithful) — token/class copy đúng giá trị.
- **2a HTML pilot (video-to-video.html):** màu → `var(--token)` (khớp chính xác: #94a3b8=--text-secondary, #64748b=--text-muted, #ef4444=--color-danger; thêm --accent-sky, --overlay-soft/line/divider); block lặp → class (`.v2v-col-85`, `.v2v-filter-select`).
- **2b HTML rollout (index.html, flow-queue.html):** cùng cách; thêm ~26 token vào studio.css :root (giá trị exact) + class dùng chung (`.mb-0/.mb-8/.usage-th-pad/.usage-stat-card/...` ở studio.css; `.fq-hint-muted/.fq-hint-tight` ở flow-queue.css).
- **2c JS (video-to-video.js 36, studio.js 42, flow-queue.js 3):** màu literal trong `style="..."`/template → `var(--token)` (thêm 15 token exact); giữ nguyên `${}` động + logic ternary (chỉ swap chuỗi hex trong nhánh). **CÒN LẠI:** 3 chỗ `.style.cssText` trong video-to-video.js còn rgba (cơ chế DOM write, ngoài contract) — chưa tokenize.
- **RUNTIME VERIFIED:** npm test **246/246** (0 regression; +9 test consistency). 62 token trong studio.css; mọi `var(--token)` dùng trong JS đều có định nghĩa (không token chết). Browser thật cả 3 trang: icon hydrate hết (v2v 127, index 95, flow 65), computed-style khớp giá trị gốc, screenshot render y hệt, console 0 lỗi. Static asset live — không cần restart.
- Backup: `docs/BACKUPS/2026-09-15/task-inline-style-phase2a|2b|2c-js/`. Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-15/HANDOFF_SNAPSHOT_005.md`.

## 2026-09-15 — `task-emoji-svg-phase1`

Phase 1 (nối tiếp audit): thay **emoji-icon → SVG (Lucide)** qua runtime, TDD, sub-agent sonnet implement (quản lý = phiên chính). KHÔNG đụng V1.
- **Runtime mới `public/studio/icons.js`** (classic script): map `data-icon` → inline Lucide SVG (55 icon), hydrate lúc DOMContentLoaded + **MutationObserver** (tự thay icon cho cả nội dung JS render sau này), `window.GTFIcons`, try/catch không ném lỗi. SVG `width/height:1em` (thừa kế font-size), `stroke:currentColor`, `aria-hidden`.
- **1a — HTML tĩnh:** thay hết emoji-icon (41 glyph) trong video-to-video.html/index.html/flow-queue.html sang `<span data-icon>`; nạp `<script src="/studio/icons.js">`. Giữ nguyên class/text/layout.
- **1b — JS render + a11y:** icon do JS sinh (video-to-video.js/studio.js/flow-queue.js) → `data-icon` (MutationObserver hydrate). **Giữ nguyên emoji text trạng thái** trong toast/message (✓✕❌✅⚠🎉) — không phải icon. Vá a11y: bỏ `aria-hidden` khỏi 9 `<button>` icon-only, chuyển vào `<span data-icon aria-hidden>` bên trong + thêm `aria-label`. Sub-agent tránh XSS (không nhét innerHTML vào chỗ dựng từ dữ liệu user chưa escape).
- **RUNTIME VERIFIED:** npm test **237/237** (0 regression; +17 test mới: suite Icon System 1a/1b + a11y). Browser thật: **127/127 data-icon hydrate SVG** (48 tĩnh + 79 động), 0 unresolved, console 0 lỗi, render sạch. Static asset live không cần restart.
- Backup: `docs/BACKUPS/2026-09-15/task-emoji-svg-phase1a/` + `.../task-emoji-svg-phase1b/`. Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-15/HANDOFF_SNAPSHOT_004.md`.
- **CÒN LẠI (Phase 2, chưa làm):** gom inline-style → class/token (pilot video-to-video trước) — gốc rễ "mỗi trang một kiểu".

## 2026-09-15 — `task-ui-a11y-audit-fixes`

Cài skill **ui-ux-pro-max** + quét UI/UX + sửa 3 nhóm lỗi a11y theo TDD (quản lý = phiên chính, implement = sub-agent sonnet):
- **Cài skill:** `.claude/skills/` (7 skill: ui-ux-pro-max v2.13.0, design-system, design, ui-styling, brand, banner-design, slides) + `.claude-plugin/` (marketplace.json, plugin.json). Tool search chạy được: `python .claude/skills/ui-ux-pro-max/scripts/search.py "<q>" --domain <d>`. *(Session hiện tại chưa auto-list skill cho tới khi mở lại phiên / thêm marketplace.)*
- **Quét:** phát hiện style phần lớn INLINE (HTML `style=` + JS template, 0 `<style>` block) → mỗi trang một kiểu. Chấm theo bảng ưu tiên của skill.
- **TDD:** `tests/ui_a11y.test.js` (suite "UI/UX Accessibility Pass") + đăng ký `runner.js`. 10 test tĩnh (đọc CSS/HTML): T1 focus ring, T2 prefers-reduced-motion, T3 emoji aria-hidden. RED → GREEN.
- **Fix (chỉ V2, KHÔNG đụng V1):**
  - Focus ring nhìn thấy được (`box-shadow: 0 0 0 3px rgba(117,103,239,.35)`) thay `outline:none` ở `video-to-video.css` (4 chỗ) + `flow-queue.css` (1 chỗ).
  - `@media (prefers-reduced-motion: reduce)` thêm vào `studio.css` + `video-to-video.css` + `flow-queue.css`.
  - Emoji trang trí bọc `aria-hidden="true"` ở HTML tĩnh: video-to-video.html (36), index.html (37), flow-queue.html (16). *(Sub-agent gỡ 🔍 khỏi 2-3 placeholder ô tìm kiếm — không bọc aria-hidden trong attribute được; đúng hướng "no emoji as icons".)*
- **RUNTIME VERIFIED:** npm test **219/219** (0 regression, +10 test mới); static asset phục vụ live (không cần restart) — CSS có reduced-motion + focus ring, HTML aria-hidden=36.
- **CHƯA LÀM (cần quyết định thiết kế, flag — không gom mù):** emoji→SVG icon set trong JS (~41 chỗ), gom inline-style về class/token (refactor JS ~100k dòng), bump font <12px (rủi ro tràn chip), responsive breakpoint (tool desktop).
- Backup: `docs/BACKUPS/2026-09-15/task-ui-a11y-audit-fixes/` (6 file studio). Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-15/HANDOFF_SNAPSHOT_003.md`.

## 2026-09-15 — `task-prompt-v2-english-hook`

Tối ưu prompt v2 + giọng English + cho user chọn Hook (Video to Video):
- **Giọng English:** `voice_generator.js` thêm 5 giọng en-US/en-GB (Aria/Guy/Jenny/Eric/Sonia), mặc định `en-US-AriaNeural`; giữ 2 giọng vi-VN làm phụ. HTML voice picker gộp `<optgroup>` English (default) + Tiếng Việt; 3 default fallback ở `video-to-video.js` đổi sang `en-US-AriaNeural`. **RUNTIME VERIFIED:** `GET /api/video-studio/voices` trả đủ 7 giọng (English trước).
- **Chọn Hook (backend+frontend):** thêm **HOOK TYPE MENU (19 loại) + Auto** — dropdown `#v2v-hook-type-select` render động cạnh nút sinh kịch bản (state `reference_analyzed` + regen). `doGenerateTimeline` POST `{hookType}` (kèm `Content-Type: application/json`). Route `/generate-timeline` đọc `req.body?.hookType||'auto'` -> `hookContext.hookType` -> `generateBatchTimelines`/`generateTimeline`. `hookDirective`: user chọn -> **USER-LOCKED** (segment 1 bám đúng hook); `auto` -> model **tự chọn hook phù hợp nhất theo angle/product/reference** (KHÔNG bơm "recently-used", chọn theo độ FIT).
- **Prompt v2** (`timeline_generator.js` systemPrompt): thêm **định nghĩa 8 framework**, **định nghĩa 19 hook**, **CTA MENU (7 loại)** + `directorNote.ctaStyle`, **OUTPUT CONTRACT có kiểu dữ liệu từng field** + **WORKED EXAMPLE JSON**. VARIATION MANDATE nêu rõ: chọn theo FIT chứ không né "recently used".
- **RUNTIME VERIFIED:** npm test **209/209** (0 regression); server restart (kill PID cũ, `node server.js`); `/byteplus/video-to-video` HTTP 200; bundle JS chứa `v2v-hook-type-select`; voices endpoint English live.
- Backup: `docs/BACKUPS/2026-09-15/task-prompt-v2-english-hook/`. Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-15/HANDOFF_SNAPSHOT_002.md`.

## 2026-09-15 — `task-optimize-timeline-prompt`

Tối ưu prompt sinh kịch bản (Video to Video) bằng quy trình đa agent:
- Research agent tổng hợp playbook kịch bản QC short-form -> `byteplus/video_studio/knowledge/ad_script_playbook.md` (8 framework, 19 hook, 12 angle, 42 nguồn).
- Viết lại `timeline_generator.js` systemPrompt sang TIẾNG ANH, bắt buộc output tiếng Anh, thêm chọn framework + hook menu + VARIATION MANDATE (giữ schema JSON + biến angle).
- Evaluator agent chấm: **APPROVE-WITH-CHANGES** (English 9, Variation 4, Anti-repeat 3) — đề xuất ép biến đổi bằng state/hash + menu CTA + siết schema (v2 chờ duyệt).
- Lưu ý: output English nhưng TTS đang vi-VN -> cần bổ sung giọng en-US nếu chạy live. Restart server để nạp prompt.
Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-15/HANDOFF_SNAPSHOT_001.md`. Backup: `docs/BACKUPS/2026-09-15/task-optimize-timeline-prompt/`.


## 2026-09-14 — `task-google-flow-queue`

Flowq — copy luồng Google Flow CDP từ Canvas-AI vào GTF, cổng CDP **9334** (né 9222 theo yêu cầu,
né 9333 của V1), trang mới `/byteplus/Flowqueue` + button 🎬 FLOWQ cạnh badge LAN của AI Studio.
- **Copy nguyên văn** `Canvas-AI/services/google-flow-runner.mjs` → `byteplus/google_flow/runner.mjs`
  (605 dòng, chỉ đổi 1 chuỗi message lỗi 9222→9334). Hàng chờ mới `queue.js`: **tuần tự 1 job/lần**
  (1 cửa sổ Chrome), persist `flow_outputs/flow_queue_db.json`; §17: job Flow KHÔNG có providerTaskId
  → sau restart job running bị đánh failed, KHÔNG tự chạy lại; worker chỉ nổ máy khi user bấm
  (submit/▶/retry) — chống tiêu quota Google ngoài ý muốn (§12). CDP bắt buộc loopback 127.0.0.1.
- API `/api/google-flow/*` (status probe CDP, jobs, upload media 2 bước, retry/delete, worker
  start/pause, settings workspaceUrl, static files); UI `public/studio/flow-queue.{html,css,js}`
  theme dark cố định; route `['/byteplus/Flowqueue','/byteplus/flowqueue']`; button `#flowq-pill`
  chèn additive trước badge LAN (§21). Chrome mở bằng `MO_CHROME_GOOGLE_FLOW_9334.bat`, profile riêng
  `%LOCALAPPDATA%\GTF\GoogleFlowChrome`. Dependency mới: `playwright-core`, `fflate`.
- **RUNTIME VERIFIED:** npm test **194/194** (+8 suite Google Flow, 0 regression); routes 200
  (Flowqueue + css/js + V1/V2 regression); CDP probe trả Chrome/152.0.7977.83, badge CDP xanh trên UI;
  button bấm điều hướng đúng; console 0 lỗi.
- **CHƯA SINH VIDEO THẬT (mock≠real §13):** chặn ở bước user đăng nhập Google trong profile mới
  (agent không được nhập credential hộ). PHÁT HIỆN RUNTIME: `labs.google/fx/vi/tools/flow` redirect
  → `flow.google.com/about` — Google đã chuyển domain so với thời Canvas-AI; sau login có thể phải
  nới `flowWorkspaceUrl()` + vá selector theo bằng chứng thật (risk §12.9-10, các bước còn lại ở
  snapshot 006 mục 6).
- Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-14/HANDOFF_SNAPSHOT_006.md`.
  Backup: `docs/BACKUPS/2026-09-14/task-google-flow-queue/` (.env KHÔNG backup theo §14 — thay đổi
  chỉ là append 2 khóa GOOGLE_FLOW_*, revert = xóa block đó).

## 2026-09-14 — `task-v2v-step1-hook-preview + task-analyzer-ffmpeg-nostdin`

Bước 1 hiện đủ 2 video input + vá bug chặn của analyzer + E2E LIVE 6/6 bước với video thật của user.
- **UI bước 1:** panel `#v2v-input-panel` thành lưới 2 cột — `🎯 Video đối thủ` (giữ ID cũ
  `#v2v-input-player`) và `🎣 Video Hook câu view` (`#v2v-input-hook-slot`), kèm tên file thật;
  cột hook **ẩn hẳn** khi dự án không có hook. Backend thêm route `GET /projects/:id/hook-video`
  (206 Range) — trước đây không có nguồn nào phát được video hook.
- **BUG FIX (root cause confirmed, BLOCKING):** `video-analyzer-pipeline/.../media/frames.py`
  gọi `create_subprocess_exec` không đặt `stdin`, nên **ffmpeg kế thừa stdin của Python worker —
  chính là pipe NDJSON từ Node, không bao giờ đóng**. ffmpeg trích xong 69 frame trong 3 giây vẫn
  nằm chờ đọc stdin nên không thoát → `communicate()` treo vĩnh viễn → `analyze-hook` chết ở
  timeout 600s (tái hiện 2/2 lần). Vá: thêm `-nostdin` + `stdin=DEVNULL`.
  Sau vá: **62 giây** thay vì treo 600s.
- **E2E LIVE PASS 6/6** (`gtf_mu0x7s5q_1abe89`, doithu.mp4 27.8s + hook.mp4 34.7s):
  create → analyze-reference (3.2s, worker Cache HIT) → analyze-hook (62s) → generate-timeline
  (22.8s, **6 segment / 6 clip kho khác nhau**, đạt luật diversity) → review approve → validate
  (19.8s) → assemble (25.7s, FFmpeg + Edge TTS Hoài My) → final-review → `final_approved`.
  Output: `final.mp4` 5.0 MB · 19.80s · 1920x1080 h264+aac, **audio thật** (mean −19.2 dB),
  đủ `production_timeline.json` / `episode_manifest.json` / `storyboard.html`, ZIP 200 (5.017.722 byte).
- npm test **186/186 PASS**. Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-14/HANDOFF_SNAPSHOT_005.md`.
  Backup: `docs/BACKUPS/2026-09-14/{task-v2v-step1-hook-preview,task-analyzer-ffmpeg-nostdin}/`.

## 2026-09-14 — `task-v2v-dropzone-video-preview`

Form tạo dự án Video to Video: 2 ô dropzone giờ **hiển thị preview video thật** thay vì chỉ hiện tên file,
để user tự kiểm chứng mình chọn đúng clip trước khi bấm "Tạo project".
- Mỗi dropzone thêm `<video controls muted playsinline>` (`object-fit: contain`, cao 140px, nền đen —
  video dọc hiện trọn khung), dòng thông số `thời lượng · độ phân giải · dung lượng`, và nút `✕` gỡ video.
- `updateDropzoneState()` nâng từ scope `DOMContentLoaded` lên scope IIFE để `createProject()` dùng chung
  một đường dọn dẹp; bản mới **`URL.revokeObjectURL()`** object URL cũ mỗi lần đổi/gỡ file (bản cũ trong
  `createProject()` bỏ sót việc này vì chưa có preview). Tái dùng helper sẵn có `fmtDur()` / `fmtSize()`.
- Click vào `<video>` và nút `✕` không mở file picker nữa; click vùng còn lại vẫn mở như cũ để thay file.
- **Chỉ frontend**, giữ nguyên 100% ID/class cũ (§21); hợp đồng `FormData{name, refVideo, hookVideo}` không đổi.
- npm test **186/186 PASS** (không regression). Runtime verified trên cổng 20140 với 2 clip thật trong kho:
  preview blob hiện đúng, `refMeta="7s · 576×1024 · 865 KB"`, click video 0 lần mở picker, nút ✕ reset sạch,
  ô còn lại không bị ảnh hưởng, console 0 lỗi.
- Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-14/HANDOFF_SNAPSHOT_004.md`.
  Backup: `docs/BACKUPS/2026-09-14/task-v2v-dropzone-video-preview/`.

## 2026-09-14 — `task-v2v-e2e-test-fix + step1-input-ui`

Test end-to-end tool Video to Video với video đối thủ Hero.mp4 + vá 2 bug chặn + 2 sửa UI.
- **Bug fix (bug root cause confirmed, §36):** `byteplus/video_studio/timeline_generator.js` gọi 9Router sai:
  (1) model `gpt-4o-mini` KHÔNG tồn tại (404) → đổi sang `ag/gemini-3.8-flash-high` (override env `NINE_ROUTER_TIMELINE_MODEL`);
  (2) thiếu `stream:false` → 9Router trả SSE làm `response.json()` vỡ. Sau vá, bước Sinh kịch bản (§7) chạy được.
- **E2E LIVE PASS:** create project + Hero.mp4 → analyze-reference (Gemini+Whisper 21s) → generate-timeline (2 seg + voice VI)
  → review → validate → assemble (FFmpeg + Edge TTS 8.5s) → final-review → `final_approved`.
  Ra `final.mp4` 4.5s 1920x1080 h264+aac + gói (production_timeline.json, episode_manifest.json, storyboard.html).
- **UI (routing + frontend):** thêm route `GET /api/video-studio/projects/:id/reference-video` (206 stream);
  Step 1 "Video Input" giờ hiện video đối thủ user tải lên (panel `#v2v-input-panel`); bước 3 & 5 thêm nhãn "(AI xử lý)".
- npm test **186/186 PASS**. Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-14/HANDOFF_SNAPSHOT_002.md`.
  Backup: `docs/BACKUPS/2026-09-14/{task-fix-timeline-model,task-step1-input-video}/`.

## 2026-09-14 — `task-v2v-library-modal-and-auto-describe`

Hoàn thiện Giao diện Chi tiết Video Modal & Tự động Phân tích Mô tả AI (SRS §4):
- Gỡ bỏ hoàn toàn nút quét hàng loạt dư thừa trên thanh công cụ thư viện: *"🤖 AI Mô tả toàn bộ kho (§4)"*.
- Modal Giao diện Chi tiết Video: khi click vào thẻ clip hoặc nút *"🔍 AI Mô tả"*, mở popup modal chuyên dụng với video player phát trực tiếp qua HTTP 206 Partial Content Streaming, tóm tắt nội dung AI Summary, và Bảng chỉ mục mô tả chi tiết từng giây (Media Description Index theo SRS §4) có link click tua nhanh đến đúng phân cảnh.
- Hàng đợi phân tích nền tự động (`queueBackgroundDescribe`): tự động chạy nền phân tích Gemini Vision + Whisper cho các clip mới upload hoặc quét vào kho mà không làm đơ giao diện.
- Bảo toàn mô tả AI trong `scanLibrary()` khi quét lại thư mục kho.
- 186/186 tests PASS (100%). Visual verification chụp ảnh màn hình xác nhận UI sạch sẽ và modal hoạt động chuẩn xác.
- Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-14/HANDOFF_SNAPSHOT_001.md`.

## 2026-09-11 — `task-video-to-video-voice-tts-integration`

Tích hợp Kịch bản Lời thoại & Giọng đọc thuyết minh Edge TTS (SRS §7, §10, §11):
- Lên kịch bản lời thoại (AI Scripting): Prompt LLM trong `timeline_generator.js` tự động sinh thuộc tính `voice` (lời thoại tiếng Việt) kèm theo mỗi phân đoạn video trong Production Timeline.
- Sinh giọng đọc Edge TTS (Microsoft Neural Speech): module `byteplus/video_studio/voice_generator.js` tích hợp trực tiếp Python `edge-tts` với 2 giọng tiếng Việt chất lượng cao `vi-VN-HoaiMyNeural` (Nữ) và `vi-VN-NamMinhNeural` (Nam), hoàn toàn miễn phí, không tốn quota.
- Phối âm thanh & Dựng video FFmpeg: `assembler.js` tự động sinh âm thanh, trộn bằng `amix=inputs=2:duration=first`, áp dụng audio ducking (giảm âm nền video xuống 25%, giọng đọc 120%), tự động chèn silence (`anullsrc`) nếu clip gốc câm.
- Frontend: Thêm bộ chọn giọng đọc `🎙️ Giọng đọc:` và cột `Voice / Lời thoại AI` trong bảng kịch bản cho phép chỉnh sửa trực tiếp trước khi duyệt dựng.
- 186/186 tests PASS (100%).
- Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-11/HANDOFF_SNAPSHOT_005.md`.

## 2026-09-11 — `task-video-to-video-complete-pipeline`

Hoàn tất trọn bộ chu trình Video to Video Studio theo SRS v1.1 Draft (§3–§14):
- Chốt dứt điểm 2 quyết định treo:
  * (1) Model xem video = Gemini Vision + Whisper qua 9Router (`analyzer_bridge.js` nối Python worker).
  * (2) Dựng video = FFmpeg cắt ghép kho local + text overlay, không đẩy Kie.
- Backend modules: `analyzer_bridge.js` (phân tích video), `timeline_generator.js` (gọi 9Router LLM sinh timeline), `assembler.js` (FFmpeg trim, filter, concat), FSM transition engine `transitionProject` bảo đảm quy trình nghiêm ngặt theo SRS §14.
- Xuất bản trọn gói Package Export (§13): tự động sinh `final.mp4`, `storyboard.html`, `episode_manifest.json`, `production_timeline.json` tại `video_studio_outputs/<project_id>/`.
- Frontend UI: Workflow Stepper 6 bước, thanh hành động FSM động, bảng phân tích đối thủ, bảng timeline inline cho phép sửa từng segment, player duyệt video cuối và các nút tải package.
- 184/184 tests PASS (100%).
- Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-11/HANDOFF_SNAPSHOT_004.md`.

## 2026-09-11 — `task-video-to-video-tool`

Thêm tool độc lập **"Video to Video"** (GTF Video Studio Phase 1) NGAY trong HIGGSFIELD (Node), cùng cổng, path riêng `/studio/video-to-video.html` (chuyển đổi qua lại bằng nút AI STUDIO ↔ VIDEO TO VIDEO).
- Header studio: logo **AI STUDIO** thành nút + thêm nút **VIDEO TO VIDEO**, bấm chuyển qua lại 2 giao diện (giữ nguyên ID/selector cũ).
- Backend mới `byteplus/video_studio/` (độc lập luồng Kie): Local Media Library quét ffprobe + CRUD + stats (SRS §3), khung GTF Project + FSM §14, API `/api/video-studio/*`, state JSON riêng.
- UI mới `public/studio/video-to-video.{html,js,css}`: panel thư viện + project.
- npm test 181/181; live verify quét thư viện thật OK, studio cũ không regression.
- Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-11/HANDOFF_SNAPSHOT_003.md`. Backup: `docs/BACKUPS/2026-09-11/task-video-to-video-tool/`.


## 2026-09-11 — `task-kie-mini-replace-standard`

Sua lai 2 model them dung y nguoi dung: **Seedance 2.0 Mini** (`bytedance/seedance-2-mini`)
va **Seedance 2.0 Fast** (`bytedance/seedance-2-fast`) — thay cho ban standard 2.0 o snapshot truoc.
Gia CONFIRMED tu kie.ai: Mini 480p 2.4/3.8 · 720p 5.0/8.2 ; Fast 480p 6.8/11.7 · 720p 15/24.8.
Ca hai: duration 4-15s, chi 480p/720p, khong output_format. UI khoa 1080p + duration>15 cho 2 model nay.
End-to-end da chung minh: UI chon model nao -> POST createTask gui dung model id do.
npm test 173/173. Chi tiet: HANDOFF_SNAPSHOTS/2026-09-11/HANDOFF_SNAPSHOT_002.md.


## 2026-09-11 — `task-kie-multimodel-2.0`

Them 2 option model Seedance **2.0** va **2.0 Fast** vao luong Kie (dung chung KIE_API_KEY voi 2.5).
- Registry `byteplus/kie_models.js`: 2.5=`bytedance/seedance-2-5`, 2.0=`bytedance/seedance-2`,
  2.0 Fast=`bytedance/seedance-2-fast`; model chon per-task (task.model/kieModel).
- Gia theo TUNG model, cach tinh giong 2.5 (chuan Kie). 2.5 & 2.0 Fast lay rate CONFIRMED tu kie.ai;
  2.0 standard quy doi tu USD/s (Kie khong co trang gia cong khai) — CAN XAC NHAN.
- 2.0/2.0 Fast: duration toi da 15s (clamp), bo output_format; 2.0 Fast chi 480p/720p (UI khoa 1080p).
- npm test 173/173 PASS; live verify cost doi dung theo model tren cong 20140.
Chi tiet: `HANDOFF_SNAPSHOTS/2026-09-11/HANDOFF_SNAPSHOT_001.md`. Backup: `docs/BACKUPS/2026-09-11/task-seedance-2.0-models/`.


## 2026-09-09 — `task-deeplove-fullscreen-concurrency`

1. **Xử lý 8 lỗi tồn đọng hệ thống Deeplove V2**:
   - Khắc phục lỗi câm nín (silent failure) khi task fail (hiển thị thẻ lỗi đỏ `task-err-detail` chứa `task.error.message`).
   - Chuẩn hóa tên trường `task.pipelineStage` thay vì `task.currentStep`.
   - Bổ sung fallback cho `/tasks/bulk` qua `queue.bulkAdd()`.
   - Đọc động `currentTaskId` từ active tasks của queue thay vì gán cứng.
   - Hỗ trợ HTTP 206 Partial Content Streaming cho route video playback.
   - Dọn dẹp rò rỉ file tạm upload multipart khi request abort.
   - Phát log realtime qua Socket.io namespace `/byteplus`.
   - Cải tiến trực quan thẻ chi tiết lỗi và nút Retry.
2. **Nút Tiếp Tục hàng chờ (`▶️ Tiếp Tục` / Resume)**:
   - Thêm nút toggle resume hai chiều trên thẻ Bảng Điều Khiển Queue (`#btn-pause`). Khi tạm dừng, nút chuyển sang màu xanh dương `▶️ Tiếp Tục`.
3. **Dọn dẹp task test & reset dữ liệu tiêu hao**:
   - Dọn sạch 7 task test và reset `byteplus_usage.json` về trạng thái sạch sẽ.
4. **Sửa lỗi tràn ngang (overflow-x) & đưa về Full Màn Hình 100%**:
   - Khắc phục lỗi CSS Grid min-content contribution khiến `.main-layout` bị nở rộng tới 2090px-2246px.
   - Bổ sung `minmax(0, 1fr)` cho grid, `min-width: 0` cho các panel và card.
   - Đổi `.app-container` sang `width: 100%; max-width: 100%` dàn đều toàn bộ màn hình.
   - Mở rộng màn hình Terminal Logs ra toàn bộ chiều ngang card (`.monitor-grid` 1fr).
   - Tự động căn chỉnh 7 thẻ thống kê trên thanh Stats Bar.
   - Xác nhận 100% không còn thanh cuộn ngang trình duyệt trên mọi độ phân giải (1080p, 1600x900, 1440x900, 1366x768, 1280x800).
5. **Nâng Concurrency KIE AI lên 10 video cùng lúc**:
   - Cấu hình `KIE_MAX_CONCURRENCY=10` trong `.env` và `.env.example`.
   - Khởi động lại daemon server. Hệ thống tự động bốc tối đa 10 video gửi sang KIE xử lý song song.
6. **Kiểm thử & Backup**:
   - 164/164 tests PASS (0 live paid calls).
   - Backup: `docs/BACKUPS/2026-09-09/task-deeplove-fullscreen-concurrency/`.
   - Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-09/HANDOFF_SNAPSHOT_008.md`.

## 2026-09-09 — `task-deeplove-kol-fixes`

1. **Route Mapping Deeplove**:
   - Thêm mapping `app.get(['/deeplove', '/Deeplove', '/byteplus'], ...)` trong `server.js` phục vụ UI GTF Studio.
   - Cập nhật `public/gateway.html` trỏ tới `/deeplove` và làm sạch text BytePlus.
   - Giữ nguyên `/byteplus` làm bí danh fallback tương thích ngược.
2. **Sửa dứt điểm lỗi 🔴 Hỏng Thật (Duration 422 & Nút 404)**:
   - Sửa toàn bộ value của dropdown duration (`#duration`, `#bulk-duration`) thành số nguyên `4`–`30`, mặc định 16s.
   - Bổ sung phòng thủ trong `byteplus/task_factory.js`: tự động cắt đuôi `s` (`replace(/s$/i, '')`) chống triệt để `NaN`.
   - Gỡ bỏ hoàn toàn nút chết `#btn-sync-videos` (gọi route 404).
   - Dọn sạch payload V1 thừa (`unlimited`, `creditMode`, `cliModel`, `model`) và các request thăm dò `/api/cli/models`, `/api/cdp/status`.
3. **Tích hợp Nhân Vật KOL Ảo trên UI**:
   - Thêm khối "👤 Nhân Vật KOL Ảo" vào giữa mục Ảnh tham chiếu và Video tham chiếu (3 mục: Ảnh, KOL, Video).
   - Dropdown chọn KOL từ `byteplus_kol_library.json`, kèm nút "+ Tạo KOL Mới..." mở modal tạo nhanh.
   - Preview card hiển thị thumbnail, tên và prompt mô tả của KOL đang chọn.
   - Backend `byteplus/routes.js` nhận `kolId` và đính kèm tham chiếu KOL an toàn vào task.
4. **Khôi phục nút `▶️ Xem` và `⬇️ Tải` video**:
   - Cập nhật bộ render media trong `public/studio/studio.js`: đọc `task.outputWebPath || task.videoUrl || task.outputUrl`.
   - Gán `task.videoUrl = task.outputWebPath` trong `queue_manager.js` khi task completed.
   - Mọi video hoàn thành lập tức hiển thị đủ 2 nút `▶️ Xem` (mở modal phát video) và `⬇️ Tải` (tải file MP4).
5. **Tiến độ % Realtime**:
   - Lắng nghe sự kiện Socket.io `byteplus:task-updated` cập nhật trực tiếp tiến độ % và trạng thái từng hàng trong bảng.
   - Gỡ bỏ 4 listener V1 không còn hoạt động (`task_progress`, `live_preview`, `log`, `cdp_status`).
6. **Kiểm thử & Backup**:
   - 164/164 tests PASS (0 live paid calls). Headless Chrome verify 200 OK không lỗi console.
   - Backup: `docs/BACKUPS/2026-09-09/task-deeplove-kol-fixes/`.
   - Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-09/HANDOFF_SNAPSHOT_006.md`.

## 2026-09-09 — `task-usage-tab-fix-480p` & Audit Hệ Mới

1. **Fix UI tab Quản lý Tín dụng & 480p**:
   - Khắc phục lỗi inline style `display:none` đè lên CSS class `.tab-content.active` khiến UI bị trắng màn hình khi chuyển tab.
   - Bổ sung option `480p` vào dropdown resolution ở cả 2 form (Task Đơn Lẻ & Import Hàng Loạt), bảng giá tự tính đúng 28 cr/s.
2. **Audit Tàn Dư BytePlus**:
   - Phân loại tàn dư: Route/URL (`/byteplus`, `/api/byteplus/*`), Tên code (`byteplus/`, `ByteplusQueueManager`), File data (`byteplus_*.json`).
   - Xác nhận file `.env` đã được người dùng dọn sạch 100% biến `BYTEPLUS_*`.
3. **Audit Chức Năng Hệ Mới (Phát hiện lỗi & nợ kỹ thuật)**:
   - Phát hiện **Critical Blocker**: Form submit gửi chuỗi `"4s"` / `"5s"` / `""` khiến backend `Number("4s") = NaN` trả lỗi 422 cho mọi lượt submit từ UI.
   - Phát hiện route 404 cho nút "Đồng bộ video", thiếu listener realtime `byteplus:task-updated`, và các thành phần backend mồ côi (KOL Library, Settings, History).
4. Backup: `docs/BACKUPS/2026-09-09/task-usage-tab-fix-480p/`.
   Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-09/HANDOFF_SNAPSHOT_005.md`.

## 2026-09-09 — `task-studio-ui-cleanup-and-branding`

Dọn dẹp các thành phần không tương thích của hệ thống cũ và chuẩn hóa branding trên giao diện GTF Studio (`public/studio/`):

1. **Sửa lỗi load Assets**: Chuyển đường dẫn tương đối (`href="studio.css"`, `src="studio.js"`) sang tuyệt đối (`/studio/studio.css`, `/studio/studio.js`) để tương thích với route `/byteplus`.
2. **Dọn dẹp 7 thành phần UI dư thừa**:
   - Bỏ stream player CDP Chrome (`.preview-box`), chuyển layout monitor sang 1fr để log terminal mở rộng 100%.
   - Bỏ tab log CLI Cloud (`#tab-log-cli`) và container log CLI (`#cli-logs-container`).
   - Ẩn button đồng bộ link video (`#btn-sync-videos`).
   - Bỏ hàng toggle Unlimited Mode (`#unlimited-row`).
   - Bỏ khối cấu hình credit CLI ở single form (`#single-form/div[8]`) và bulk tab (`#bulk-tab/div[4]`).
   - Bỏ option `Higgsfield Standard` khỏi dropdown `#model` và `#bulk-model`, chỉ giữ `Seedance 2.5`.
3. **Đổi tên Logo & Ẩn CDP Status**:
   - Đổi tiêu đề logo `<h1>` và thẻ `<title>` thành **GTF Video AI Studio**.
   - Ẩn huy hiệu kiểm tra CDP host (`#cdp-status`) bằng inline style để không ảnh hưởng Socket/DOM cache.
4. **Bảo vệ hệ thống cũ**: 100% file hệ thống cũ (`public/index.html`, `public/styles.css`, `public/app.js`) được giữ nguyên vẹn.
5. Backup: `docs/BACKUPS/2026-09-09/task-studio-ui-cleanup-and-branding/`.
   Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-09/HANDOFF_SNAPSHOT_004.md`.

## 2026-09-09 — `task-kie-real-balance-usage`

Xóa bỏ hoàn toàn số dư demo 50.000 credits giả; tích hợp số dư Kie thật, bảng tính chi phí trực tiếp và sổ cái Usage Accounting:

1. **Số dư Kie thật**: Đọc trực tiếp từ `GET https://api.kie.ai/api/v1/chat/credit` thông qua backend proxy (`GET /api/byteplus/account/credits`) với `KIE_API_KEY`. Không để lộ API key ra frontend.
2. **Live Cost Estimator (8 trường)**: Hiển thị thẻ ước tính chi phí trực tiếp cạnh nút Submit, tính toán theo công thức chuẩn của Kie Seedance 2.5 (480p: 28 cr/s hoặc 17 cr/s khi có video; 720p: 63 cr/s hoặc 38 cr/s; 1080p: 114 cr/s hoặc 68.5 cr/s; quy đổi USD: $0.005/credit).
3. **Usage Accounting (13 trường)**: Module `byteplus/usage_manager.js` ghi nhận lịch sử tiêu hao vào `byteplus_usage.json` với 13 trường dữ liệu. `actualCredits` lấy nghiêm ngặt từ `creditsConsumed` do Kie trả về (tuyệt đối không bịa số liệu).
4. **Kiểm thử**: Bổ sung `tests/kie_pricing.test.js` (8 tests) và `tests/usage_manager.test.js` (6 tests). Toàn bộ 164/164 tests PASS, 0 live paid call.
5. Backup: `docs/BACKUPS/2026-09-09/task-kie-real-balance-usage/`.
   Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-09/HANDOFF_SNAPSHOT_003.md`.

## 2026-09-09 — `task-kie-seedance-provider`

Chuyển luồng active của GTF V2 từ BytePlus/OpenRouter sang **Kie.ai Seedance 2.5**.
Người dùng chỉ cần điền `KIE_API_KEY` + đặt `GTF_VIDEO_PROVIDER=kie` rồi restart.

1. **File mới**: `byteplus/providers/kie_seedance_provider.js` (createTask/recordInfo/credit),
   `byteplus/providers/kie_file_provider.js` (Kie File Upload — URL tạm, expiry-aware),
   `byteplus/assets/local_kol_asset_provider.js` (KOL từ file gốc cục bộ, không LAS),
   `tests/kie.test.js` (29 tests mock HTTP, 0 live call).
2. **Sửa**: `config.js` (provider 'kie', khối config.kie, providerStatus có kie + byteplus "Not used"),
   `index.js` (chế độ kie KHÔNG khởi tạo ModelArk/TOS/LAS), `reference_manager.js`
   (lỗi storage theo provider, tái dùng URL tạm theo hạn, upload nguồn KOL cục bộ),
   `queue_manager.js` (truyền kolLibrary, lưu billing thật từ provider),
   `public/studio/studio.js` (Settings hiển thị Kie / TOS Not used / LAS Not used),
   `.env.example` + `.env` (append KIE_*, không ghi đè giá trị cũ).
3. **An toàn credit giữ nguyên**: providerTaskId chỉ poll không re-submit, retry download
   không sinh lại video, KIE_CONTENT_REJECTED không auto-retry, test env chặn cứng mạng thật.
4. **Kiểm thử**: 149/149 PASS (120 cũ + 29 Kie). Smoke boot cổng 20199 với duy nhất
   KIE_API_KEY (không có bất kỳ biến BytePlus nào): Settings trả provider=kie, byteplus all "Not used".
5. Backup: `docs/BACKUPS/2026-09-09/task-kie-seedance-provider/`.
   Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-09/HANDOFF_SNAPSHOT_001.md`.

> Tóm tắt. Lịch sử chi tiết từng phiên (User Request, Investigation, Problems,
> Decisions, Runtime Evidence) nằm ở `HANDOFF_SNAPSHOTS/`:
>
> | Ngày | Snapshot | Nội dung |
> |---|---|---|
> | 2026-09-06 | `2026-09-06/HANDOFF_SNAPSHOT_001.md` | Audit toàn dự án + nghiên cứu API BytePlus · Khởi động thử V1 · `task-gtf-v2-mock` |
> | 2026-09-07 | `2026-09-07/HANDOFF_SNAPSHOT_001.md` | Tiếp nhận bộ rule · `task-port-20130` · `task-handoff-init` · `task-studio-redesign` |
> | 2026-09-09 | `2026-09-09/HANDOFF_SNAPSHOT_001.md` | `task-kie-only-mode`: Chuyển sang Kie-only mode, Seedance 2.5 |
> | 2026-09-09 | `2026-09-09/HANDOFF_SNAPSHOT_002.md` | `task-retry-paid-protection`: Chống tính phí trùng khi retry |
> | 2026-09-09 | `2026-09-09/HANDOFF_SNAPSHOT_003.md` | `task-kie-real-balance-usage`: Lấy số dư Kie trực tiếp từ API |
> | 2026-09-09 | `2026-09-09/HANDOFF_SNAPSHOT_004.md` | `task-studio-ui-cleanup-and-branding`: Dọn UI cũ, chuẩn hóa Studio |
> | 2026-09-09 | `2026-09-09/HANDOFF_SNAPSHOT_005.md` | `task-usage-tab-fix-480p`: Fix tab Quản lý Tín dụng & thêm 480p |
> | 2026-09-09 | `2026-09-09/HANDOFF_SNAPSHOT_006.md` | `task-deeplove-kol-fixes`: Fix duration NaN, tích hợp KOL, xem/tải MP4 |
> | 2026-09-09 | `2026-09-09/HANDOFF_SNAPSHOT_007.md` | `task-usage-credit-per-task`: Hiển thị credit tiêu hao từng task |
> | 2026-09-09 | `2026-09-09/HANDOFF_SNAPSHOT_008.md` | `task-deeplove-fullscreen-concurrency`: 8 bugfixes, nút resume, full màn hình, KIE concurrency=10 |
> | 2026-09-11 | `2026-09-11/HANDOFF_SNAPSHOT_001.md` | `task-kie-multimodel-2.0`: Thêm Seedance 2.0 và 2.0 Fast vào Kie |
> | 2026-09-11 | `2026-09-11/HANDOFF_SNAPSHOT_002.md` | `task-kie-mini-replace-standard`: Chuẩn hóa Seedance 2.0 Mini & Fast |
> | 2026-09-11 | `2026-09-11/HANDOFF_SNAPSHOT_003.md` | `task-video-to-video-tool`: Khởi tạo tool Video to Video Phase 1 |
> | 2026-09-11 | `2026-09-11/HANDOFF_SNAPSHOT_004.md` | `task-video-to-video-complete-pipeline`: Hoàn thiện trọn bộ pipeline Video to Video (§3–§14) |
> | 2026-09-11 | `2026-09-11/HANDOFF_SNAPSHOT_005.md` | `task-video-to-video-voice-tts-integration`: Tích hợp kịch bản lời thoại & Edge TTS tiếng Việt |
> | 2026-09-14 | `2026-09-14/HANDOFF_SNAPSHOT_001.md` | `task-v2v-library-modal-and-auto-describe`: Gỡ nút thừa, Modal chi tiết clip, HTTP 206 streaming, auto describe nền |

## 2026-09-07 — `task-byteplus-real-provider`

Hiện thực hoá provider thật `BytePlusGenerationProvider` cho ByteDance Seedance 1.5 Pro (`seedance-1-5-pro-251215`) trên BytePlus ModelArk.

1. **Cấu hình & Bảo vệ**: Hỗ trợ `GTF_VIDEO_PROVIDER` (mock/byteplus), `BYTEPLUS_MODELARK_API_KEY`, `BYTEPLUS_ENDPOINT_ID`, `ALLOW_LIVE_BYTEPLUS_TESTS=false`. Settings UI hiển thị trạng thái đã cấu hình mà không làm lộ secret.
2. **Preflight Guards**: Chặn ngay lập tức trước khi gọi mạng nếu thiếu API key (`BYTEPLUS_API_KEY_MISSING`), thiếu Endpoint ID (`BYTEPLUS_ENDPOINT_ID_MISSING`), có video tham chiếu (`BYTEPLUS_SEEDANCE_1_5_VIDEO_REFERENCE_UNSUPPORTED`), ảnh local/nội bộ (`BYTEPLUS_IMAGE_REQUIRES_ACCESSIBLE_URL`), hoặc KOL chưa bật LAS (`BYTEPLUS_KOL_LAS_UNSUPPORTED`).
3. **Chuẩn hóa Prompt**: Bổ sung `--duration <sec>` và `--camerafixed false` không trùng lặp.
4. **Chống sinh trùng & Tiết kiệm chi phí**: Nếu task đã có `providerTaskId`, không bao giờ POST lại. Nếu sinh video xong mà download lỗi, task giữ nguyên `providerTaskId` và `outputUrl`, khi retry chỉ tải lại file MP4 mà không submit lại.
5. **Kiểm thử**: 14 test case mock HTTP bổ sung (Tests A-N), 100% không tốn credit, không gọi ra ngoài.

Backup: `docs/BACKUPS/2026-09-07/task-byteplus-real-provider/`

## 2026-09-07 — `task-port-20140`

Đổi cổng runtime 20130 → **20140**. Máy của người dùng đã có hai tool khác chiếm
20129 (Apify Collector / crawler-POD) và 20130.

56 chỗ trong 13 file: `server.js` (mặc định `HQ_PORT`), 4 script launcher,
`Dockerfile`, `docker-compose.yml`, `.env.example`, `tests/docker_config.test.js`,
3 file tài liệu, placeholder LAN trong `public/index.html`.
`HANDOFF.md` sửa có chọn lọc: 6 dòng mô tả trạng thái hiện tại đổi sang 20140,
giữ nguyên các dòng lịch sử nhắc tên `task-port-20130`.

Backup: `docs/BACKUPS/2026-09-07/task-port-20140/`

## 2026-09-07 — `task-studio-redesign`

Làm lại toàn bộ ngôn ngữ thị giác của GTF Studio và Gateway: theme dark cố định
(bỏ `prefers-color-scheme`), bỏ gradient, thang bo góc có phân cấp, thay emoji
bằng 20 inline SVG line icon, chân dung KOL 4:5, thumbnail tham chiếu 60px,
system font stack thay Google Fonts. Layout, 5 view và 60 element ID giữ nguyên.

Files: `public/studio/{studio.css,index.html,studio.js}`, `public/gateway.html`.
Backend, `server.js` và hệ Higgsfield cũ không bị chạm.

Backup: `docs/BACKUPS/2026-09-07/task-studio-redesign/`

## 2026-09-07 — `task-port-20130`

Đổi cổng runtime sang 20130 vì 20129 trùng với tool khác của người dùng.
Thay `process.env.PORT` bằng `process.env.HQ_PORT` để cấu hình thuộc về dự án,
không phụ thuộc biến môi trường của máy (§39).

Files: `server.js`, 4 script launcher, `Dockerfile`, `docker-compose.yml`,
`.env.example`, `tests/docker_config.test.js`, 3 file tài liệu, `public/index.html`.

Backup: `docs/BACKUPS/2026-09-07/task-port-20130/`

## 2026-09-06 — `task-gtf-v2-mock`

Xây toàn bộ hệ thống V2 song song với V1. ~3.560 dòng code mới.
`server.js` chỉ +27/−1 dòng; `video_generate.js`, `cli_generate.js`,
`public/app.js`, `queue_db.json`, `package.json` **không đụng tới**.
Không thêm dependency nào.

Hai lỗi thật phát hiện lúc test và đã sửa:

```text
1. safeSegment() không lọc dấu gạch ngược → lỗ path traversal trên Windows.
   Đã sửa + thêm test chặn.
2. Tool sửa file đổi server.js sang CRLF làm diff phình toàn bộ.
   Đã đưa về LF.
```

3. task-byteplus-live-fix (2026-09-07):
   - Sửa lỗi video tạo ra bị giống mockup do server chưa tự nạp .env lúc boot.
   - Thêm loadDotenv() tự động nạp .env trong byteplus/config.js (cô lập khi chạy test tự động).
   - BytePlus ModelArk hỗ trợ gọi trực tiếp model `seedance-1-5-pro-251215` mà không bắt buộc tạo Custom Endpoint ep-xxx.
   - Hỗ trợ tải ảnh cục bộ (Image-to-Video) tự chuyển thành Base64 Data URL cho BytePlus ModelArk.
   - Server đã restart và xác nhận live: mode="live", provider="byteplus", configured=true.
   - Backup: docs/BACKUPS/2026-09-07/task-byteplus-live-fix/

4. task-byteplus-tos-provider (2026-09-07):
   - Hiện thực hoá Real `BytePlusTosStorageProvider` (chuẩn TOS4-HMAC-SHA256) bằng native Node.js crypto (0 dependency).
   - Hỗ trợ upload private bucket, tạo Signed HTTPS URL có thời hạn cho ModelArk đọc.
   - Tái sử dụng object đã có và tự động làm mới Signed URL khi reboot/retry mà không upload lại.
   - ReferenceManager chặn task có ảnh/video cục bộ nếu TOS chưa cấu hình (BYTEPLUS_TOS_NOT_CONFIGURED), prompt-only vẫn hoạt động bình thường.
   - Thêm 13 tests mock bao phủ trọn vẹn yêu cầu A → P (103/103 tests PASS).
   - Settings API và UI hiển thị trạng thái TOS mà không làm lộ Access/Secret Key.
   - Backup: docs/BACKUPS/2026-09-07/task-byteplus-tos-provider/

5. task-openrouter-seedance-provider (2026-09-07):
   - Hiện thực hoá Real `OpenRouterSeedanceProvider` (Seedance 2.5 - bytedance/seedance-2.5) qua OpenRouter Video API (`POST /api/v1/videos`).
   - Cấu trúc 3 provider: `mock`, `byteplus`, `openrouter`; cấu hình chuyển đổi qua `GTF_VIDEO_PROVIDER`.
   - Kết hợp lưu trữ TOS: ảnh/video tham chiếu upload lên BytePlus TOS sinh Signed URL HTTPS và chuyển tiếp qua `input_references`.
   - Thêm 17 tests tự động mới trong `tests/openrouter.test.js`: 120/120 tests PASS (100%).
   - Cấu hình an toàn: `ALLOW_LIVE_OPENROUTER_TESTS=true` trong `.env` mở khóa gọi mạng thật trên server, chặn tuyệt đối trong test tự động.
   - Bổ sung phòng thủ trong `byteplus/task_factory.js`: tự động cắt đuôi `s` (`replace(/s$/i, '')`) chống triệt để `NaN`.
   - Gỡ bỏ hoàn toàn nút chết `#btn-sync-videos` (gọi route 404).
   - Dọn sạch payload V1 thừa (`unlimited`, `creditMode`, `cliModel`, `model`) và các request thăm dò `/api/cli/models`, `/api/cdp/status`.
3. **Tích hợp Nhân Vật KOL Ảo trên UI**:
   - Thêm khối "👤 Nhân Vật KOL Ảo" vào giữa mục Ảnh tham chiếu và Video tham chiếu (3 mục: Ảnh, KOL, Video).
   - Dropdown chọn KOL từ `byteplus_kol_library.json`, kèm nút "+ Tạo KOL Mới..." mở modal tạo nhanh.
   - Preview card hiển thị thumbnail, tên và prompt mô tả của KOL đang chọn.
   - Backend `byteplus/routes.js` nhận `kolId` và đính kèm tham chiếu KOL an toàn vào task.
4. **Khôi phục nút `▶️ Xem` và `⬇️ Tải` video**:
   - Cập nhật bộ render media trong `public/studio/studio.js`: đọc `task.outputWebPath || task.videoUrl || task.outputUrl`.
   - Gán `task.videoUrl = task.outputWebPath` trong `queue_manager.js` khi task completed.
   - Mọi video hoàn thành lập tức hiển thị đủ 2 nút `▶️ Xem` (mở modal phát video) và `⬇️ Tải` (tải file MP4).
5. **Tiến độ % Realtime**:
   - Lắng nghe sự kiện Socket.io `byteplus:task-updated` cập nhật trực tiếp tiến độ % và trạng thái từng hàng trong bảng.
   - Gỡ bỏ 4 listener V1 không còn hoạt động (`task_progress`, `live_preview`, `log`, `cdp_status`).
6. **Kiểm thử & Backup**:
   - 164/164 tests PASS (0 live paid calls). Headless Chrome verify 200 OK không lỗi console.
   - Backup: `docs/BACKUPS/2026-09-09/task-deeplove-kol-fixes/`.
   - Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-09/HANDOFF_SNAPSHOT_006.md`.

## 2026-09-09 — `task-usage-tab-fix-480p` & Audit Hệ Mới

1. **Fix UI tab Quản lý Tín dụng & 480p**:
   - Khắc phục lỗi inline style `display:none` đè lên CSS class `.tab-content.active` khiến UI bị trắng màn hình khi chuyển tab.
   - Bổ sung option `480p` vào dropdown resolution ở cả 2 form (Task Đơn Lẻ & Import Hàng Loạt), bảng giá tự tính đúng 28 cr/s.
2. **Audit Tàn Dư BytePlus**:
   - Phân loại tàn dư: Route/URL (`/byteplus`, `/api/byteplus/*`), Tên code (`byteplus/`, `ByteplusQueueManager`), File data (`byteplus_*.json`).
   - Xác nhận file `.env` đã được người dùng dọn sạch 100% biến `BYTEPLUS_*`.
3. **Audit Chức Năng Hệ Mới (Phát hiện lỗi & nợ kỹ thuật)**:
   - Phát hiện **Critical Blocker**: Form submit gửi chuỗi `"4s"` / `"5s"` / `""` khiến backend `Number("4s") = NaN` trả lỗi 422 cho mọi lượt submit từ UI.
   - Phát hiện route 404 cho nút "Đồng bộ video", thiếu listener realtime `byteplus:task-updated`, và các thành phần backend mồ côi (KOL Library, Settings, History).
4. Backup: `docs/BACKUPS/2026-09-09/task-usage-tab-fix-480p/`.
   Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-09/HANDOFF_SNAPSHOT_005.md`.

## 2026-09-09 — `task-studio-ui-cleanup-and-branding`

Dọn dẹp các thành phần không tương thích của hệ thống cũ và chuẩn hóa branding trên giao diện GTF Studio (`public/studio/`):

1. **Sửa lỗi load Assets**: Chuyển đường dẫn tương đối (`href="studio.css"`, `src="studio.js"`) sang tuyệt đối (`/studio/studio.css`, `/studio/studio.js`) để tương thích với route `/byteplus`.
2. **Dọn dẹp 7 thành phần UI dư thừa**:
   - Bỏ stream player CDP Chrome (`.preview-box`), chuyển layout monitor sang 1fr để log terminal mở rộng 100%.
   - Bỏ tab log CLI Cloud (`#tab-log-cli`) và container log CLI (`#cli-logs-container`).
   - Ẩn button đồng bộ link video (`#btn-sync-videos`).
   - Bỏ hàng toggle Unlimited Mode (`#unlimited-row`).
   - Bỏ khối cấu hình credit CLI ở single form (`#single-form/div[8]`) và bulk tab (`#bulk-tab/div[4]`).
   - Bỏ option `Higgsfield Standard` khỏi dropdown `#model` và `#bulk-model`, chỉ giữ `Seedance 2.5`.
3. **Đổi tên Logo & Ẩn CDP Status**:
   - Đổi tiêu đề logo `<h1>` và thẻ `<title>` thành **GTF Video AI Studio**.
   - Ẩn huy hiệu kiểm tra CDP host (`#cdp-status`) bằng inline style để không ảnh hưởng Socket/DOM cache.
4. **Bảo vệ hệ thống cũ**: 100% file hệ thống cũ (`public/index.html`, `public/styles.css`, `public/app.js`) được giữ nguyên vẹn.
5. Backup: `docs/BACKUPS/2026-09-09/task-studio-ui-cleanup-and-branding/`.
   Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-09/HANDOFF_SNAPSHOT_004.md`.

## 2026-09-09 — `task-kie-real-balance-usage`

Xóa bỏ hoàn toàn số dư demo 50.000 credits giả; tích hợp số dư Kie thật, bảng tính chi phí trực tiếp và sổ cái Usage Accounting:

1. **Số dư Kie thật**: Đọc trực tiếp từ `GET https://api.kie.ai/api/v1/chat/credit` thông qua backend proxy (`GET /api/byteplus/account/credits`) với `KIE_API_KEY`. Không để lộ API key ra frontend.
2. **Live Cost Estimator (8 trường)**: Hiển thị thẻ ước tính chi phí trực tiếp cạnh nút Submit, tính toán theo công thức chuẩn của Kie Seedance 2.5 (480p: 28 cr/s hoặc 17 cr/s khi có video; 720p: 63 cr/s hoặc 38 cr/s; 1080p: 114 cr/s hoặc 68.5 cr/s; quy đổi USD: $0.005/credit).
3. **Usage Accounting (13 trường)**: Module `byteplus/usage_manager.js` ghi nhận lịch sử tiêu hao vào `byteplus_usage.json` với 13 trường dữ liệu. `actualCredits` lấy nghiêm ngặt từ `creditsConsumed` do Kie trả về (tuyệt đối không bịa số liệu).
4. **Kiểm thử**: Bổ sung `tests/kie_pricing.test.js` (8 tests) và `tests/usage_manager.test.js` (6 tests). Toàn bộ 164/164 tests PASS, 0 live paid call.
5. Backup: `docs/BACKUPS/2026-09-09/task-kie-real-balance-usage/`.
   Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-09/HANDOFF_SNAPSHOT_003.md`.

## 2026-09-09 — `task-kie-seedance-provider`

Chuyển luồng active của GTF V2 từ BytePlus/OpenRouter sang **Kie.ai Seedance 2.5**.
Người dùng chỉ cần điền `KIE_API_KEY` + đặt `GTF_VIDEO_PROVIDER=kie` rồi restart.

1. **File mới**: `byteplus/providers/kie_seedance_provider.js` (createTask/recordInfo/credit),
   `byteplus/providers/kie_file_provider.js` (Kie File Upload — URL tạm, expiry-aware),
   `byteplus/assets/local_kol_asset_provider.js` (KOL từ file gốc cục bộ, không LAS),
   `tests/kie.test.js` (29 tests mock HTTP, 0 live call).
2. **Sửa**: `config.js` (provider 'kie', khối config.kie, providerStatus có kie + byteplus "Not used"),
   `index.js` (chế độ kie KHÔNG khởi tạo ModelArk/TOS/LAS), `reference_manager.js`
   (lỗi storage theo provider, tái dùng URL tạm theo hạn, upload nguồn KOL cục bộ),
   `queue_manager.js` (truyền kolLibrary, lưu billing thật từ provider),
   `public/studio/studio.js` (Settings hiển thị Kie / TOS Not used / LAS Not used),
   `.env.example` + `.env` (append KIE_*, không ghi đè giá trị cũ).
3. **An toàn credit giữ nguyên**: providerTaskId chỉ poll không re-submit, retry download
   không sinh lại video, KIE_CONTENT_REJECTED không auto-retry, test env chặn cứng mạng thật.
4. **Kiểm thử**: 149/149 PASS (120 cũ + 29 Kie). Smoke boot cổng 20199 với duy nhất
   KIE_API_KEY (không có bất kỳ biến BytePlus nào): Settings trả provider=kie, byteplus all "Not used".
5. Backup: `docs/BACKUPS/2026-09-09/task-kie-seedance-provider/`.
   Chi tiết: `HANDOFF_SNAPSHOTS/2026-09-09/HANDOFF_SNAPSHOT_001.md`.

> Tóm tắt. Lịch sử chi tiết từng phiên (User Request, Investigation, Problems,
> Decisions, Runtime Evidence) nằm ở `HANDOFF_SNAPSHOTS/`:
>
> | Ngày | Snapshot | Nội dung |
> |---|---|---|
> | 2026-09-06 | `2026-09-06/HANDOFF_SNAPSHOT_001.md` | Audit toàn dự án + nghiên cứu API BytePlus · Khởi động thử V1 · `task-gtf-v2-mock` |
> | 2026-09-07 | `2026-09-07/HANDOFF_SNAPSHOT_001.md` | Tiếp nhận bộ rule · `task-port-20130` · `task-handoff-init` · `task-studio-redesign` |
> | 2026-09-09 | `2026-09-09/HANDOFF_SNAPSHOT_001.md` | `task-kie-only-mode`: Chuyển sang Kie-only mode, Seedance 2.5 |
> | 2026-09-09 | `2026-09-09/HANDOFF_SNAPSHOT_002.md` | `task-retry-paid-protection`: Chống tính phí trùng khi retry |
> | 2026-09-09 | `2026-09-09/HANDOFF_SNAPSHOT_003.md` | `task-kie-real-balance-usage`: Lấy số dư Kie trực tiếp từ API |
> | 2026-09-09 | `2026-09-09/HANDOFF_SNAPSHOT_004.md` | `task-studio-ui-cleanup-and-branding`: Dọn UI cũ, chuẩn hóa Studio |
> | 2026-09-09 | `2026-09-09/HANDOFF_SNAPSHOT_005.md` | `task-usage-tab-fix-480p`: Fix tab Quản lý Tín dụng & thêm 480p |
> | 2026-09-09 | `2026-09-09/HANDOFF_SNAPSHOT_006.md` | `task-deeplove-kol-fixes`: Fix duration NaN, tích hợp KOL, xem/tải MP4 |
> | 2026-09-09 | `2026-09-09/HANDOFF_SNAPSHOT_007.md` | `task-usage-credit-per-task`: Hiển thị credit tiêu hao từng task |
> | 2026-09-09 | `2026-09-09/HANDOFF_SNAPSHOT_008.md` | `task-deeplove-fullscreen-concurrency`: 8 bugfixes, nút resume, full màn hình, KIE concurrency=10 |
> | 2026-09-11 | `2026-09-11/HANDOFF_SNAPSHOT_001.md` | `task-kie-multimodel-2.0`: Thêm Seedance 2.0 và 2.0 Fast vào Kie |
> | 2026-09-11 | `2026-09-11/HANDOFF_SNAPSHOT_002.md` | `task-kie-mini-replace-standard`: Chuẩn hóa Seedance 2.0 Mini & Fast |
> | 2026-09-11 | `2026-09-11/HANDOFF_SNAPSHOT_003.md` | `task-video-to-video-tool`: Khởi tạo tool Video to Video Phase 1 |
> | 2026-09-11 | `2026-09-11/HANDOFF_SNAPSHOT_004.md` | `task-video-to-video-complete-pipeline`: Hoàn thiện trọn bộ pipeline Video to Video (§3–§14) |
> | 2026-09-11 | `2026-09-11/HANDOFF_SNAPSHOT_005.md` | `task-video-to-video-voice-tts-integration`: Tích hợp kịch bản lời thoại & Edge TTS tiếng Việt |
> | 2026-09-14 | `2026-09-14/HANDOFF_SNAPSHOT_001.md` | `task-v2v-library-modal-and-auto-describe`: Gỡ nút thừa, Modal chi tiết clip, HTTP 206 streaming, auto describe nền |

## 2026-09-07 — `task-byteplus-real-provider`

Hiện thực hoá provider thật `BytePlusGenerationProvider` cho ByteDance Seedance 1.5 Pro (`seedance-1-5-pro-251215`) trên BytePlus ModelArk.

1. **Cấu hình & Bảo vệ**: Hỗ trợ `GTF_VIDEO_PROVIDER` (mock/byteplus), `BYTEPLUS_MODELARK_API_KEY`, `BYTEPLUS_ENDPOINT_ID`, `ALLOW_LIVE_BYTEPLUS_TESTS=false`. Settings UI hiển thị trạng thái đã cấu hình mà không làm lộ secret.
2. **Preflight Guards**: Chặn ngay lập tức trước khi gọi mạng nếu thiếu API key (`BYTEPLUS_API_KEY_MISSING`), thiếu Endpoint ID (`BYTEPLUS_ENDPOINT_ID_MISSING`), có video tham chiếu (`BYTEPLUS_SEEDANCE_1_5_VIDEO_REFERENCE_UNSUPPORTED`), ảnh local/nội bộ (`BYTEPLUS_IMAGE_REQUIRES_ACCESSIBLE_URL`), hoặc KOL chưa bật LAS (`BYTEPLUS_KOL_LAS_UNSUPPORTED`).
3. **Chuẩn hóa Prompt**: Bổ sung `--duration <sec>` và `--camerafixed false` không trùng lặp.
4. **Chống sinh trùng & Tiết kiệm chi phí**: Nếu task đã có `providerTaskId`, không bao giờ POST lại. Nếu sinh video xong mà download lỗi, task giữ nguyên `providerTaskId` và `outputUrl`, khi retry chỉ tải lại file MP4 mà không submit lại.
5. **Kiểm thử**: 14 test case mock HTTP bổ sung (Tests A-N), 100% không tốn credit, không gọi ra ngoài.

Backup: `docs/BACKUPS/2026-09-07/task-byteplus-real-provider/`

## 2026-09-07 — `task-port-20140`

Đổi cổng runtime 20130 → **20140**. Máy của người dùng đã có hai tool khác chiếm
20129 (Apify Collector / crawler-POD) và 20130.

56 chỗ trong 13 file: `server.js` (mặc định `HQ_PORT`), 4 script launcher,
`Dockerfile`, `docker-compose.yml`, `.env.example`, `tests/docker_config.test.js`,
3 file tài liệu, placeholder LAN trong `public/index.html`.
`HANDOFF.md` sửa có chọn lọc: 6 dòng mô tả trạng thái hiện tại đổi sang 20140,
giữ nguyên các dòng lịch sử nhắc tên `task-port-20130`.

Backup: `docs/BACKUPS/2026-09-07/task-port-20140/`

## 2026-09-07 — `task-studio-redesign`

Làm lại toàn bộ ngôn ngữ thị giác của GTF Studio và Gateway: theme dark cố định
(bỏ `prefers-color-scheme`), bỏ gradient, thang bo góc có phân cấp, thay emoji
bằng 20 inline SVG line icon, chân dung KOL 4:5, thumbnail tham chiếu 60px,
system font stack thay Google Fonts. Layout, 5 view và 60 element ID giữ nguyên.

Files: `public/studio/{studio.css,index.html,studio.js}`, `public/gateway.html`.
Backend, `server.js` và hệ Higgsfield cũ không bị chạm.

Backup: `docs/BACKUPS/2026-09-07/task-studio-redesign/`

## 2026-09-07 — `task-port-20130`

Đổi cổng runtime sang 20130 vì 20129 trùng với tool khác của người dùng.
Thay `process.env.PORT` bằng `process.env.HQ_PORT` để cấu hình thuộc về dự án,
không phụ thuộc biến môi trường của máy (§39).

Files: `server.js`, 4 script launcher, `Dockerfile`, `docker-compose.yml`,
`.env.example`, `tests/docker_config.test.js`, 3 file tài liệu, `public/index.html`.

Backup: `docs/BACKUPS/2026-09-07/task-port-20130/`

## 2026-09-06 — `task-gtf-v2-mock`

Xây toàn bộ hệ thống V2 song song với V1. ~3.560 dòng code mới.
`server.js` chỉ +27/−1 dòng; `video_generate.js`, `cli_generate.js`,
`public/app.js`, `queue_db.json`, `package.json` **không đụng tới**.
Không thêm dependency nào.

Hai lỗi thật phát hiện lúc test và đã sửa:

```text
1. safeSegment() không lọc dấu gạch ngược → lỗ path traversal trên Windows.
   Đã sửa + thêm test chặn.
2. Tool sửa file đổi server.js sang CRLF làm diff phình toàn bộ.
   Đã đưa về LF.
```

3. task-byteplus-live-fix (2026-09-07):
   - Sửa lỗi video tạo ra bị giống mockup do server chưa tự nạp .env lúc boot.
   - Thêm loadDotenv() tự động nạp .env trong byteplus/config.js (cô lập khi chạy test tự động).
   - BytePlus ModelArk hỗ trợ gọi trực tiếp model `seedance-1-5-pro-251215` mà không bắt buộc tạo Custom Endpoint ep-xxx.
   - Hỗ trợ tải ảnh cục bộ (Image-to-Video) tự chuyển thành Base64 Data URL cho BytePlus ModelArk.
   - Server đã restart và xác nhận live: mode="live", provider="byteplus", configured=true.
   - Backup: docs/BACKUPS/2026-09-07/task-byteplus-live-fix/

4. task-byteplus-tos-provider (2026-09-07):
   - Hiện thực hoá Real `BytePlusTosStorageProvider` (chuẩn TOS4-HMAC-SHA256) bằng native Node.js crypto (0 dependency).
   - Hỗ trợ upload private bucket, tạo Signed HTTPS URL có thời hạn cho ModelArk đọc.
   - Tái sử dụng object đã có và tự động làm mới Signed URL khi reboot/retry mà không upload lại.
   - ReferenceManager chặn task có ảnh/video cục bộ nếu TOS chưa cấu hình (BYTEPLUS_TOS_NOT_CONFIGURED), prompt-only vẫn hoạt động bình thường.
   - Thêm 13 tests mock bao phủ trọn vẹn yêu cầu A → P (103/103 tests PASS).
   - Settings API và UI hiển thị trạng thái TOS mà không làm lộ Access/Secret Key.
   - Backup: docs/BACKUPS/2026-09-07/task-byteplus-tos-provider/

5. task-openrouter-seedance-provider (2026-09-07):
   - Hiện thực hoá Real `OpenRouterSeedanceProvider` (Seedance 2.5 - bytedance/seedance-2.5) qua OpenRouter Video API (`POST /api/v1/videos`).
   - Cấu trúc 3 provider: `mock`, `byteplus`, `openrouter`; cấu hình chuyển đổi qua `GTF_VIDEO_PROVIDER`.
   - Kết hợp lưu trữ TOS: ảnh/video tham chiếu upload lên BytePlus TOS sinh Signed URL HTTPS và chuyển tiếp qua `input_references`.
   - Thêm 17 tests tự động mới trong `tests/openrouter.test.js`: 120/120 tests PASS (100%).
   - Cấu hình an toàn: `ALLOW_LIVE_OPENROUTER_TESTS=true` trong `.env` mở khóa gọi mạng thật trên server, chặn tuyệt đối trong test tự động.
   - Runtime Test thực tế:
     * Task `bp_mtr2qtey_53a085ac` (Hero) qua BytePlus ModelArk 1.5 Pro: Thành công, MP4 tải về đĩa, AI tự quay lưng nhân vật để né mặt.
     * Task `bp_mtr4iysf_05c2eb95` (Hero) qua OpenRouter Seedance 2.5: Đã gửi request thành công, bị từ chối bởi bộ lọc của ByteDance (`InputImageSensitiveContentDetected.PrivacyInformation`) do ảnh KOL ảo 4 góc chụp siêu thực bị nhận diện nhầm thành "may contain real person".
   - Backup: `docs/BACKUPS/2026-09-07/task-openrouter-seedance-provider/`

6. task-kie-seedance-provider (2026-09-09):
   - Di chuyển luồng sinh video active sang Kie.ai (Seedance 2.5 `bytedance/seedance-2-5`).
   - Tạo `KieSeedanceProvider`, `KieFileStorageProvider`, `LocalKolAssetProvider`.
   - Backup: `docs/BACKUPS/2026-09-09/task-kie-seedance-provider/`

7. task-kie-only-mode (2026-09-09):
   - Loại bỏ hoàn toàn BytePlus TOS và LAS khỏi luồng active khi `GTF_VIDEO_PROVIDER=kie`.
   - Luồng tham chiếu KIE-only: ảnh/video cục bộ -> `KieFileStorageProvider` -> URL tạm thời -> Kie `createTask` `reference_image_urls` / `reference_video_urls`.
   - `ReferenceManager._requireStorageConfigured()` không bao giờ đòi TOS hay ném `BYTEPLUS_TOS_NOT_CONFIGURED` khi ở chế độ Kie; ném `KIE_UPLOAD_NOT_CONFIGURED` nếu thiếu `KIE_API_KEY`.
   - Settings API và UI Studio hiển thị chính xác: `Active Provider: KIE`, `Reference Storage: KIE upload`, `TOS: not used`, `LAS: not used`.
   - Bổ sung regression test: `GTF_VIDEO_PROVIDER=kie` với toàn bộ `BYTEPLUS_TOS_*` và `BYTEPLUS_LAS_*` rỗng, tạo task kèm ảnh tham chiếu hoàn thành thành công 100% mà không gặp lỗi TOS.
   - Toàn bộ code fallback cũ (BytePlus, OpenRouter, Higgsfield) được giữ nguyên vẹn.
   - Backup: `docs/BACKUPS/2026-09-09/task-kie-only-mode/`

8. task-flowq-google-flow-domain-and-first-gen (2026-09-14):
   - Thích ứng toàn diện với domain mới `flow.google.com` (Google Flow đổi domain): nới lỏng regex `flowWorkspaceUrl()`, hỗ trợ cả labs.google và flow.google.com.
   - Thêm alias `Omni Flash` -> `Omni 1.1 Flash` trong `VIDEO_MODELS` / `MODEL_ALIASES`.
   - Vá trigger settings: bỏ kiểm tra `aria-expanded` (thuộc tính null trên domain mới), chuyển sang kiểm tra hiển thị nút radio Video.
   - Vá selector nút Generate: thay thế XPath `__next` cũ bằng `button[aria-label*="generation" i]` và `button:has-text("arrow_forward")`.
   - RUNTIME CONFIRMED: Job `flow_mu12j1bm_25d01d` sinh video thật thành công 100%, file MP4 3.119.897 bytes (1280x720 4s H.264+AAC) tại `flow_outputs/outputs/flow_mu12j1bm_25d01d/`.
   - 194/194 unit/integration tests PASS (100%).
   - Backup: `docs/BACKUPS/2026-09-14/task-flowq-google-flow-domain-and-first-gen/`

9. task-flowq-video-reference-hero (2026-09-14):
   - Khám phá và hiện thực cơ chế tải media lên Google Flow: trigger menu `Trình đơn thêm nội dung nghe nhìn` -> `Tải lên` bắt sự kiện `filechooser` (chấp nhận video mp4/mov và ảnh).
   - Tải thành công video thật `Hero.mp4` (4.05s) lên thư viện project Flow thành asset `Hero Video`.
   - Gắn `@Hero Video` làm ingredient chip vào prompt box, mở khóa nút Generate.
   - RUNTIME CONFIRMED: Sinh thành công 100% video `flow_hero_ref_4f5ef1-1.mp4` (1.632.208 bytes, 1280x720 4.01s H.264+AAC) từ tham chiếu `Hero.mp4`.
   - Snapshot: `docs/AI_RULES/HANDOFF_SNAPSHOTS/2026-09-14/HANDOFF_SNAPSHOT_008.md`.

Backup: `server.js.pre-v2.bak` ở thư mục gốc (tạo trước khi có chính sách
`BACKUP_ROOT`; các task sau dùng `docs/BACKUPS/`).

---

# 11. VERIFICATION STATUS

```text
Unit / Integration   194/194 PASS (npm test — 164 cũ + 9 Multi-Model + 13 Video to Video + 8 Google Flow Queue; 2026-09-14)
Runtime smoke        48/48 PASS   (E2E chính, concurrency, restart recovery)
Settings API         200 OK       (mode="live", provider="kie", activeProviderName="KIE", referenceStorage="KIE upload", tos="not used", las="not used")
Deeplove Routes      200 OK       (GET /deeplove, GET /Deeplove, GET /byteplus)
Video Studio Route   200 OK       (GET /studio/video-to-video.html, GET /api/video-studio/*)
Browser Render       PASS         (Headless Edge/Chrome 0 errors, verify_clean_library.png, verify_modal_detail.png)
```

**V2 — RUNTIME CONFIRMED:**

```text
E2E ma trận 8 tổ hợp đầu vào                         8/8 completed
Luồng chính KOL + Ảnh + Video + Prompt               MP4 tải được, 40.156 bytes, magic "ftyp"
Concurrency                                          đỉnh quan sát 10/10, 40 task không lần nào vượt
Nạp cuốn chiếu                                       task 11 vào slot chỉ 4 ms sau khi slot đầu trống
Pause                                                job đang chạy vẫn xong, không nạp thêm
Restart giữa lúc render                              providerTaskId không đổi, submitCount = 1,
                                                      mock registry vẫn đúng 1 job
Realtime 2 client                                    cả hai nhận cùng chuỗi sự kiện
UI thật trên trình duyệt                             tạo KOL → chọn vào task → completed → usageCount = 1
BytePlus ModelArk Mock Test Suite (A-N)              14/14 PASS (Preflight, Formatting, POST/GET, Polling, Resume, DL, Retry)
BytePlus ModelArk Live Config Check                  PASS (Auth OK, Model ID OK, Base64 Data URL OK)
BytePlus TOS Mock Test Suite (A-P)                   13/13 PASS (Preflight, Sign, Upload, Expiry, Traversal, Security, Guard)
OpenRouter Seedance 2.5 Test Suite                   17/17 PASS (Preflight, Submit, Polling, Resume, DL, Security, Guard)
Kie.ai Seedance 2.5 Test Suite (incl. KIE-only)      30/30 PASS (Config, Upload, Gen, Queue/Recovery, KIE-only Regression)
Kie.ai Pricing & Cost Estimation Suite (A-H)          8/8 PASS
Kie.ai Usage Accounting & Balance Suite (A-F)         6/6 PASS
Kie.ai Multi-Model Suite (2.5 / 2.0 Mini / 2.0 Fast) 9/9 PASS (Schema, Pricing, Validation, Model ID, UI Gating)
Video to Video Library & Project Suite (SRS §3-§14)  13/13 PASS (Probe, Category, Scan, Store CRUD, FSM, Package Export, Timeline, Voice, Assemble)
Edge TTS Voice Generation Verification               PASS (HoaiMy, NamMinh, Python edge-tts integration)
Video Analyzer Pipeline Worker Verification          PASS (Whisper base transcription + Gemini Vision analysis via 9Router)
Video to Video UI & Modal Visual Verification        PASS (Clean library without bulk button, detailed modal with HTTP 206 streaming)
Deeplove Studio UI Verification (task-deeplove-kol)  PASS (KOL dropdown/modal, duration integer, media actions ▶️/⬇️)
Live Test 1 (BytePlus Seedance 1.5 Pro)              PASS (cgt-20260907180456-wsttf, MP4 lưu tại byteplus_outputs/Tình/Hero/)
Live Test 2 (OpenRouter Seedance 2.5)                API OK, TOS signed URL OK, bị ByteDance chặn do PrivacyInformation trên ảnh KOL ảo
Google Flow Real Gen (Chrome CDP 9334)               PASS (flow_mu12j1bm_25d01d, 3.1MB MP4 1280x720 4s H.264+AAC, flow.google.com)
Google Flow Video Reference Gen (Hero.mp4)           PASS (flow_hero_ref_4f5ef1, 1.6MB MP4 1280x720 4.01s H.264+AAC, flow.google.com)
Google Flow Full E2E Video Ref 1 (Hero.mp4)          PASS (flow_mu14d1yd_a2c26b, 1.88MB MP4 720x1280 4s 9:16, tự động 100%)
Google Flow Full E2E Video Ref 2 (Cyberpunk Puppy)   PASS (flow_mu14wrtb_4183c8, 2.48MB MP4 720x1280 4s 9:16, tự động 100%)
```

**V1 — regression đã kiểm:** `/higgsfield`, `/app.js`, `/styles.css`, `/api/queue`,
`/api/tasks`, `/api/cdp/status`, `/api/lan-info`, `/api/cli/models`, `/api/logs`
đều 200. `queue_db.json` nguyên vẹn 468 task, schema `task_*` không đổi.
UI cũ render giống hệt trước. Không kích hoạt sinh video Higgsfield thật nào.

---

# 12. OPEN RISKS

1. **Rào kiểm duyệt khuôn mặt trên Seedance 2.5**: Ảnh KOL ảo chụp photorealistic nhiều góc (grid 2x2 turnaround) bị bộ lọc sinh trắc học của ByteDance phân loại nhầm thành "may contain real person" (`InputImageSensitiveContentDetected.PrivacyInformation`).
2. **Khác biệt hành vi giữa 1.5 Pro và 2.5**: Seedance 1.5 Pro nhận ảnh nhưng tự ý quay lưng nhân vật để né mặt người thật. Seedance 2.5 chặn cứng (Hard-fail) từ khâu kiểm duyệt trước khi sinh.
3. `queue_db.json` phình dần (mục 9.1).
4. Chưa có lớp xác thực nào cho `/deeplove` và `/byteplus`. Dashboard mở cho toàn LAN — khi bật
   chế độ live, bất kỳ ai vào được cổng 20140 sẽ tiêu được tiền thật.
5. Dự án tên là PORTABLE nhưng `docker-compose.yml` còn đường dẫn máy cũ (mục 9.4).
6. Quyền IAM của Access Key TOS cần có đủ quyền `tos:PutObject` và `tos:GetObject` trên bucket `gtf-video-reference`.
7. [ĐÃ ĐÓNG 2026-09-14] **Video to Video chuẩn DỌC 9:16 (1080x1920)**: Đã chuyển toàn bộ chuỗi dựng FFmpeg sang 1080x1920 (`scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,fps=30`), phụ đề cỡ 48pt canh chỉnh hoàn hảo ở 72% chiều cao màn hình cho TikTok/Reels/Shorts.
8. `video-analyzer-pipeline/.../media/probe.py:36` gọi `create_subprocess_exec` không đặt `stdin`,
   cùng họ lỗi với `frames.py` đã vá. ffprobe không đọc stdin tương tác nên rủi ro thấp; CHƯA SỬA.
9. [ĐÃ ĐÓNG 2026-09-14] **Google Flow đã đổi domain**: `labs.google/fx/vi/tools/flow` -> `flow.google.com`. Đã cập nhật `flowWorkspaceUrl()`, vá radio selector settings và nút generate `button[aria-label*="generation" i]`.
10. [ĐÃ ĐÓNG 2026-09-14] **Flowq chạy sinh thật**: Đã hoàn thành 100% qua job `flow_mu12j1bm_25d01d`, MP4 3.1MB, ffprobe PASS. Worker giữ `enabled: false` sau boot để chống tiêu hao quota ngoài ý muốn.
11. [ĐÃ ĐÓNG 2026-09-14] **Tự động hóa toàn bộ luồng tham chiếu Flowq & Chống sập tiến trình**:
    - Tự động mở menu thêm nội dung -> FileChooser -> nạp file -> đóng/mở settings -> chọn radio tiếng Việt (`Video`, `Thành phần`, `4 giây`, v.v.) bên trong `.cdk-overlay-pane` (tránh chạm nút Display Settings gây backdrop modal che màn hình).
    - Tự động click `button.add-menu-trigger` -> chèn chip `@...` vào prompt bar -> điền prompt -> bấm tạo video.
    - Trích xuất video thành phẩm trực tiếp từ canvas player qua `page.request.get(src)` siêu nhanh, không phụ thuộc nút Download.
    - Áp dụng chặt chẽ: tối đa 3 ảnh và tối đa 1 video làm tham chiếu (chế độ Frames tối đa 2 ảnh, chặn video).
    - Gia cố server chống sập đột ngột: `process.on('unhandledRejection')` và `process.on('uncaughtException')` tại `server.js`, bọc kín `try...catch` ở listener mạng `page.on('response')` trong `runner.mjs`.
    - Kiểm thử: 196/196 tests PASS (100%). Hai job chạy thật đều thành công: Hero (1.88MB) và Cún Cyberpunk (2.48MB).
12. [ĐÃ ĐÓNG 2026-09-14] **Xóa bỏ triệt để đóng băng khung hình bằng Slow-Motion Time-Stretching & Hỗ trợ Batch 20 video**:
    - Xóa bỏ hoàn toàn `tpad=stop_mode=clone` gây đứng hình đơ máy khi clip ngắn hơn câu thoại.
    - Triển khai bộ nhân thời gian động $multiplier = D_{\text{target}} / T_{\text{clip}}$ kết hợp `setpts=(PTS-STARTPTS)*multiplier` và `fps=30`, tự động làm chậm nhịp video mượt mà ($\approx 0.6\times - 0.75\times$) phủ trọn câu thoại voiceover.
    - Đệm nhịp thở tự nhiên: `adelay=150|150` (150ms đầu câu) và 450ms đuôi câu thoại.
    - Chuyển cảnh mềm: `xfade=fade` (0.35s) và `acrossfade` cho toàn bộ các điểm nối phân đoạn.
    - Mở rộng 20 góc kịch bản marketing `DIVERSE_ANGLES` chống trùng lặp với kho 164 asset ($U \le 3$, tỷ lệ trùng $\approx 0\%$).
    - Sửa FSM `transitionProject` bảo đảm idempotent chống lỗi xung đột trạng thái khi phân tích song song.
    - Toàn bộ 196/196 tests PASS (100%), đã nghiệm thu và re-render trọn vẹn 5/5 video tại `gtf_mu14nidb_e926ff`.
13. [ĐÃ ĐÓNG 2026-09-14] **Nhận diện phần tử Flow hoàn tất, Batch Download qua XPath, Giải nén ZIP & Delay tuần tự 10s**:
    - Nhận diện phần tử video/ảnh tạo xong: `<video aria-label="Video được tạo" src="https://flow-content.google/video/...">` (hoặc `<img>` cho image) trong Batch 0 mới nhất, hover tự động để mount player.
    - Chờ đúng 3 giây sau khi phần tử xuất hiện rồi bấm nút tải về của batch theo XPath: `//*[@id="main-content"]/flow-project-shell/flow-project-page/div/flow-project-sidenav-container/mat-sidenav-container/mat-sidenav-content/div/div/cdk-virtual-scroll-viewport/div[1]/div[1]/div[1]/flow-batch-info/div[1]/button[1]`.
    - Thiết lập CDP download behavior trực tiếp trong Chrome, tự động bắt file tải về `tải xuống.zip`.
    - Hỗ trợ giải nén mọi định dạng nén (ZIP, GZIP), lọc bỏ file rác macOS `__MACOSX`, trích xuất MP4 nguyên bản đưa về backend (`flow_outputs/outputs/<job_id>/<job_id>-1.mp4`).
    - Hàng chờ tuần tự đảm bảo: nếu còn task phía sau, sau khi lượt trước tải xong hoàn tất sẽ đợi đúng 10 giây trước khi F5 làm mới trang để tiếp tục task kế tiếp.
    - Đã nghiệm thu chạy thật thành công job `flow_mu17jrb3_3dc779` (video 2.94MB, 4.01s, 720x1280), HTTP 200 OK.
    - Toàn bộ 207/207 tests PASS (100%) trên cả 4 Tiers.

---

# 13. NEXT STEPS & RECOMMENDATIONS

```text
1. ĐÃ HOÀN TẤT GẦN ĐÂY:
   - task-flowq-batch-download-xpath-and-queue-delay (2026-09-14):
     + Nhận diện element video xong trên Batch 0 (<video aria-label="Video được tạo" src="https://flow-content.google/video/...">), đợi 3s rồi bấm nút download theo XPath batch info.
     + Cấu hình Browser/Page.setDownloadBehavior trên CDP, nhận diện file ZIP trực tiếp từ Chrome.
     + Tự động giải nén ZIP/GZIP ra file video nguyên bản và lưu vào backend.
     + Chờ đúng 10s sau khi task trước tải xong mới F5 cho task tiếp theo trong hàng chờ.
     + Xác thực chạy thật thành công job flow_mu17jrb3_3dc779 (2.94MB, 4.01s, 720x1280), 207/207 tests PASS.
   - task-flowq-waiting-loop-and-cdp-fix (2026-09-14):
     + Đối chiếu luồng CDP với Canvas-AI (services/google-flow-runner.mjs): Phát hiện code gốc Canvas-AI chỉ hỗ trợ text-to-video, khi có video tham chiếu sẽ bắt trúng URL bucket /asb/ vào networkMedia và thoát ngay sau 30s thay vì đợi Flow gen xong.
     + Phân tách nguồn media tuyệt đối: Bỏ qua hoàn toàn URL /asb/ (Assets Bucket), chỉ công nhận video AI tạo ra từ flow-content.google/video/<UUID>.
     + Chuẩn hóa URL Key (normalizeMediaKey) bỏ query parameters và fix lệch entity &amp; vs &.
     + Quét toàn bộ video hiện hữu trước khi bấm Tạo (collectExistingFlowVideoKeys) nạp vào preExistingVideoKeys.
     + Vòng lặp chờ kiên nhẫn (Waiting Loop): Polling mỗi 3s đến khi video AI thực sự xuất hiện và nạp xong (duration > 0, bytes > 50KB), timeout tối đa 5 phút, log nhịp thở mỗi 15s lên UI.
     + Hot-reload động qua import('./runner.mjs?update=' + Date.now()) trong queue.js, nạp code mới ngay lập tức mà hoàn toàn KHÔNG cần restart server.
     + 196/196 tests PASS (100%).
   - task-v2v-slowmo-time-stretch-and-batch20 (2026-09-14):
     + Xóa bỏ triệt để đóng băng khung hình (Zero Freezing): Thay thế hoàn toàn tpad=stop_mode=clone bằng bộ nhân thời gian động multiplier = D_target / T_clip và setpts=(PTS-STARTPTS)*multiplier @ fps=30 trong assembler.js, làm chậm tốc độ phát mượt mà phủ kín trọn vẹn câu thoại và phụ đề.
     + Nhịp thở âm thanh tự nhiên: adelay=150|150 (150ms đầu câu) và apad đệm 450ms đuôi câu, chuyển cảnh mềm xfade (0.35s) + acrossfade giữa mọi phân đoạn.
     + Mở rộng 20 góc kịch bản marketing (DIVERSE_ANGLES) trong timeline_generator.js đảm bảo tỷ lệ trùng lặp clip xấp xỉ 0% với kho 164 video.
     + Chuẩn hoá path/assetPath cho hàm assembleVideo và batchAssemble.
     + Sửa lỗi chuyển trạng thái FSM idempotent cho transitionProject tránh lỗi song song analyze-reference & analyze-hook.
     + Re-render hoàn tất 5/5 video mẫu nghiệm thu tại gtf_mu14nidb_e926ff (final_1.mp4 đến final_5.mp4).
     + 196/196 tests PASS (100%).
   - task-flowq-automation-full-pipeline (2026-09-14):
     + Tự động hóa 100% E2E cho Google Flow qua Chrome CDP 9334 tại /byteplus/Flowqueue.
     + Tự động nạp media tham chiếu vào thư viện dự án Flow bằng FileChooser.
     + Cấu hình radio parameters tiếng Việt (Mode, Ingredients/Frames, Ratio, Model, Duration, Variants) an toàn bên trong .cdk-overlay-pane, loại bỏ xung đột click với nút Display Settings.
     + Kích hoạt add-menu-trigger để chèn chip tham chiếu @ vào ô prompt, điền prompt và bấm nút Tạo (Generate).
     + Trích xuất video thành phẩm trực tiếp từ Canvas Video Player bằng page.request.get(src) vào outputs/<job_id>/, không phụ thuộc nút Download.
     + Khống chế số lượng tham chiếu: Tối đa 3 ảnh (.jpg, .png, .webp) và tối đa 1 video (.mp4 <= 10s). Chế độ Frames nhận tối đa 2 ảnh và chặn video.
     + Gia cố server chống sập đột ngột: process.on('unhandledRejection') và process.on('uncaughtException') tại server.js, try...catch toàn diện ở onResponse trong runner.mjs.
     + Đã xác thực thành công 2 video thực tế từ Google Flow: Hero (1.88MB) và Chú cún Cyberpunk (2.48MB).
     + 196/196 tests PASS (100%).
   - task-flowq-options-and-visual-slots (2026-09-15):
     + Bổ sung đầy đủ options: Image models (Nano Banana 2, Pro, 2 Lite), Video models (Omni 1.1 Flash, Veo 3.1 Lite/Fast/Quality/Lite Lower Priority), durations (4s, 6s, 8s, 10s), ratio đủ 5 tỉ lệ Flow, resolution (360p/720p riêng cho Omni Flash).
     + Giao diện 2 ô trực quan riêng biệt cho Thành phần (Ingredients): Ô Ảnh tham chiếu (tối đa 3 ảnh, thumbnail preview, nút xóa từng ảnh) và Ô Video tham chiếu (tối đa 1 video, player preview, nút xóa).
     + Tự động khóa/mở ô Video theo đúng model: Chỉ Omni 1.1 Flash mở video; các model Veo và Image mode tự động khóa ô video kèm badge cảnh báo đỏ chống lỗi người dùng.
     + Chế độ Khung hình (Frames): 2 ô trực quan Khung đầu (bắt buộc) & Khung cuối (tùy chọn), chặn hoàn toàn video.
   - task-v2v-pipeline-and-pagination (2026-09-15):
     + Đưa mục "Quy trình tự động hoá Video Studio (FSM Engine)" lên vị trí số 1 ngay đầu trang /byteplus/video-to-video.
     + Thêm phân trang (10, 20, 50, 100 clip/trang), dãy nút số trang thông minh, nút nhảy trang, tìm kiếm tức thì và lọc theo danh mục & trạng thái mô tả AI.
     + 209/209 tests PASS (100%).

2. CÁC HẠNG MỤC KHI USER SẴN SÀNG CHẠY THẬT:
   - Cung cấp KIE_API_KEY trong .env và đặt GTF_VIDEO_PROVIDER=kie rồi khởi động lại server.
   - Khi có KIE_API_KEY thật, hệ thống tự động trừ credit và lưu đầy đủ bản ghi usage 13 trường.

3. HẠNG MỤC NÂNG CAO (NẾU CÓ NHU CẦU):
   - Thêm tab Settings trực quan trên UI nếu muốn xem tình trạng API key không cần mở file .env.
   - Thêm lớp xác thực bảo vệ bảng điều khiển khi mở ra mạng LAN.
```
- GTF_VIDEO_PROVIDER=kie        (Seedance 2.5 qua Kie.ai — LUỒNG CHÍNH)
- GTF_VIDEO_PROVIDER=openrouter (Seedance 2.5 qua OpenRouter — fallback)
- GTF_VIDEO_PROVIDER=byteplus   (Seedance 1.5 Pro ModelArk — fallback)
- GTF_VIDEO_PROVIDER=mock       (Chế độ thử nghiệm 0 đồng)

---

# 14. CONTINUATION GUIDE

```text
1. Đọc docs/AI_RULES/CRAWLER_POD_AGENT_RULES.md rồi đọc file này.
   Cần truy vết quyết định cũ thì đọc HANDOFF_SNAPSHOTS/ theo ngày.
2. Xác định Task ID và scope.
3. Backup vào docs/BACKUPS/YYYY-MM-DD/<task-id>/ TRƯỚC khi sửa, giữ relative path.
4. Trace flow trước khi sửa (§3). Ranh giới V1/V2 phải giữ tuyệt đối.
5. npm test phải giữ 76/76 trở lên. Không sửa assertion để che lỗi (§30).
6. Verify runtime tại http://localhost:20140, không test nhầm tiến trình cũ.
7. Báo cáo theo §48. Mock ≠ Real (§13, §44).
8. Cập nhật file này khi có thay đổi có ý nghĩa (§36).
```

**Ranh giới không được vượt:**

```text
KHÔNG refactor video_generate.js / cli_generate.js
KHÔNG migrate queue_db.json
KHÔNG gộp task V2 vào state.queue của V1
KHÔNG tái dùng state.isRunning của V1 cho V2
KHÔNG đổi UI cũ ở public/index.html, app.js, styles.css
KHÔNG gọi BytePlus/TOS/LAS thật khi chưa được cho phép
```
