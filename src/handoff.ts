import path from 'path';
import fs from 'fs-extra';

export interface HandoffStepInput {
  title: string;
  files?: string[];
  instruction: string;
  verification?: string;
}

export interface HandoffStep {
  id: number;
  title: string;
  files: string[];
  instruction: string;
  verification?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  note?: string;
  updatedAt?: string;
}

export interface HandoffPlan {
  id: string;
  title: string;
  task: string;
  summary: string;
  conventions?: string;
  createdAt: string;
  updatedAt: string;
  planner: string;
  executor: string;
  steps: HandoffStep[];
  totalSteps: number;
  completedSteps: number;
  status: 'draft' | 'in_progress' | 'completed';
}

export class HandoffManager {
  private static getPaths(targetDir?: string) {
    const baseDir = targetDir ? path.resolve(targetDir) : process.cwd();
    const duoDir = path.join(baseDir, '.duo');
    const jsonPath = path.join(duoDir, 'handoff.json');
    const markdownPath = path.join(baseDir, 'PLAN.md');
    return { baseDir, duoDir, jsonPath, markdownPath };
  }

  /**
   * Save a newly created handoff plan from the Planner (Claude)
   */
  static async savePlan(params: {
    title: string;
    task: string;
    summary: string;
    steps: HandoffStepInput[];
    conventions?: string;
    directory?: string;
    planner?: string;
    executor?: string;
  }): Promise<{ plan: HandoffPlan; planMarkdownPath: string; planJsonPath: string }> {
    const { duoDir, jsonPath, markdownPath } = this.getPaths(params.directory);

    await fs.ensureDir(duoDir);

    const now = new Date().toISOString();
    const formattedSteps: HandoffStep[] = params.steps.map((s, idx) => ({
      id: idx + 1,
      title: s.title,
      files: s.files || [],
      instruction: s.instruction,
      verification: s.verification,
      status: 'pending',
    }));

    const plan: HandoffPlan = {
      id: `plan_${Date.now()}`,
      title: params.title,
      task: params.task,
      summary: params.summary,
      conventions: params.conventions,
      createdAt: now,
      updatedAt: now,
      planner: params.planner || 'claude',
      executor: params.executor || 'antigravity',
      steps: formattedSteps,
      totalSteps: formattedSteps.length,
      completedSteps: 0,
      status: 'in_progress',
    };

    // Save JSON state
    await fs.writeJson(jsonPath, plan, { spaces: 2 });

    // Generate PLAN.md for IDE viewing
    const markdownContent = this.renderMarkdown(plan);
    await fs.writeFile(markdownPath, markdownContent, 'utf-8');

    return {
      plan,
      planMarkdownPath: markdownPath,
      planJsonPath: jsonPath,
    };
  }

  /**
   * Retrieve the current handoff plan
   */
  static async getPlan(targetDir?: string): Promise<HandoffPlan | null> {
    const { jsonPath } = this.getPaths(targetDir);
    if (!fs.existsSync(jsonPath)) {
      return null;
    }

    try {
      return (await fs.readJson(jsonPath)) as HandoffPlan;
    } catch {
      return null;
    }
  }

  /**
   * Update status of a specific step during execution
   */
  static async updateStepStatus(params: {
    stepId: number;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    note?: string;
    directory?: string;
  }): Promise<{ plan: HandoffPlan; planMarkdownPath: string }> {
    const { jsonPath, markdownPath } = this.getPaths(params.directory);

    if (!fs.existsSync(jsonPath)) {
      throw new Error(`No handoff plan found at ${jsonPath}. Run 'duo_handoff_plan' first.`);
    }

    const plan: HandoffPlan = await fs.readJson(jsonPath);
    const step = plan.steps.find((s) => s.id === params.stepId);
    if (!step) {
      throw new Error(`Step ${params.stepId} not found in plan (Total steps: ${plan.totalSteps}).`);
    }

    const now = new Date().toISOString();
    step.status = params.status;
    if (params.note) {
      step.note = params.note;
    }
    step.updatedAt = now;

    plan.completedSteps = plan.steps.filter((s) => s.status === 'completed').length;
    plan.updatedAt = now;

    if (plan.completedSteps === plan.totalSteps) {
      plan.status = 'completed';
    } else {
      plan.status = 'in_progress';
    }

    // Persist JSON
    await fs.writeJson(jsonPath, plan, { spaces: 2 });

    // Update PLAN.md
    const markdownContent = this.renderMarkdown(plan);
    await fs.writeFile(markdownPath, markdownContent, 'utf-8');

    return { plan, planMarkdownPath: markdownPath };
  }

  /**
   * Render human-readable PLAN.md with reactive markdown checklists
   */
  static renderMarkdown(plan: HandoffPlan): string {
    const progressPercent = plan.totalSteps > 0 ? Math.round((plan.completedSteps / plan.totalSteps) * 100) : 0;
    const progressBar = `[${'█'.repeat(Math.round(progressPercent / 10))}${'░'.repeat(10 - Math.round(progressPercent / 10))}] ${progressPercent}%`;

    const statusBadge =
      plan.status === 'completed' ? '✅ COMPLETED' : plan.status === 'in_progress' ? '🔄 IN PROGRESS' : '📝 DRAFT';

    const header = [
      `# 📋 Execution Plan: ${plan.title}`,
      `> **Planner**: \`${plan.planner}\` | **Executor**: \`${plan.executor}\``,
      `> **Status**: ${statusBadge} | **Progress**: ${progressBar} (${plan.completedSteps}/${plan.totalSteps} steps)`,
      `> **Last Updated**: \`${plan.updatedAt}\``,
      '',
      `## 🎯 Task Objective`,
      plan.task,
      '',
      `## 💡 Architecture & Strategy`,
      plan.summary,
      '',
    ];

    if (plan.conventions) {
      header.push(`## 📐 Conventions & Guidelines`, plan.conventions, '');
    }

    header.push(`## 🚀 Implementation Checklist`, '');

    for (const step of plan.steps) {
      let icon = '[ ]';
      let tag = 'PENDING';
      if (step.status === 'completed') {
        icon = '[x]';
        tag = 'DONE';
      } else if (step.status === 'in_progress') {
        icon = '[-]';
        tag = 'WORKING';
      } else if (step.status === 'failed') {
        icon = '[!]';
        tag = 'FAILED';
      }

      header.push(`- ${icon} **Step ${step.id}: ${step.title}** \`[${tag}]\``);
      if (step.files && step.files.length > 0) {
        header.push(`  - **Files**: ${step.files.map((f) => `\`${f}\``).join(', ')}`);
      }
      header.push(`  - **Instructions**: ${step.instruction}`);
      if (step.verification) {
        header.push(`  - **Verification**: \`${step.verification}\``);
      }
      if (step.note) {
        header.push(`  - **Note**: *${step.note}*`);
      }
      header.push('');
    }

    header.push(
      '---',
      `*Generated by [duo-mcp](https://github.com/mquand/duo-mcp). Managed via \`duo_handoff_plan\` & \`duo_update_handoff_status\`.*`
    );

    return header.join('\n');
  }
}
