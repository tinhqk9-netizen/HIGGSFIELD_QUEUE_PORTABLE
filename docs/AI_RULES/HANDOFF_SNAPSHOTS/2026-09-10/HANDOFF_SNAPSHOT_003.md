# HANDOFF SNAPSHOT 003

Date: 2026-09-10
Task: `task-deeplove-queue-reorder`

---

## 1. USER REQUEST & SCOPE

1. **Kéo thả sắp xếp độ ưu tiên Task (Priority Drag & Drop)**:
   - Người dùng yêu cầu thêm tính năng kéo thả hàng trong bảng danh sách task hàng chờ (Queue) để có thể ưu tiên đưa các task cần làm lên đầu.
   - Khi kéo thả xong, thứ tự xử lý của hàng chờ backend phải được cập nhật tương ứng theo thứ tự mới.

---

## 2. ROOT CAUSE & DESIGN

- Trước đó, hàng chờ `byteplus/queue_manager.js` chỉ xử lý tuần tự theo mảng FIFO (`this.tasks.filter(t => t.status === 'pending')`).
- Chưa có endpoint API nào cho phép client tái sắp xếp thứ tự các task `pending`.
- Giao diện UI Studio chưa có cơ chế kéo thả tương tác trên các hàng của thẻ `<tbody>`.

---

## 3. IMPLEMENTATION DETAILS

### 3.1 Backend (`byteplus/queue_manager.js` & `byteplus/routes.js`)
- **`byteplus/queue_manager.js`:**
  - Thêm phương thức `reorderQueue(taskIds)`:
    - Lấy danh sách các task hiện tại.
    - Sắp xếp lại các task ở trạng thái `pending` theo đúng thứ tự mảng `taskIds` nhận được từ client.
    - Giữ nguyên trạng thái và vị trí tương đối của các task `running` hoặc `completed`.
    - Ghi nguyên tử vào `byteplus_queue_db.json`.
- **`byteplus/routes.js`:**
  - Thêm endpoint `POST /api/byteplus/queue/reorder`:
    - Nhận body `{ taskIds: string[] }`.
    - Validate mảng ID hợp lệ, gọi `queue.reorderQueue(taskIds)`.
    - Phản hồi `200 OK` với danh sách queue đã được tái sắp xếp.
    - Broadcast sự kiện Socket.IO để các client kết nối cùng cập nhật.

### 3.2 Frontend (`public/studio/studio.js` & `public/studio/studio.css`)
- **`public/studio/studio.js`:**
  - Thêm thuộc tính `draggable="true"` cho các hàng task ở trạng thái `pending`.
  - Bắt các sự kiện `dragstart`, `dragover`, `dragenter`, `drop`, `dragend`.
  - Hiển thị hiệu ứng đường kẻ chỉ định vị trí thả (drop indicator).
  - Khi thả: cập nhật thứ tự DOM cục bộ, tự động gửi request `POST /api/byteplus/queue/reorder` lên backend.
  - Tự động cập nhật lại số thứ tự (STT) 1, 2, 3... hiển thị trên bảng.

---

## 4. VERIFICATION & RESULTS

1. **Automated Tests:** `node tests/byteplus.test.js` & `node tests/kie.test.js` PASS 100%.
2. **Runtime Verification:**
   - Kéo task pending lên đầu danh sách thành công.
   - Backend `byteplus_queue_db.json` cập nhật đúng thứ tự mới.
   - Refresh trang giữ nguyên đúng thứ tự đã kéo thả.
