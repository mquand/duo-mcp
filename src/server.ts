import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DuoBridge } from './bridge.js';

export function createDuoMcpServer(): McpServer {
  const server = new McpServer({
    name: 'duo-mcp',
    version: '1.0.0',
  });

  // 1. duo_orchestrate
  server.tool(
    'duo_orchestrate',
    'Standalone CLI orchestrator (requires local duo-agent CLI build). NOTE FOR EXTENSIONS: If you are an AI assistant in VS Code (like Claude or Antigravity) coordinating via OAuth/Web login, DO NOT use this tool; use "duo_handoff_plan" to create the plan for Antigravity (Gemini) instead.',
    {
      task: z.string().describe('The task instructions, bug to fix, or feature to build.'),
      directory: z.string().optional().describe('Target project directory path (default: current working directory).'),
      autoAccept: z.boolean().optional().default(true).describe('Automatically approve the Architect plan without interactive prompt (default: true).'),
      effort: z.enum(['low', 'medium', 'high', 'off']).optional().describe('Reasoning effort / thinking budget (low, medium, high, off).'),
      preset: z
        .enum(['offline', 'claude_pure', 'openai_pure', 'gemini_pure', 'deepseek_pure', 'hybrid', 'fast', 'codestral'])
        .optional()
        .describe('Predefined model preset to use for this task without modifying global config.'),
      model: z
        .string()
        .optional()
        .describe('Override all 3 roles with a single model for this task (e.g. claude-opus-5-5, claude-sonnet-5-5, gemini-3.8-flash, gpt-4o, deepseek-chat, qwen2.5-coder:32b).'),
      architectModel: z.string().optional().describe('Override only the Architect model for this task.'),
      builderModel: z.string().optional().describe('Override only the Builder model for this task.'),
      auditorModel: z.string().optional().describe('Override only the Auditor model for this task.'),
    },
    async ({ task, directory, autoAccept, effort, preset, model, architectModel, builderModel, auditorModel }) => {
      try {
        const result = await DuoBridge.executeOrchestration({
          task,
          directory,
          autoAccept: autoAccept ?? true,
          effort,
          preset,
          model,
          architectModel,
          builderModel,
          auditorModel,
        });

        const statusText = result.exitCode === 0 ? 'Workflow completed successfully.' : `Workflow exited with code ${result.exitCode}.`;

        return {
          content: [
            {
              type: 'text',
              text: `### Duo Agent Orchestration Result\n\n**Status**: ${statusText}\n\n\`\`\`text\n${result.output}\n\`\`\``,
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: 'text',
              text: `⚠️ **Duo CLI standalone entrypoint not found.** (${err.message || String(err)})\n\n` +
                `💡 **Hướng dẫn cho AI (Claude / Antigravity)**:\n` +
                `Vì bạn đang chạy trong môi trường Extension (dùng OAuth / Web Login), bạn KHÔNG CẦN gọi CLI bên ngoài.\n` +
                `Hãy dùng tool **\`duo_handoff_plan\`** để trực tiếp lưu kế hoạch chi tiết cho task "${task}" vào file \`PLAN.md\`. Sau đó Antigravity (Gemini) sẽ gọi \`duo_get_handoff_plan\` để thực thi!`,
            },
          ],
        };
      }
    }
  );

  // 2. duo_codegraph
  server.tool(
    'duo_codegraph',
    'Rapid AST skeleton & structure scanner (<10ms). Extracts file tree, exported classes, methods, and types while filtering noise (node_modules, build dirs).',
    {
      directory: z.string().optional().describe('Project directory to scan (default: current directory).'),
      maxFiles: z.number().optional().default(100).describe('Maximum number of files to summarize (default: 100).'),
    },
    async ({ directory, maxFiles }) => {
      try {
        const skeleton = await DuoBridge.scanCodeGraph(directory, maxFiles ?? 100);
        return {
          content: [
            {
              type: 'text',
              text: `### Project CodeGraph Skeleton\n\n\`\`\`text\n${skeleton}\n\`\`\``,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to generate CodeGraph: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }
  );

  // 3. duo_git_checkpoint
  server.tool(
    'duo_git_checkpoint',
    'Create an atomic git safety checkpoint before modifying code so changes can be reverted instantly.',
    {
      directory: z.string().optional().describe('Git repository directory path (default: current directory).'),
    },
    async ({ directory }) => {
      try {
        const checkpointRef = await DuoBridge.createCheckpoint(directory);
        return {
          content: [
            {
              type: 'text',
              text: `Safety checkpoint created: [${checkpointRef.slice(0, 7)}] (Ref: ${checkpointRef})`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to create git checkpoint: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }
  );

  // 4. duo_git_rollback
  server.tool(
    'duo_git_rollback',
    'Roll back working tree to the latest checkpoint, removing uncommitted edits made by agents while preserving user untracked files.',
    {
      directory: z.string().optional().describe('Git repository directory path (default: current directory).'),
    },
    async ({ directory }) => {
      try {
        const res = await DuoBridge.rollback(directory);
        return {
          content: [
            {
              type: 'text',
              text: res.message,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Rollback failed: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }
  );

  // 5. duo_detect_stack
  server.tool(
    'duo_detect_stack',
    'Detect repository stack (language, framework, rules file such as .duorules or CLAUDE.md, and test runner command).',
    {
      directory: z.string().optional().describe('Project directory to inspect (default: current directory).'),
    },
    async ({ directory }) => {
      try {
        const stack = await DuoBridge.detectStack(directory);
        const details = [
          `- **Stack Type**: ${stack.type.toUpperCase()}`,
          `- **Language**: ${stack.language}`,
          stack.ruleFile ? `- **Rules File**: \`${stack.ruleFile}\`` : '- **Rules File**: (None detected)',
          stack.testCommand ? `- **Test Command**: \`${stack.testCommand}\`` : '',
        ].filter(Boolean).join('\n');

        const ruleSection = stack.ruleContent ? `\n\n### Repository Conventions:\n\`\`\`markdown\n${stack.ruleContent}\n\`\`\`` : '';

        return {
          content: [
            {
              type: 'text',
              text: `### Project Stack Detection\n\n${details}${ruleSection}`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to detect project stack: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }
  );

  // 6. duo_status
  server.tool(
    'duo_status',
    'Inspect active Duo Agent configuration: Architect, Builder, Auditor roles, active models, and credential readiness.',
    {},
    async () => {
      try {
        const status = await DuoBridge.getConfigStatus();
        const roleLines = [
          `| Role | Model | Provider | API Key Ready (cho duo_orchestrate) |`,
          `| :--- | :--- | :--- | :--- |`,
          `| Architect | \`${status.roles.architect.model}\` | ${status.roles.architect.provider} | ${status.roles.architect.hasKey ? '✅ ĐÃ CÓ' : '❌ CHƯA CÓ'} |`,
          `| Builder | \`${status.roles.builder.model}\` | ${status.roles.builder.provider} | ${status.roles.builder.hasKey ? '✅ ĐÃ CÓ' : '❌ CHƯA CÓ'} |`,
          `| Auditor | \`${status.roles.auditor.model}\` | ${status.roles.auditor.provider} | ${status.roles.auditor.hasKey ? '✅ ĐÃ CÓ' : '❌ CHƯA CÓ'} |`,
        ].join('\n');

        const missingNotice = status.missingKeys.length > 0
          ? `\n\n> ⚠️ **Lưu ý về API Key cho tool \`duo_orchestrate\`**:\n> Khi chạy \`duo_orchestrate\`, CLI gọi API cloud độc lập nên cần API key thật trong \`~/.duo/.env\`:\n${status.missingKeys.map((k) => `> • ${k}`).join('\n')}\n>\n> 💡 *Ngược lại, nếu bạn dùng luồng Handoff (\`duo_handoff_plan\` & \`duo_get_handoff_plan\`), bạn **KHÔNG CẦN** API key vì các Extension tự dùng phiên đăng nhập có sẵn.*`
          : '\n\n**Credentials**: Tất cả API key đã sẵn sàng cho `duo_orchestrate`.';

        return {
          content: [
            {
              type: 'text',
              text: `### Duo Agent Status\n\n${roleLines}${missingNotice}\n\n- **Language**: ${status.language}\n- **Theme**: ${status.theme}`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to retrieve Duo Agent status: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }
  );

  // 7. duo_switch_model
  server.tool(
    'duo_switch_model',
    'Persistently switch active AI models or presets in Duo Agent config (~/.duo/config.json). Supports instant switching to offline Ollama (free) or cloud models (Claude, OpenAI, Gemini, DeepSeek).',
    {
      preset: z
        .enum(['offline', 'claude_pure', 'openai_pure', 'gemini_pure', 'deepseek_pure', 'hybrid', 'fast', 'codestral'])
        .optional()
        .describe('Switch to a predefined model configuration bundle.'),
      model: z
        .string()
        .optional()
        .describe('Set all 3 roles (Architect, Builder, Auditor) to this single model (e.g. claude-opus-5-5, claude-sonnet-5-5, gemini-3.8-flash, gpt-4o, deepseek-chat, qwen2.5-coder:32b).'),
      architect: z.string().optional().describe('Set Architect model specifically.'),
      builder: z.string().optional().describe('Set Builder model specifically.'),
      auditor: z.string().optional().describe('Set Auditor model specifically.'),
      effort: z.enum(['low', 'medium', 'high', 'off']).optional().describe('Set default reasoning effort.'),
    },
    async ({ preset, model, architect, builder, auditor, effort }) => {
      try {
        const res = await DuoBridge.switchConfigModel({
          preset,
          model,
          architect,
          builder,
          auditor,
          reasoningEffort: effort,
        });

        const status = res.configStatus;
        const roleLines = [
          `| Role | Model | Provider | API Key Ready (cho duo_orchestrate) |`,
          `| :--- | :--- | :--- | :--- |`,
          `| Architect | \`${status.roles.architect.model}\` | ${status.roles.architect.provider} | ${status.roles.architect.hasKey ? '✅ ĐÃ CÓ' : '❌ CHƯA CÓ'} |`,
          `| Builder | \`${status.roles.builder.model}\` | ${status.roles.builder.provider} | ${status.roles.builder.hasKey ? '✅ ĐÃ CÓ' : '❌ CHƯA CÓ'} |`,
          `| Auditor | \`${status.roles.auditor.model}\` | ${status.roles.auditor.provider} | ${status.roles.auditor.hasKey ? '✅ ĐÃ CÓ' : '❌ CHƯA CÓ'} |`,
        ].join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `### Duo Agent Model Configuration Updated\n\n${roleLines}\n\n*Saved to \`~/.duo/config.json\`.*`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to switch Duo Agent model: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }
  );

  // 8. duo_handoff_plan
  server.tool(
    'duo_handoff_plan',
    'LẬP KẾ HOẠCH BÀN GIAO (Claude ➔ Antigravity/Gemini). Kích hoạt khi người dùng yêu cầu: "dùng duo-mcp lên plan", "lên plan cho task", "lập kế hoạch chi tiết", "tạo plan". Tự động sinh file PLAN.md và .duo/handoff.json.',
    {
      title: z.string().describe('Short descriptive title of the task or feature.'),
      task: z.string().describe('Original user request or issue description.'),
      summary: z.string().describe('High-level architectural approach and strategy for the executor.'),
      steps: z
        .array(
          z.object({
            title: z.string().describe('Name of this implementation step.'),
            files: z.array(z.string()).optional().describe('List of files to create or modify in this step.'),
            instruction: z.string().describe('Clear, detailed instructions on what code changes or actions to take.'),
            verification: z.string().optional().describe('Command or check to verify this step (e.g., test command, lint).'),
          })
        )
        .describe('Ordered list of implementation steps.'),
      conventions: z.string().optional().describe('Coding conventions, tech stack rules, or constraints to adhere to.'),
      directory: z.string().optional().describe('Target project directory path (default: current directory).'),
      planner: z.string().optional().default('claude').describe('Name of the planning agent/extension (default: claude).'),
      executor: z.string().optional().default('antigravity').describe('Target executor extension (default: antigravity).'),
    },
    async ({ title, task, summary, steps, conventions, directory, planner, executor }) => {
      try {
        const result = await DuoBridge.saveHandoffPlan({
          title,
          task,
          summary,
          steps,
          conventions,
          directory,
          planner: planner || 'claude',
          executor: executor || 'antigravity',
        });

        const stepList = result.plan.steps
          .map((s) => `  ${s.id}. **${s.title}** (${s.files.length > 0 ? s.files.join(', ') : 'no files specified'})`)
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `### 📋 Handoff Plan Created Successfully!\n\n- **Title**: ${result.plan.title}\n- **Planner**: \`${result.plan.planner}\` ➔ **Target Executor**: \`${result.plan.executor}\`\n- **Steps**: ${result.plan.totalSteps}\n- **Markdown Plan**: \`${result.planMarkdownPath}\`\n- **JSON State**: \`${result.planJsonPath}\`\n\n#### Steps Overview:\n${stepList}\n\n*In Antigravity, tell the agent: "Call duo_get_handoff_plan and execute the planned steps."*`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to create handoff plan: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }
  );

  // 9. duo_get_handoff_plan
  server.tool(
    'duo_get_handoff_plan',
    'Retrieve the active architectural execution plan submitted by the Planner (Claude) for Antigravity to execute step-by-step.',
    {
      directory: z.string().optional().describe('Target project directory path (default: current directory).'),
    },
    async ({ directory }) => {
      try {
        const plan = await DuoBridge.getHandoffPlan(directory);
        if (!plan) {
          return {
            content: [
              {
                type: 'text',
                text: 'No active handoff plan found in this project. Ask Claude to create one first using `duo_handoff_plan`.',
              },
            ],
          };
        }

        const stepsDetail = plan.steps
          .map((s) => {
            const statusIcon = s.status === 'completed' ? '✅' : s.status === 'in_progress' ? '🔄' : s.status === 'failed' ? '❌' : '⏳';
            const files = s.files.length > 0 ? `\n  - **Target Files**: ${s.files.map((f) => `\`${f}\``).join(', ')}` : '';
            const verify = s.verification ? `\n  - **Verify Command**: \`${s.verification}\`` : '';
            const note = s.note ? `\n  - **Note**: *${s.note}*` : '';
            return `### Step ${s.id}: ${s.title} [${statusIcon} ${s.status.toUpperCase()}]${files}\n  - **Instruction**: ${s.instruction}${verify}${note}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `## 📋 Active Execution Plan: ${plan.title}\n\n> **Planner**: \`${plan.planner}\` | **Executor**: \`${plan.executor}\` | **Progress**: ${plan.completedSteps}/${plan.totalSteps} steps completed\n\n### Task Overview\n${plan.task}\n\n### Strategy\n${plan.summary}\n\n${plan.conventions ? `### Conventions\n${plan.conventions}\n\n` : ''}## Steps Checklist\n\n${stepsDetail}\n\n---\n*Execute each step, then call \`duo_update_handoff_status\` with stepId and status ('in_progress' / 'completed' / 'failed') to update progress.*`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to retrieve handoff plan: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }
  );

  // 10. duo_update_handoff_status
  server.tool(
    'duo_update_handoff_status',
    'Update progress of a step in the handoff plan. Automatically updates the live PLAN.md checklist.',
    {
      stepId: z.number().describe('The 1-based step ID to update (e.g. 1, 2, 3).'),
      status: z.enum(['pending', 'in_progress', 'completed', 'failed']).describe('The new status of the step.'),
      note: z.string().optional().describe('Optional note, output summary, or error details.'),
      directory: z.string().optional().describe('Target project directory path (default: current directory).'),
    },
    async ({ stepId, status, note, directory }) => {
      try {
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
              text: `Step ${stepId} updated to **${status.toUpperCase()}**.\n\nOverall Progress: **${plan.completedSteps}/${plan.totalSteps}** steps completed (${plan.status.toUpperCase()}).\nLive checklist updated at: \`${planMarkdownPath}\``,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to update handoff step: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }
  );

  // 11. duo_execute_plan (All-in-One: Checkpoint + Stack + Load Plan + Start Step)
  server.tool(
    'duo_execute_plan',
    'THỰC THI KẾ HOẠCH TẤT CẢ TRONG MỘT (Antigravity/Gemini). Kích hoạt khi người dùng yêu cầu: "dùng duo-mcp thực thi plan", "thực thi plan đã lên", "chấp nhận plan", "bắt đầu thực thi". Tự động tạo Git Checkpoint an toàn, nhận diện stack/test, chuyển bước sang IN_PROGRESS và trả về hướng dẫn chi tiết.',
    {
      stepId: z.number().optional().describe('Specific step ID to start (defaults to next pending step).'),
      autoCheckpoint: z.boolean().optional().default(true).describe('Automatically create git safety checkpoint before modifying code (default: true).'),
      directory: z.string().optional().describe('Target project directory path (default: current working directory).'),
    },
    async ({ stepId, autoCheckpoint, directory }) => {
      try {
        const result = await DuoBridge.startPlanExecution({
          stepId,
          autoCheckpoint,
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
              text: `## 🚀 Plan Execution Triggered (All-in-One)\n\n${checkpointText}\n- **📦 Project Stack**: \`${result.stack.type.toUpperCase()}\` (${result.stack.language})${result.stack.testCommand ? ` | Test Command: \`${result.stack.testCommand}\`` : ''}\n- **📋 Plan**: ${result.plan.title} (Progress: ${result.plan.completedSteps}/${result.plan.totalSteps} completed)\n- **Live Checklist**: \`${result.planMarkdownPath}\`\n\n---\n\n### 👉 Current Step ${step.id}: ${step.title} [🔄 IN_PROGRESS]\n- **Target Files**: ${filesText}\n- **Instructions**: ${step.instruction}${verifyText}\n\n---\n*Antigravity: Proceed to read and apply changes to the target files, run the verify command, then call \`duo_update_handoff_status\` with stepId=${step.id} and status='completed'.*`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to trigger plan execution: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }
  );

  // 12. duo_inspect_repo (All-in-One: Scan CodeGraph + Detect Stack + Git Checkpoint)
  server.tool(
    'duo_inspect_repo',
    'KHẢO SÁT & BẢO VỆ MÃ NGUỒN TẤT CẢ TRONG MỘT. Kích hoạt khi người dùng yêu cầu: "check, khảo sát thực thi mã nguồn", "dùng duo-mcp khảo sát", "khảo sát mã nguồn", "kiểm tra dự án". Tự động quét khung CodeGraph AST (<10ms), nhận diện Stack/Lệnh test/Quy ước, và tạo Git Safety Checkpoint an toàn tất cả trong 1 lượt.',
    {
      directory: z.string().optional().describe('Target project directory (default: current working directory).'),
      maxFiles: z.number().optional().default(100).describe('Maximum number of files to include in CodeGraph scan (default: 100).'),
      checkpoint: z.boolean().optional().default(true).describe('Whether to create an atomic git safety checkpoint (default: true).'),
    },
    async ({ directory, maxFiles, checkpoint }) => {
      try {
        const result = await DuoBridge.inspectAndGuard({
          directory,
          maxFiles,
          createCheckpoint: checkpoint,
        });

        const checkpointLine = result.checkpointRef ? `- **🛡️ Safety Checkpoint**: \`${result.checkpointRef}\`` : '- **🛡️ Safety Checkpoint**: (Skipped)';
        const testCmd = result.stack.testCommand ? ` | Test Runner: \`${result.stack.testCommand}\`` : '';
        const rulesLine = result.stack.ruleFile ? `\n- **Rules File**: \`${result.stack.ruleFile}\`` : '';

        return {
          content: [
            {
              type: 'text',
              text: `### 🔍 Báo Cáo Khảo Sát & Bảo Vệ Mã Nguồn Toàn Diện\n\n${checkpointLine}\n- **📦 Tech Stack**: \`${result.stack.type.toUpperCase()}\` (${result.stack.language})${testCmd}${rulesLine}\n\n#### 🌳 Cấu Trúc Dự Án (CodeGraph Skeleton):\n\`\`\`text\n${result.skeleton}\n\`\`\`\n\n---\n*Hệ thống đã được sao lưu an toàn và khảo sát đầy đủ. Sẵn sàng để lên plan (\`duo_handoff_plan\`) hoặc thực thi.*`,
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

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createDuoMcpServer();
  const transport = new StdioServerTransport();

  process.stderr.write('[duo-mcp] Starting Duo Agent MCP Server over stdio...\n');
  await server.connect(transport);
  process.stderr.write('[duo-mcp] Duo Agent MCP Server connected and listening on stdio.\n');
}
