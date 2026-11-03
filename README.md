# Duo-MCP Server

Model Context Protocol (MCP) Server for [**Duo-Agent**](https://github.com/mquand/Duo-Agent).

Expose [Duo-Agent](https://github.com/mquand/Duo-Agent)'s autonomous multi-agent orchestrator (Architect -> Builder -> Auditor) and rapid CodeGraph engine to **Claude Code** and **Antigravity CLI (`agy`)**.

> [!NOTE]
> Hệ thống được thiết kế tối ưu tập trung hoàn toàn vào workflow: **Claude Code (CLI / Desktop)** đóng vai trò Orchestrator/Planner chính, và **Antigravity CLI (`agy`)** đóng vai trò Worker ủy quyền phần cứng/context lớn mà không cần extension trung gian.

---

## 1. Tính năng & Tools Cung Cấp

| Tool Name | Mô tả | Tham số |
| :--- | :--- | :--- |
| `duo_agy_delegate` | **[Không cần API Key]** Ủy quyền trực tiếp cho Antigravity CLI (`agy`) trên máy: Tận dụng Gemini/Claude có sẵn để phân tích codebase nặng, đọc context lớn, tóm tắt log, tra cứu web hoặc review chéo giải pháp. | `prompt` (bắt buộc), `model`, `effort`, `directory` |
| `duo_inspect_repo` | **[Tất cả trong 1]** Khảo sát & Bảo vệ mã nguồn: Tự động quét khung CodeGraph AST (<10ms), nhận diện Stack/Lệnh test/Quy ước, và tạo Git Safety Checkpoint bảo vệ code chỉ trong 1 lệnh duy nhất. | `directory`, `maxFiles`, `checkpoint` (mặc định: true) |
| `duo_execute_plan` | **[Tất cả trong 1]** Kích hoạt thực thi kế hoạch: Tự động tạo Git Checkpoint an toàn, nhận diện stack/test, nạp plan, chuyển bước sang `IN_PROGRESS` và trả về toàn bộ chỉ dẫn cho Claude code ngay. | `directory`, `stepId`, `autoCheckpoint` (mặc định: true) |
| `duo_handoff_plan` | Lập bản kế hoạch chi tiết lưu vào file `PLAN.md` và `.duo/handoff.json` để chia tách và theo dõi từng bước. | `title` (bắt buộc), `task`, `summary`, `steps`, `conventions`, `directory`, `planner`, `executor` |
| `duo_get_handoff_plan` | Lấy toàn bộ kế hoạch, danh sách file cần sửa và hướng dẫn từng bước để thực thi. | `directory` |
| `duo_update_handoff_status` | Cập nhật tiến độ của từng bước (`in_progress`, `completed`, `failed`). Tự động đánh dấu tickbox trong file `PLAN.md`. | `stepId` (bắt buộc), `status` (bắt buộc), `note`, `directory` |
| `duo_orchestrate` | Chạy toàn bộ quy trình đa tác tử tự động (Architect ➔ Builder ➔ Auditor). Hỗ trợ chọn nhanh preset hoặc ghi đè model theo task. | `task` (bắt buộc), `directory`, `autoAccept`, `effort`, `preset`, `model`, `architectModel`, `builderModel`, `auditorModel` |
| `duo_switch_model` | Đổi mô hình AI hoặc Preset mặc định (lưu vĩnh viễn vào `~/.duo/config.json`) trực tiếp từ chat mà không cần mở terminal. | `preset`, `model`, `architect`, `builder`, `auditor`, `effort` |
| `duo_codegraph` | Quét khung AST cấu trúc project (<10ms), trả về cây symbols classes/functions, lọc nhiễu. | `directory`, `maxFiles` |
| `duo_git_checkpoint` | Tạo checkpoint an toàn trước khi chỉnh sửa file. | `directory` |
| `duo_git_rollback` | Hoàn tác thay đổi về checkpoint gần nhất (`/undo`). | `directory` |
| `duo_detect_stack` | Nhận diện ngôn ngữ, framework, quy ước `.duorules` và lệnh test của dự án. | `directory` |
| `duo_status` | Kiểm tra model đang cấu hình, trạng thái API key và readiness của các vai trò. | (Không) |

---

## 2. Quy trình Phối hợp Claude Code ➔ Antigravity CLI (`agy`)

```text
┌────────────────────────────────┐
│          CLAUDE CODE           │  (Orchestrator & Coder chính)
└───────────────┬────────────────┘
                │
                │ 1. duo_inspect_repo / duo_handoff_plan / duo_execute_plan
                ▼
         [ DUO-MCP SERVER ]
                │
                │ 2. duo_agy_delegate (khi cần context lớn / review chéo / web)
                ▼
┌────────────────────────────────┐
│     ANTIGRAVITY CLI (`agy`)    │  (Chạy ngầm trên máy: Gemini 3.8 / Claude)
└────────────────────────────────┘
```

* **Lập kế hoạch & Thực thi**: Claude trực tiếp dùng `duo_handoff_plan` và `duo_execute_plan` để điều khiển tiến độ theo từng bước trong `PLAN.md`.
* **Xử lý tác vụ nặng**: Khi gặp log lớn, grep repo sâu, hoặc cần review chéo, Claude gọi `duo_agy_delegate` để Antigravity CLI xử lý hộ mà không tốn token.

---

## 3. Cài Đặt & Cấu Hình

### Thêm vào cấu hình Claude MCP

Mở file cấu hình Claude MCP (`~/.claude.json`):

```json
{
  "mcpServers": {
    "duo-mcp": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/Users/macbook/.duo/server/dist/index.js"
      ]
    }
  }
}
```

Hoặc thêm nhanh bằng lệnh:
```bash
claude mcp add -s user duo-mcp -- node /Users/macbook/.duo/server/dist/index.js
```

---

## 4. Cách Sử Dụng Trong Khung Chat

Khi đã bật MCP, bạn có thể ra lệnh trực tiếp trong Claude / Antigravity:

* **Ủy quyền cho Antigravity CLI (`agy`) xử lý context lớn hoặc review chéo (Không cần API key)**:
  > *"Dùng tool duo_agy_delegate để đọc file log lớn và tóm tắt các lỗi gần nhất."*
  >
  > *"Dùng duo_agy_delegate với model 'claude-opus-4-6-thinking' để review chéo kiến trúc và tìm edge cases trong code vừa viết."*
  >
  > *"Dùng duo_agy_delegate với model 'gemini-3.8-flash-medium' để thực thi nhanh task này."*

* **Theo dõi tiến độ thực tế theo thời gian thực (Real-time Live Monitoring)**:
  Khi `duo_agy_delegate` đang chạy ngầm, bạn có thể mở một terminal riêng để theo dõi từng bước đọc/sửa file và kết quả:
  ```bash
  # Xem trực tiếp log stream từ Antigravity
  tail -f ~/.duo/live.log

  # Hoặc xem tóm tắt bước chạy và trạng thái file thay đổi
  ~/.duo/watch_agy.sh
  ```

* **Chạy task phức tạp bằng đa tác tử**:
  > *"Dùng tool duo_orchestrate để bổ sung tính năng xuất file dữ liệu cho module đơn hàng."*

* **Chạy task với Preset hoặc Model cụ thể (chỉ áp dụng cho task này)**:
  > *"Dùng duo_orchestrate với preset 'offline' để sửa bug này hoàn toàn miễn phí bằng Ollama."*
  >
  > *"Dùng duo_orchestrate với model 'claude-opus-5-5' để thiết kế và triển khai module thanh toán."*

* **Đổi vĩnh viễn mô hình cấu hình của Duo Agent từ chat**:
  > *"Gọi tool duo_switch_model để chuyển sang preset 'claude_pure'."*
  >
  > *"Gọi duo_switch_model với builder='gemini-3.8-flash' để tăng tốc độ sinh code."*

* **Phân tích nhanh cấu trúc dự án**:
  > *"Hãy gọi duo_codegraph để xem tổng quan kiến trúc của dự án trước khi lập kế hoạch."*

* **Bảo vệ an toàn mã nguồn**:
  > *"Tạo git checkpoint bằng duo_git_checkpoint trước khi bắt đầu sửa code."*

---

## 5. Phát Triển & Kiểm Thử

```bash
# Cài đặt dependencies
npm install

# Biên dịch TypeScript
npm run build

# Chạy unit tests
npm test
```

---

## 6. Liên Kết Liên Quan

* **Core Engine**: [Duo-Agent Repository](https://github.com/mquand/Duo-Agent) - Autonomous multi-agent orchestrator & rapid CodeGraph CLI engine.

