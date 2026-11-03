import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DuoBridge } from './bridge.js';

export function createDuoMcpServer(): McpServer {
  const server = new McpServer({
    name: 'duo-mcp',
    version: '2.0.0',
  });

  // 1. duo_delegate (Core Execution Engine: Single Task or Parallel Batch with Conflict Queue)
  server.tool(
    'duo_delegate',
    'ỦY QUYỀN THỰC THI CHO AGY CLI (Google Gemini / Claude không cần API key). Hỗ trợ chạy đơn lẻ (single task) hoặc đa luồng (nhiều tasks). Tự động nhận diện xung đột: nếu khác repo -> chạy song song (Parallel 2-3x); nếu cùng repo hoặc trùng file -> tự động xếp hàng đợi (Queue) an toàn tuyệt đối. Tự động stream log, kiểm tra compile lỗi và cắt tỉa output bảo vệ context.',
    {
      prompt: z.string().optional().describe('Chỉ dẫn thực thi cho task đơn (hoặc dùng tasks nếu muốn chạy đa luồng).'),
      tasks: z
        .array(
          z.object({
            name: z.string().describe('Tên định danh luồng task (ví dụ: "BE Migration", "FE Component").'),
            prompt: z.string().describe('Chỉ dẫn chi tiết cho agy CLI.'),
            directory: z.string().optional().describe('Thư mục repository mục tiêu (mặc định: cwd).'),
            targetFiles: z.array(z.string()).optional().describe('Danh sách file tác động (nếu cùng repo hoặc trùng file sẽ tự động xếp hàng đợi).'),
            model: z
              .enum([
                'gemini-3.8-flash-high',
                'gemini-3.8-flash-medium',
                'gemini-3.8-flash-low',
                'claude-sonnet-4-6',
                'claude-opus-4-6-thinking',
                'gpt-oss-120b-medium',
              ])
              .optional()
              .default('gemini-3.8-flash-medium')
              .describe('Model to execute in agy CLI (mặc định: gemini-3.8-flash-medium).'),
            effort: z.enum(['low', 'medium', 'high', 'off']).optional().describe('Reasoning effort (low, medium, high, off).'),
            timeoutMinutes: z.number().optional().default(10).describe('Timeout per task in minutes (mặc định: 10).'),
            autoCompile: z.boolean().optional().default(true).describe('Verify compilation after task finishes (mặc định: true).'),
          })
        )
        .optional()
        .describe('Danh sách nhiều tasks để chạy đa luồng có hàng đợi an toàn.'),
      directory: z.string().optional().describe('Thư mục repository mục tiêu cho task đơn (mặc định: cwd).'),
      targetFiles: z.array(z.string()).optional().describe('Danh sách file tác động cho task đơn.'),
      model: z
        .enum([
          'gemini-3.8-flash-high',
          'gemini-3.8-flash-medium',
          'gemini-3.8-flash-low',
          'claude-sonnet-4-6',
          'claude-opus-4-6-thinking',
          'gpt-oss-120b-medium',
        ])
        .optional()
        .default('gemini-3.8-flash-medium')
        .describe('Model to execute in agy CLI (mặc định: gemini-3.8-flash-medium).'),
      effort: z.enum(['low', 'medium', 'high', 'off']).optional().describe('Reasoning effort (low, medium, high, off).'),
      timeoutMinutes: z.number().optional().default(10).describe('Timeout in minutes (mặc định: 10).'),
      autoCompile: z.boolean().optional().default(true).describe('Tự động verify biên dịch dự án sau khi chạy (mặc định: true).'),
    },
    async ({ prompt, tasks, directory, targetFiles, model, effort, timeoutMinutes, autoCompile }) => {
      try {
        // Case A: Multi-task batch execution
        if (tasks && tasks.length > 0) {
          const results = await DuoBridge.executeParallel(tasks);
          const parallelCount = results.filter((r) => r.concurrencyMode === 'parallel').length;
          const queuedCount = results.filter((r) => r.concurrencyMode === 'queued').length;
          const successCount = results.filter((r) => r.status === 'completed').length;

          const tableHeader = [
            `| Task | Chế Độ | File Tác Động | Thời Gian | Trạng Thái |`,
            `| :--- | :--- | :--- | :--- | :--- |`,
          ];

          const tableRows = results.map((r) => {
            const modeIcon = r.concurrencyMode === 'parallel' ? '🚀 Song song' : '⏳ Hàng đợi';
            const statusIcon = r.status === 'completed' ? '✅ Hoàn tất' : '❌ Lỗi';
            const durationStr = `${Math.round(r.durationMs / 1000)}s`;
            const filesStr = r.targetFiles.length > 0 ? r.targetFiles.map((f) => `\`${f}\``).join(', ') : '(Toàn repo)';
            return `| **${r.name}** | ${modeIcon} | ${filesStr} | ${durationStr} | ${statusIcon} |`;
          });

          const detailSections = results.map((r) => {
            const queueNotice = r.concurrencyMode === 'queued'
              ? `> ⚠️ **Đã xếp hàng đợi**: ${r.queueReason} (Thời gian chờ: ${Math.round(r.waitedInQueueMs / 1000)}s)\n\n`
              : '';
            const compileSec = r.compileOutput ? `\n\n**🛠️ Auto-Compile:**\n\`\`\`text\n${r.compileOutput}\n\`\`\`` : '';
            return `### 🔹 [${r.name}] (Thư mục: \`${r.directory}\`)\n${queueNotice}- **Mã thoát**: \`${r.exitCode}\` | **Log stream**: \`${r.logFile}\`\n\n\`\`\`text\n${r.output}\n\`\`\`${compileSec}`;
          }).join('\n\n---\n\n');

          return {
            content: [
              {
                type: 'text',
                text: `## ⚡ Báo Cáo Điều Phối Thực Thi Đa Luồng (Parallel & Queue Engine)\n\n` +
                  `- **Tổng số task**: ${results.length} (✅ Thành công: ${successCount}/${results.length})\n` +
                  `- **Luồng chạy song song (Parallel)**: ${parallelCount} tasks (khác repo/độc lập)\n` +
                  `- **Luồng qua hàng đợi an toàn (Queued)**: ${queuedCount} tasks (cùng repo hoặc trùng file)\n\n` +
                  `${tableHeader.join('\n')}\n${tableRows.join('\n')}\n\n---\n\n${detailSections}`,
              },
            ],
          };
        }

        // Case B: Single task execution
        if (!prompt) {
          return {
            content: [
              {
                type: 'text',
                text: '⚠️ Vui lòng cung cấp `prompt` (nếu chạy task đơn) hoặc mảng `tasks` (nếu chạy nhiều task song song/hàng đợi).',
              },
            ],
          };
        }

        const taskList = [
          {
            name: 'Delegated Task',
            prompt,
            directory,
            targetFiles,
            model,
            effort,
            timeoutMinutes,
            autoCompile,
          },
        ];

        const [res] = await DuoBridge.executeParallel(taskList);
        const statusText = res.exitCode === 0 ? 'Success' : `Exit Code ${res.exitCode}`;
        const queueNotice = res.concurrencyMode === 'queued'
          ? `> ⚠️ **Đã xếp hàng đợi**: ${res.queueReason} (Chờ: ${Math.round(res.waitedInQueueMs / 1000)}s)\n\n`
          : '';
        const compileSec = res.compileOutput ? `\n\n#### 🛠️ Auto-Compile Verification:\n\`\`\`text\n${res.compileOutput}\n\`\`\`` : '';

        return {
          content: [
            {
              type: 'text',
              text: `### Antigravity (agy) Response [${statusText} | Model: \`${model || 'gemini-3.8-flash-medium'}\`]\n\n${queueNotice}- **Thư mục**: \`${res.directory}\` | **Thời gian**: ${Math.round(res.durationMs / 1000)}s | **Log stream**: \`${res.logFile}\`\n\n${res.output}${compileSec}`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Thực thi qua agy CLI thất bại: ${err.message || String(err)}\n\nVui lòng đảm bảo binary ~/.gemini/bin/agy đang hoạt động.`,
            },
          ],
        };
      }
    }
  );

  // 2. duo_inspect (All-in-One: Scan CodeGraph AST + Detect Stack/Rules/Test + Atomic Git Checkpoint)
  server.tool(
    'duo_inspect',
    'KHẢO SÁT & BẢO VỆ MÃ NGUỒN TẤT CẢ TRONG MỘT (All-in-One). Quét nhanh khung cấu trúc AST CodeGraph (<10ms), nhận diện công nghệ (Stack/Framework/Quy ước/Lệnh test), và tự động tạo Git Safety Checkpoint bảo vệ code trước khi chỉnh sửa.',
    {
      directory: z.string().optional().describe('Thư mục repository cần khảo sát (mặc định: current working directory).'),
      maxFiles: z.number().optional().default(100).describe('Số lượng file tối đa quét AST CodeGraph (mặc định: 100).'),
      checkpoint: z.boolean().optional().default(true).describe('Tự động tạo Git Checkpoint an toàn (mặc định: true).'),
    },
    async ({ directory, maxFiles, checkpoint }) => {
      try {
        const result = await DuoBridge.inspectAndGuard({
          directory,
          maxFiles,
          createCheckpoint: checkpoint,
        });

        const checkpointLine = result.checkpointRef ? `- **🛡️ Safety Checkpoint**: \`${result.checkpointRef}\`` : '- **🛡️ Safety Checkpoint**: (Bỏ qua)';
        const testCmd = result.stack.testCommand ? ` | Test Runner: \`${result.stack.testCommand}\`` : '';
        const rulesLine = result.stack.ruleFile ? `\n- **Rules File**: \`${result.stack.ruleFile}\`` : '';

        return {
          content: [
            {
              type: 'text',
              text: `### 🔍 Báo Cáo Khảo Sát & Bảo Vệ Mã Nguồn Toàn Diện\n\n${checkpointLine}\n- **📦 Tech Stack**: \`${result.stack.type.toUpperCase()}\` (${result.stack.language})${testCmd}${rulesLine}\n\n#### 🌳 Cấu Trúc Dự Án (CodeGraph Skeleton):\n\`\`\`text\n${result.skeleton}\n\`\`\`\n\n---\n*Hệ thống đã được sao lưu an toàn và khảo sát đầy đủ. Sẵn sàng thực thi code.*`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Khảo sát mã nguồn thất bại: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }
  );

  // 3. duo_diff (Git Diff Summary: Concise per-file +/- stats)
  server.tool(
    'duo_diff',
    'TÓM TẮT THAY ĐỔI MÃ NGUỒN (Git Diff Summary). Phân tích thay đổi ngắn gọn theo từng file (+thêm/-bớt dòng) sau khi AI sửa xong, giúp nắm bắt ngay kết quả mà không cần nuốt hàng trăm dòng raw diff.',
    {
      directory: z.string().optional().describe('Thư mục repository cần kiểm tra diff (mặc định: current directory).'),
    },
    async ({ directory }) => {
      try {
        const diff = await DuoBridge.getDiffSummary(directory);
        return {
          content: [
            {
              type: 'text',
              text: `### 📊 Tóm Tắt Thay Đổi Mã Nguồn (Git Diff Summary)\n\n- **Số file tác động**: ${diff.filesChanged}\n- **Dòng thêm (+)**: \`+${diff.insertions}\` | **Dòng bớt (-)**: \`-${diff.deletions}\`\n\n#### Chi tiết từng file:\n${diff.summary}`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Lỗi đọc git diff summary: ${err.message || String(err)}` }],
        };
      }
    }
  );

  // 4. duo_rollback (Instant Git Safety Rollback or Step-Level Revert)
  server.tool(
    'duo_rollback',
    'HOÀN TÁC AN TOÀN (Git Rollback & Safety Revert). Khôi phục mã nguồn về checkpoint an toàn gần nhất khi AI gặp lỗi hoặc sinh mã không mong muốn. Có thể hoàn tác toàn bộ hoặc hoàn tác riêng 1 bước.',
    {
      stepId: z.number().optional().describe('Nếu truyền stepId: chỉ hoàn tác riêng các file của bước đó. Nếu bỏ trống: rollback toàn bộ về checkpoint gần nhất.'),
      directory: z.string().optional().describe('Thư mục repository cần rollback (mặc định: current directory).'),
    },
    async ({ stepId, directory }) => {
      try {
        if (stepId !== undefined) {
          const res = await DuoBridge.undoStep({ stepId, directory });
          return { content: [{ type: 'text', text: res.message }] };
        }

        const res = await DuoBridge.rollback(directory);
        return { content: [{ type: 'text', text: res.message }] };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Hoàn tác thất bại: ${err.message || String(err)}` }],
        };
      }
    }
  );

  // 5. duo_queue (Live Process & Queue Monitoring)
  server.tool(
    'duo_queue',
    'GIÁM SÁT TIẾN TRÌNH & HÀNG ĐỢI (Live Queue & Process Monitor). Theo dõi các tiến trình AI đang chạy nền trong từng repo, danh sách các task đang chờ trong hàng đợi (lý do chờ), và file log stream trực tiếp.',
    {},
    async () => {
      try {
        const status = await DuoBridge.getQueueStatus();

        const activeSec = status.activeTasks.length > 0
          ? status.activeTasks.map((t) => {
              const runSec = Math.round((Date.now() - t.startedAt) / 1000);
              const filesStr = t.targetFiles.length > 0 ? `\n  - Files: ${t.targetFiles.join(', ')}` : '';
              return `- 🚀 **${t.name}** (\`${t.id}\`) - Đang chạy được ${runSec}s trong \`${t.directory}\`${filesStr}\n  - Log: \`${t.logFile}\``;
            }).join('\n')
          : '*(Không có tác vụ nào đang chạy nền)*';

        const queueSec = status.queuedTasks.length > 0
          ? status.queuedTasks.map((t) => {
              const waitSec = Math.round((Date.now() - t.enqueuedAt) / 1000);
              const filesStr = t.targetFiles.length > 0 ? ` | Files: ${t.targetFiles.join(', ')}` : '';
              return `- ⏳ **${t.name}** (\`${t.id}\`) - Chờ ${waitSec}s trong \`${t.directory}\`${filesStr}\n  - **Lý do đợi**: ${t.queueReason}`;
            }).join('\n')
          : '*(Hàng đợi đang trống, sẵn sàng nhận task mới)*';

        return {
          content: [
            {
              type: 'text',
              text: `### 🚦 Trạng Thái Hàng Đợi & Tiến Trình AI (Duo Queue Status)\n\n` +
                `- **Đang chạy đồng thời**: ${status.activeCount} tasks\n` +
                `- **Đang xếp hàng đợi**: ${status.queuedCount} tasks\n\n` +
                `#### 🏃 Đang Thực Thi:\n${activeSec}\n\n` +
                `#### ⏱️ Đang Chờ Trong Hàng Đợi (Queue):\n${queueSec}\n\n` +
                `> 💡 *Quy tắc hàng đợi:* Tasks khác repo sẽ chạy song song (Parallel). Tasks cùng repo hoặc trùng file sẽ tự động xếp hàng đợi (Queue) tuần tự để tránh conflict git và đè code.`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Lỗi kiểm tra hàng đợi: ${err.message || String(err)}` }],
        };
      }
    }
  );

  // 6. duo_plan (Unified Plan Manager: Create, Execute, Update, Get, and Sync Notes)
  server.tool(
    'duo_plan',
    'QUẢN LÝ KẾ HOẠCH BÀN GIAO THỰC THI (Unified Plan Manager). Hợp nhất toàn bộ thao tác kế hoạch trong PLAN.md: "execute" (bắt đầu bước tiếp theo và nạp context), "create" (lập plan mới), "update" (cập nhật trạng thái bước), "get" (xem plan), hoặc "sync_note" (đồng bộ checklist vào note).',
    {
      action: z
        .enum(['execute', 'create', 'update', 'get', 'sync_note'])
        .optional()
        .default('execute')
        .describe('Hành động cần làm: "execute" (mặc định: bắt đầu bước tiếp theo), "create" (tạo plan), "update" (đổi status bước), "get" (xem plan), "sync_note" (tick checkbox note).'),
      stepId: z.number().optional().describe('ID của bước (ví dụ: 1, 2, 3).'),
      status: z.enum(['pending', 'in_progress', 'completed', 'failed']).optional().describe('Trạng thái mới khi action="update".'),
      note: z.string().optional().describe('Ghi chú kết quả khi action="update".'),
      title: z.string().optional().describe('Tiêu đề kế hoạch khi action="create".'),
      task: z.string().optional().describe('Mô tả task khi action="create".'),
      summary: z.string().optional().describe('Chiến lược kiến trúc khi action="create".'),
      steps: z
        .array(
          z.object({
            title: z.string(),
            files: z.array(z.string()).optional(),
            instruction: z.string(),
            verification: z.string().optional(),
          })
        )
        .optional()
        .describe('Danh sách bước khi action="create".'),
      conventions: z.string().optional().describe('Quy ước code khi action="create".'),
      stepKeyword: z.string().optional().describe('Từ khóa nhận diện bước khi action="sync_note".'),
      completed: z.boolean().optional().default(true).describe('Đánh dấu [x] (true) hay [ ] (false) khi action="sync_note".'),
      notePath: z.string().optional().describe('Đường dẫn file note khi action="sync_note".'),
      directory: z.string().optional().describe('Thư mục dự án mục tiêu (mặc định: cwd).'),
    },
    async ({
      action,
      stepId,
      status,
      note,
      title,
      task,
      summary,
      steps,
      conventions,
      stepKeyword,
      completed,
      notePath,
      directory,
    }) => {
      try {
        const act = action || 'execute';

        // 1. Execute next step (All-in-One trigger)
        if (act === 'execute') {
          const result = await DuoBridge.startPlanExecution({
            stepId,
            autoCheckpoint: true,
            directory,
          });

          const step = result.currentStep;
          const filesText = step.files && step.files.length > 0 ? step.files.map((f: string) => `\`${f}\``).join(', ') : 'None specified';
          const verifyText = step.verification ? `\n- **Verify Command**: \`${step.verification}\`` : '';
          const checkpointText = result.checkpointRef ? `- **🛡️ Safety Checkpoint**: \`${result.checkpointRef}\`` : '';

          return {
            content: [
              {
                type: 'text',
                text: `## 🚀 Plan Step Triggered\n\n${checkpointText}\n- **📦 Tech Stack**: \`${result.stack.type.toUpperCase()}\` (${result.stack.language})${result.stack.testCommand ? ` | Test: \`${result.stack.testCommand}\`` : ''}\n- **📋 Plan**: ${result.plan.title} (Tiến độ: ${result.plan.completedSteps}/${result.plan.totalSteps} hoàn thành)\n- **Checklist File**: \`${result.planMarkdownPath}\`\n\n---\n\n### 👉 Bước ${step.id}: ${step.title} [🔄 IN_PROGRESS]\n- **File Cần Sửa**: ${filesText}\n- **Hướng Dẫn**: ${step.instruction}${verifyText}\n\n---\n*Sau khi sửa xong, gọi \`duo_plan\` với action="update", stepId=${step.id}, status="completed".*`,
              },
            ],
          };
        }

        // 2. Create new plan
        if (act === 'create') {
          if (!title || !task || !summary || !steps) {
            return {
              content: [{ type: 'text', text: '⚠️ Khi action="create", cần cung cấp đủ: `title`, `task`, `summary`, và `steps`.' }],
            };
          }

          const result = await DuoBridge.saveHandoffPlan({
            title,
            task,
            summary,
            steps,
            conventions,
            directory,
            planner: 'claude',
            executor: 'antigravity',
          });

          const stepList = result.plan.steps
            .map((s) => `  ${s.id}. **${s.title}** (${s.files.length > 0 ? s.files.join(', ') : 'no files specified'})`)
            .join('\n');

          return {
            content: [
              {
                type: 'text',
                text: `### 📋 Kế Hoạch Đã Được Tạo Thành Công!\n\n- **Tiêu đề**: ${result.plan.title}\n- **Số bước**: ${result.plan.totalSteps}\n- **File Markdown**: \`${result.planMarkdownPath}\`\n\n#### Danh sách các bước:\n${stepList}\n\n*Để bắt đầu thực thi bước 1, chỉ cần gọi \`duo_plan\` với action="execute".*`,
              },
            ],
          };
        }

        // 3. Update step status
        if (act === 'update') {
          if (!stepId || !status) {
            return {
              content: [{ type: 'text', text: '⚠️ Khi action="update", cần cung cấp `stepId` và `status`.' }],
            };
          }

          const { plan, planMarkdownPath } = await DuoBridge.updateHandoffStep({
            stepId,
            status,
            note,
            directory,
          });

          return {
            content: [
              {
                type: 'text',
                text: `Bước ${stepId} đã cập nhật sang **${status.toUpperCase()}**.\n\nTiến độ toàn bộ: **${plan.completedSteps}/${plan.totalSteps}** bước hoàn thành (${plan.status.toUpperCase()}).\nFile checklist: \`${planMarkdownPath}\``,
              },
            ],
          };
        }

        // 4. Get active plan
        if (act === 'get') {
          const plan = await DuoBridge.getHandoffPlan(directory);
          if (!plan) {
            return {
              content: [{ type: 'text', text: 'Không tìm thấy kế hoạch nào trong dự án này. Dùng action="create" để tạo mới.' }],
            };
          }

          const stepsDetail = plan.steps
            .map((s) => {
              const statusIcon = s.status === 'completed' ? '✅' : s.status === 'in_progress' ? '🔄' : s.status === 'failed' ? '❌' : '⏳';
              const files = s.files.length > 0 ? `\n  - **Files**: ${s.files.map((f) => `\`${f}\``).join(', ')}` : '';
              return `### Bước ${s.id}: ${s.title} [${statusIcon} ${s.status.toUpperCase()}]${files}\n  - **Chỉ dẫn**: ${s.instruction}`;
            })
            .join('\n\n');

          return {
            content: [
              {
                type: 'text',
                text: `## 📋 Kế Hoạch: ${plan.title} (${plan.completedSteps}/${plan.totalSteps} hoàn tất)\n\n${stepsDetail}`,
              },
            ],
          };
        }

        // 5. Sync note checklist
        if (act === 'sync_note') {
          if (!stepKeyword) {
            return {
              content: [{ type: 'text', text: '⚠️ Khi action="sync_note", cần cung cấp `stepKeyword`.' }],
            };
          }

          const res = await DuoBridge.syncNoteChecklist({
            stepKeyword,
            completed: completed ?? true,
            notePath,
            directory,
          });

          return {
            content: [{ type: 'text', text: res.message }],
          };
        }

        return {
          content: [{ type: 'text', text: `Hành động "${act}" không hợp lệ.` }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Lỗi thao tác kế hoạch: ${err.message || String(err)}` }],
        };
      }
    }
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createDuoMcpServer();
  const transport = new StdioServerTransport();

  process.stderr.write('[duo-mcp] Starting Duo Agent MCP Server v2.0 (Streamlined 6-Tool Architecture)...\n');
  await server.connect(transport);
  process.stderr.write('[duo-mcp] Duo Agent MCP Server v2.0 connected and listening on stdio.\n');
}
