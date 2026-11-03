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
    'Standalone multi-agent CLI orchestrator (Architect -> Builder -> Auditor). Coordinates planning, AST context slicing, and code modifications via configured models.',
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
                `💡 Bạn có thể dùng tool **\`duo_agy_delegate\`** để ủy quyền tác vụ này trực tiếp cho Antigravity CLI (\`agy\`) trên máy mà không cần cài thêm API key.`,
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
          ? `\n\n> ⚠️ **Lưu ý về API Key cho tool \`duo_orchestrate\`**:\n> Khi chạy \`duo_orchestrate\` không qua agy CLI, cần API key trong \`~/.duo/.env\`:\n${status.missingKeys.map((k) => `> • ${k}`).join('\n')}\n>\n> 💡 *Hoặc dùng \`duo_agy_delegate\` để ủy quyền trực tiếp qua Antigravity CLI mà không cần bất kỳ API key nào.*`
          : '\n\n**Credentials**: Sẵn sàng thực thi (qua API key hoặc agy CLI).';

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
    'LẬP KẾ HOẠCH BÀN GIAO THỰC THI (Planner ➔ Executor). Kích hoạt khi người dùng yêu cầu: "dùng duo-mcp lên plan", "lên plan cho task", "lập kế hoạch chi tiết", "tạo plan". Tự động sinh file PLAN.md và .duo/handoff.json.',
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
      planner: z.string().optional().default('claude').describe('Name of the planning agent (default: claude).'),
      executor: z.string().optional().default('agy').describe('Target executor (default: agy).'),
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
    'Retrieve the active architectural execution plan submitted by Planner for Executor to run step-by-step.',
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
    'THỰC THI KẾ HOẠCH TẤT CẢ TRONG MỘT (Claude Code). Kích hoạt khi người dùng yêu cầu: "dùng duo-mcp thực thi plan", "thực thi plan đã lên", "chấp nhận plan", "bắt đầu thực thi", hoặc gõ /duo-execute-plan. Tự động tạo Git Checkpoint an toàn, nhận diện stack/test, chuyển bước sang IN_PROGRESS và trả về hướng dẫn chi tiết.',
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

  // 13. duo_agy_delegate
  server.tool(
    'duo_agy_delegate',
    'ỦY QUYỀN TRỰC TIẾP CHO AGY CLI (Google Gemini / Claude không cần API Key). Dành cho Claude Code ủy quyền tác vụ nặng cho Antigravity CLI (agy) cài sẵn trên máy: đọc context lớn, phân tích repo sâu, review chéo giải pháp, hoặc tra cứu web. Tự động stream log ra ~/.duo/live.log, kiểm tra compile lỗi và cắt tỉa output bảo vệ token.',
    {
      prompt: z.string().describe('Instructions or questions to delegate to agy CLI (e.g. review plan, analyze large files, summarize logs).'),
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
        .describe('Model to execute in agy CLI (default: gemini-3.8-flash-medium for 2-3x faster coding).'),
      effort: z.enum(['low', 'medium', 'high', 'off']).optional().describe('Reasoning effort (low, medium, high, off).'),
      directory: z.string().optional().describe('Working directory context for agy (default: current directory).'),
      timeoutMinutes: z.number().optional().default(10).describe('Maximum timeout in minutes before terminating process (default: 10).'),
      autoCompile: z.boolean().optional().default(true).describe('Automatically verify project compilation after agy finishes (default: true).'),
    },
    async ({ prompt, model, effort, directory, timeoutMinutes, autoCompile }) => {
      try {
        const result = await DuoBridge.executeViaAgy({
          prompt,
          model,
          effort,
          directory,
          timeoutMinutes,
          autoCompile,
        });

        const statusText = result.exitCode === 0 ? 'Success' : `Exit Code ${result.exitCode}`;
        const compileSec = result.compileOutput ? `\n\n#### 🛠️ Auto-Compile Verification:\n\`\`\`text\n${result.compileOutput}\n\`\`\`` : '';

        return {
          content: [
            {
              type: 'text',
              text: `### Antigravity (agy) Response [${statusText} | Model: \`${model || 'gemini-3.8-flash-medium'}\`]\n\n${result.output}${compileSec}`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to delegate task to agy CLI: ${err.message || String(err)}\n\nPlease ensure ~/.gemini/bin/agy is installed and accessible.`,
            },
          ],
        };
      }
    }
  );

  // 14. duo_diff_summary
  server.tool(
    'duo_diff_summary',
    'TÓM TẮT THAY ĐỔI MÃ NGUỒN (Git Diff Summary). Tự động phân tích git status & diff ngắn gọn theo từng file (+thêm/-bớt), giúp Claude nắm bắt nhanh mã vừa sửa mà không cần đọc hàng trăm dòng diff.',
    {
      directory: z.string().optional().describe('Target repository directory path (default: current directory).'),
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

  // 15. duo_undo_step
  server.tool(
    'duo_undo_step',
    'HOÀN TÁC TỪNG BƯỚC RIÊNG BIỆT (Step-Level Undo). Revert các file của một bước con cụ thể mà không làm mất code của các bước khác.',
    {
      stepId: z.number().optional().describe('ID của bước cần hoàn tác (ví dụ 1, 2, 3). Nếu không truyền sẽ rollback về checkpoint gần nhất.'),
      directory: z.string().optional().describe('Target project directory path (default: current directory).'),
    },
    async ({ stepId, directory }) => {
      try {
        const res = await DuoBridge.undoStep({ stepId, directory });
        return {
          content: [{ type: 'text', text: res.message }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Hoàn tác bước thất bại: ${err.message || String(err)}` }],
        };
      }
    }
  );

  // 16. duo_sync_note
  server.tool(
    'duo_sync_note',
    'ĐỒNG BỘ CHECKLIST VÀO NOTE (Sync Markdown Checklist). Tự động đánh dấu tick [x] vào file PLAN.md hoặc note khi một bước nghiệp vụ hoàn thành.',
    {
      stepKeyword: z.string().describe('Từ khóa nhận diện bước trong file note (ví dụ "BE1", "FE2", "migration").'),
      completed: z.boolean().optional().default(true).describe('Đánh dấu hoàn thành [x] (true) hay mở lại [ ] (false).'),
      notePath: z.string().optional().describe('Đường dẫn file note/PLAN.md (mặc định: tự động tìm).'),
      directory: z.string().optional().describe('Target project directory (default: current directory).'),
    },
    async ({ stepKeyword, completed, notePath, directory }) => {
      try {
        const res = await DuoBridge.syncNoteChecklist({
          stepKeyword,
          completed: completed ?? true,
          notePath,
          directory,
        });
        return {
          content: [{ type: 'text', text: res.message }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Lỗi đồng bộ checklist note: ${err.message || String(err)}` }],
        };
      }
    }
  );

  // 17. duo_parallel_delegate
  server.tool(
    'duo_parallel_delegate',
    'THỰC THI NHIỀU NHÁNH / SONG SONG CÓ HÀNG ĐỢI AN TOÀN (Parallel Execution with Queue). Cho phép Claude chạy nhiều subtask đồng thời: Nếu khác repo -> chạy song song (parallel) tăng tốc gấp 2-3 lần; Nếu CÙNG REPO hoặc TRÙNG FILE -> tự động đưa vào HÀNG ĐỢI (Queue) tuần tự an toàn tuyệt đối, tránh conflict git và đè code.',
    {
      tasks: z
        .array(
          z.object({
            name: z.string().describe('Tên phân luồng task (ví dụ: "BE Migration", "FE Modal").'),
            prompt: z.string().describe('Chỉ dẫn thực thi cho agy CLI.'),
            directory: z.string().optional().describe('Thư mục repository dự án mục tiêu (mặc định: cwd).'),
            targetFiles: z.array(z.string()).optional().describe('Danh sách file tác động (nếu trùng file hoặc cùng repo sẽ tự động xếp hàng đợi tuần tự).'),
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
              .describe('Model to execute in agy CLI (default: gemini-3.8-flash-medium).'),
            effort: z.enum(['low', 'medium', 'high', 'off']).optional().describe('Reasoning effort (low, medium, high, off).'),
            timeoutMinutes: z.number().optional().default(10).describe('Timeout per task in minutes (default: 10).'),
            autoCompile: z.boolean().optional().default(true).describe('Verify compilation after task finishes (default: true).'),
          })
        )
        .describe('Danh sách các tasks cần điều phối thực thi.'),
    },
    async ({ tasks }) => {
      try {
        if (!tasks || tasks.length === 0) {
          return {
            content: [{ type: 'text', text: '⚠️ Danh sách tasks rỗng. Vui lòng cung cấp ít nhất 1 task.' }],
          };
        }

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
            ? `> ⚠️ **Đã xếp hàng đợi**: ${r.queueReason} (Thời gian chờ trong queue: ${Math.round(r.waitedInQueueMs / 1000)}s)\n\n`
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
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Điều phối thực thi song song thất bại: ${err.message || String(err)}` }],
        };
      }
    }
  );

  // 18. duo_queue_status
  server.tool(
    'duo_queue_status',
    'KIỂM TRA HÀNG ĐỢI VÀ TIẾN TRÌNH ĐANG CHẠY (Task Queue Status). Xem ngay các luồng AI đang chạy song song, các luồng đang xếp hàng đợi (do cùng repo hoặc trùng file), và đường dẫn log trực tiếp.',
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
                `> 💡 *Quy tắc hàng đợi:* Tasks khác repo sẽ chạy song song. Tasks cùng repo hoặc trùng file sẽ tự động xếp hàng đợi tuần tự để tránh conflict git và đè code.`,
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

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createDuoMcpServer();
  const transport = new StdioServerTransport();

  process.stderr.write('[duo-mcp] Starting Duo Agent MCP Server over stdio...\n');
  await server.connect(transport);
  process.stderr.write('[duo-mcp] Duo Agent MCP Server connected and listening on stdio.\n');
}
