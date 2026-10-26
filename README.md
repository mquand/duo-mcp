# Duo-MCP Server

Model Context Protocol (MCP) Server for [**Duo-Agent**](https://github.com/mquand/Duo-Agent).

Expose [Duo-Agent](https://github.com/mquand/Duo-Agent)'s autonomous multi-agent orchestrator (Architect -> Builder -> Auditor) and rapid CodeGraph engine to **Claude Desktop**, **Claude Code**, **Claude Extension (VS Code / Cursor / Windsurf)**, and **Antigravity**.

> [!NOTE]
> Dự án này đóng vai trò MCP Server kết nối với CLI [**Duo-Agent**](https://github.com/mquand/Duo-Agent). Người dùng thích dòng lệnh vẫn sử dụng `duo-agent` qua terminal bình thường, trong khi `duo-mcp` phục vụ các IDE / Extension cần giao tiếp qua chuẩn MCP.

---

## 1. Tính năng & Tools Cung Cấp

| Tool Name | Mô tả | Tham số |
| :--- | :--- | :--- |
| `duo_inspect_repo` | **[Tất cả trong 1]** Khảo sát & Bảo vệ mã nguồn: Tự động quét khung CodeGraph AST (<10ms), nhận diện Stack/Lệnh test/Quy ước, và tạo Git Safety Checkpoint bảo vệ code chỉ trong 1 lệnh duy nhất. | `directory`, `maxFiles`, `checkpoint` (mặc định: true) |
| `duo_execute_plan` | **[Tất cả trong 1]** Kích hoạt thực thi kế hoạch: Tự động tạo Git Checkpoint an toàn, nhận diện stack/test, nạp plan, chuyển bước sang `IN_PROGRESS` và trả về toàn bộ chỉ dẫn cho Antigravity code ngay. | `directory`, `stepId`, `autoCheckpoint` (mặc định: true) |
| `duo_handoff_plan` | Claude (Planner) gửi bản kế hoạch chi tiết cho Antigravity (Builder) thực thi. Tự động sinh file `PLAN.md` và `.duo/handoff.json`. | `title` (bắt buộc), `task`, `summary`, `steps` (danh sách bước, files, instruction, verification), `conventions`, `directory`, `planner`, `executor` |
| `duo_get_handoff_plan` | Antigravity (Builder) lấy toàn bộ kế hoạch, danh sách file cần sửa và hướng dẫn từng bước để thực thi. | `directory` |
| `duo_update_handoff_status` | Cập nhật tiến độ của từng bước (`in_progress`, `completed`, `failed`). Tự động đánh dấu tickbox trong file `PLAN.md`. | `stepId` (bắt buộc), `status` (bắt buộc), `note`, `directory` |
| `duo_orchestrate` | Chạy toàn bộ quy trình đa tác tử tự động (Architect ➔ Builder ➔ Auditor). Hỗ trợ chọn nhanh preset hoặc ghi đè model theo task. | `task` (bắt buộc), `directory`, `autoAccept`, `effort`, `preset`, `model`, `architectModel`, `builderModel`, `auditorModel` |
| `duo_switch_model` | Đổi mô hình AI hoặc Preset mặc định (lưu vĩnh viễn vào `~/.duo/config.json`) trực tiếp từ chat mà không cần mở terminal. | `preset`, `model`, `architect`, `builder`, `auditor`, `effort` |
| `duo_codegraph` | Quét khung AST cấu trúc project (<10ms), trả về cây symbols classes/functions, lọc nhiễu. | `directory`, `maxFiles` |
| `duo_git_checkpoint` | Tạo checkpoint an toàn trước khi chỉnh sửa file. | `directory` |
| `duo_git_rollback` | Hoàn tác thay đổi về checkpoint gần nhất (`/undo`). | `directory` |
| `duo_detect_stack` | Nhận diện ngôn ngữ, framework, quy ước `.duorules` và lệnh test của dự án. | `directory` |
| `duo_status` | Kiểm tra model đang cấu hình, trạng thái API key và readiness của các vai trò. | (Không) |

---

## 2. Quy trình Phối hợp Claude (Planner) ➔ Antigravity (Executor) trong VS Code

Khi bạn cài đặt đồng thời 2 Extension **Claude** và **Antigravity** trong VS Code:

```text
┌────────────────────────────────┐         ┌────────────────────────────────┐
│      Extension 1: CLAUDE       │         │    Extension 2: ANTIGRAVITY    │
│       (Architect/Planner)      │         │        (Builder/Executor)      │
└───────────────┬────────────────┘         └────────────────┬───────────────┘
                │                                           ▲
                │ 1. Gọi duo_handoff_plan                   │ 2. Gọi duo_get_handoff_plan
                ▼                                           │
         ┌──────────────────────────────────────────────────┴───────────────┐
         │                        DUO-MCP SERVER                            │
         │  - Sinh file PLAN.md trực quan với checklist                      │
         │  - Lưu trạng thái cấu trúc vào .duo/handoff.json                 │
         └──────────────────────────────────┬───────────────────────────────┘
                                            │ 3. Gọi duo_update_handoff_status
                                            ▼
                                   [ Codebase + Live PLAN.md ]
```

### Bước 1: Bên Extension Claude (Lập kế hoạch)
Bạn giao việc cho Claude:
> *"Hãy phân tích yêu cầu này, dùng `duo_codegraph` khảo sát codebase và dùng tool `duo_handoff_plan` để lên bản kế hoạch chi tiết cho Antigravity thực thi."*

Claude sẽ gọi `duo_handoff_plan`:
* Tự động sinh file **`PLAN.md`** ngay trong thư mục project với các task checklist dạng `- [ ] Step 1...`.
* Ghi nhận đầy đủ: Files cần tác động, hướng dẫn logic cụ thể, lệnh test/verify cho từng bước.

### Bước 2: Bên Extension Antigravity (Thực thi)
Bạn chỉ cần mở khung chat Antigravity và nhắn:
> *"Hãy gọi `duo_get_handoff_plan` và lần lượt thực thi các bước trong kế hoạch, sau mỗi bước hãy cập nhật trạng thái bằng `duo_update_handoff_status`."*

Antigravity sẽ:
1. Đọc plan chi tiết, mở đúng các file cần sửa.
2. Cập nhật bước sang `in_progress`.
3. Viết code, chạy lệnh test kiểm tra.
4. Cập nhật bước sang `completed` ➔ Tickbox `[x]` trong file `PLAN.md` sẽ tự động được đánh dấu!

---

## 3. Cài Đặt & Cấu Hình

### A. Dành cho Claude Extension / Claude Desktop

Mở file cấu hình MCP của Claude:
* **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
* **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Thêm cấu hình sau:

```json
{
  "mcpServers": {
    "duo-mcp": {
      "command": "node",
      "args": [
        "/path/to/duo-mcp/dist/index.js"
      ]
    }
  }
}
```

### B. Dành cho Antigravity

Trong Antigravity, thêm cấu hình vào file `.agents/mcp_config.json` (ở workspace) hoặc `~/.gemini/config/mcp_config.json` (toàn cục):

```json
{
  "mcpServers": {
    "duo-mcp": {
      "command": "node",
      "args": [
        "/path/to/duo-mcp/dist/index.js"
      ]
    }
  }
}
```

---

## 4. Cách Sử Dụng Trong Khung Chat

Khi đã bật MCP, bạn có thể ra lệnh trực tiếp trong Claude / Antigravity:

* **Chạy task phức tạp bằng đa tác tử**:
  > *"Dùng tool duo_orchestrate để bổ sung tính năng xuất file Excel cho đơn hàng trong thư mục hiện tại."*

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

