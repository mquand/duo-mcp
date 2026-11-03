# Duo-MCP Server v2.0 (Streamlined Architecture)

Model Context Protocol (MCP) Server kết nối **Claude Code** (Lead Orchestrator) với **Antigravity CLI (`agy`)** (High-speed Worker).

> [!NOTE]
> Phiên bản v2.0 đã được **tinh gọn tối đa từ 18 tools xuống còn 6 tools tinh nhuệ nhất**. Thiết kế này giúp tiết kiệm ~70% dung lượng System Prompt (tiết kiệm hàng ngàn tokens mỗi lượt chat), loại bỏ hoàn toàn hiện tượng gọi nhầm tool (tool hallucination) và tập trung 100% vào tốc độ thực thi thực tế.

---

## 1. Danh Sách 6 Tools Tinh Nhuệ (Core Tools)

| # | Tool Name | Phân Loại | Chức Năng Chính | Tham Số |
| :-: | :--- | :--- | :--- | :--- |
| **1** | `duo_delegate` | **Thực thi (Đơn / Đa luồng)** | **[Không cần API Key]** Chạy đơn hoặc chạy nhiều subtasks qua `agy` CLI (Gemini 3.8 / Claude). Tự động chạy **song song** khi khác repo (tăng tốc 2-3x), tự động xếp **hàng đợi (Queue)** khi cùng repo hoặc trùng file. Tự động stream log, kiểm tra compile lỗi và cắt tỉa output. | `prompt` (task đơn), `tasks` (mảng task đa luồng), `directory`, `targetFiles`, `model`, `effort`, `timeoutMinutes`, `autoCompile` |
| **2** | `duo_inspect` | **Khảo sát & Bảo vệ** | **[All-in-One]** Quét khung cấu trúc AST CodeGraph (<10ms), nhận diện công nghệ (Stack/Framework/Quy ước/Lệnh test), và tự động tạo Git Safety Checkpoint bảo vệ code trước khi sửa. | `directory`, `maxFiles`, `checkpoint` |
| **3** | `duo_diff` | **Kiểm tra Thay đổi** | Tóm tắt thay đổi code ngắn gọn (+thêm/-bớt dòng theo từng file) sau khi AI sửa xong, giúp Claude nắm bắt ngay mà không cần đọc hàng ngàn dòng raw diff. | `directory` |
| **4** | `duo_rollback` | **Quay xe An toàn** | Khôi phục mã nguồn về checkpoint an toàn gần nhất khi AI gặp lỗi hoặc sinh code không mong muốn. Hỗ trợ rollback toàn bộ hoặc hoàn tác riêng từng bước (`stepId`). | `stepId`, `directory` |
| **5** | `duo_queue` | **Giám sát Tiến trình** | Theo dõi trực quan các tiến trình AI đang chạy nền trong từng repo, danh sách các task đang chờ trong hàng đợi (lý do chờ), và file log stream trực tiếp. | (Không) |
| **6** | `duo_plan` | **Quản lý Kế hoạch** | Hợp nhất toàn bộ thao tác kế hoạch trong `PLAN.md`: Bắt đầu bước tiếp theo (`execute`), tạo plan mới (`create`), cập nhật trạng thái bước (`update`), đọc plan (`get`), hoặc đồng bộ checklist note (`sync_note`). | `action`, `stepId`, `status`, `note`, `title`, `task`, `summary`, `steps`, `stepKeyword`, `completed`, `directory` |

---

## 2. Quy trình Phối hợp Chuẩn (Workflow)

```text
┌──────────────────────────────────────────┐
│               CLAUDE CODE                │  (Lead Architect & Code Reviewer)
└────────────────────┬─────────────────────┘
                     │
       1. duo_inspect ➔ Khảo sát AST + Checkpoint bảo vệ
       2. duo_delegate ➔ Chạy song song (BE + FE) hoặc hàng đợi
       3. duo_diff ➔ Xem tóm tắt thay đổi (+/- dòng)
       4. duo_rollback ➔ (Nếu cần) Quay xe an toàn
                     │
                     ▼
┌──────────────────────────────────────────┐
│         ANTIGRAVITY CLI (`agy`)          │  (Headless Worker: Gemini 3.8 / Claude)
└──────────────────────────────────────────┘
```

---

## 3. Các Lệnh Tắt Slash Commands (Claude Code CLI)

Các lệnh shortcut được cấu hình sẵn trong `~/.claude/commands/`:

| Slash Command | Hành Động |
| :--- | :--- |
| `/duo-parallel` | Chạy nhiều subtask cùng lúc (Song song nếu khác repo, Hàng đợi nếu cùng repo/file). |
| `/duo-queue` | Xem trạng thái các luồng AI đang chạy và các task đang chờ trong hàng đợi. |
| `/duo-inspect` | Khảo sát AST CodeGraph, nhận diện framework/rules và tạo Checkpoint an toàn. |
| `/duo-execute-plan` | Tự động Checkpoint, nạp kế hoạch `PLAN.md` và bắt đầu bước tiếp theo. |
| `/duo-diff` | Xem tóm tắt thay đổi code ngắn gọn (+/-) theo từng file. |
| `/duo-undo` | Hoàn tác an toàn về checkpoint khi gặp lỗi. |
| `/duo-status` | Giám sát tiến trình đang chạy và hàng đợi hệ thống. |

---

## 4. Theo Dõi Tiến Độ Thực Tế (Real-time Monitoring)

Khi `duo_delegate` đang chạy ngầm, bạn có thể mở một terminal riêng để theo dõi:

```bash
# Xem trực tiếp log stream từ Antigravity
tail -f ~/.duo/live.log

# Hoặc theo dõi tóm tắt tiến trình và file thay đổi
~/.duo/watch_agy.sh
```

---

## 5. Cài Đặt & Kiểm Thử

```bash
# Cài đặt dependencies
npm install

# Biên dịch TypeScript
npm run build

# Chạy toàn bộ 14 unit tests
npm test
```
