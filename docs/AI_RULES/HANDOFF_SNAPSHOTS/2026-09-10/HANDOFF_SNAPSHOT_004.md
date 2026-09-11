# HANDOFF SNAPSHOT 004

Date: 2026-09-10
Task: `task-deeplove-usage-cleanup-and-transparency`

---

## 1. USER REQUEST & SCOPE

1. **Bỏ hoàn toàn cơ chế Ẩn/Dọn dẹp trên UI**:
   - Người dùng yêu cầu loại bỏ các nút tạm thời ("Dọn Đã Xong", "Hiện Đã Xong", "Dọn Lịch Sử Tiêu Hao", "Khôi Phục Lịch Sử").
   - Giao diện phải hiển thị đầy đủ, minh bạch 100% tất cả task trong Queue và toàn bộ lịch sử chi phí tín dụng.
2. **Dọn dẹp dữ liệu rác trên cả UI lẫn Backend (`byteplus_usage.json`)**:
   - Sao lưu dữ liệu cũ trước khi thực hiện (bảo đảm an toàn theo §34).
   - Xóa toàn bộ dữ liệu test cũ (1.131 dòng Vy Anh, 61 dòng Tester, 40 dòng automated test).
   - Chỉ giữ lại đúng các bản ghi tương ứng 1-to-1 với 6 task đã hoàn thành mà người dùng tự test.
3. **Cập nhật Pull Request #2 trên GitHub**:
   - Đồng bộ commit và mô tả PR #2 (`feat/deeplove-studio-v2`) lên remote upstream `https://github.com/Mos-8124/HIGGSFIELD_QUEUE_PORTABLE`.
4. **Giải thích cơ chế tính phí 136 cr vs 112 cr**:
   - Phân tích nguyên nhân chênh lệch chi phí giữa định mức lý thuyết 112 cr (480p 4s x 28 cr/s) và số trừ thực tế từ Kie API 136 cr (base fee/data.creditsConsumed).

---

## 2. IMPLEMENTATION DETAILS

### 2.1 Sao lưu an toàn (Backup)
- Tạo 2 bản backup độc lập lưu trữ trọn vẹn 1.234 bản ghi cũ:
  - `byteplus_usage.backup.json` (tại root).
  - `docs/BACKUPS/2026-09-10/task-usage-cleanup/byteplus_usage.backup.json`.
- Cập nhật `.gitignore` bỏ qua `*.backup.json`.

### 2.2 Revert cơ chế Ẩn UI (`public/studio/studio.js` & `public/studio/index.html`)
- Gỡ bỏ hoàn toàn các nút `#btn-clear`, `#btn-restore-tasks`, `#btn-clear-usage`, `#btn-restore-usage`.
- Xóa bỏ các biến localStorage: `hg_cleared_task_ids`, `hg_cleared_usage_time`, `hg_cleared_completed_ui`, `hg_cleared_usage_ui`.
- Khôi phục hàm `calculateStats()` và `renderQueueTable()` render toàn bộ task theo bộ lọc chuẩn.

### 2.3 Làm sạch Backend `byteplus_usage.json`
- Lọc và lưu trữ chính xác 6 bản ghi tương ứng 6 task hoàn thành của người dùng:
  1. `bp_mtv0wucb_6721fc85` (final test): -136 cr
  2. `bp_mtuxecs7_3ab10945` (Test KOL): -136 cr
  3. `bp_mttvkkng_904883ba` (Hero1234): -136 cr
  4. `bp_mtr2qtey_53a085ac` (Hero): -112 cr (ước tính)
  5. `bp_mtqtscjj_3accc270` (Chú mèo nhảy trên núi): -112 cr (ước tính)
  6. `bp_mtqsxuja_f77c3415` (Chú mèo nhảy trên núi): -0 cr (mock)
- Số dư ví Kie thực tế: 672 cr ($3.36 USD).
- Tổng tiêu hao thực tế Kie: 408 cr ($2.04 USD).

### 2.4 Git & PR #2
- Commit `c75cfee` (*refactor(studio): remove clear UI features and display all tasks and history in full*).
- Commit `05a1586` (*chore: ignore *.backup.json files*).
- Push branch `feat/deeplove-studio-v2` lên origin.
- Cập nhật body của Pull Request #2 qua GitHub CLI.

---

## 3. VERIFICATION & RESULTS

1. **Automated Tests:**
   - `node tests/byteplus.test.js`: PASS.
   - `node tests/kie.test.js`: PASS.
   - `node tests/usage_manager.test.js`: PASS.
2. **Visual Verification (Puppeteer):**
   - Hàng chờ Queue: 6 completed tasks hiển thị đầy đủ, không có nút dọn dẹp mồ côi.
   - Bảng Lịch sử Tiêu hao: hiển thị đúng 6 dòng, số dư 672 cr, tổng tiêu hao 408 cr.
