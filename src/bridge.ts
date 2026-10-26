import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawn, execSync } from 'child_process';
import { stripVTControlCharacters } from 'util';
import os from 'os';
import dotenv from 'dotenv';
import { HandoffManager, HandoffPlan, HandoffStep, HandoffStepInput } from './handoff.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class DuoBridge {
  private static cachedDuoPath: string | null = null;

  /**
   * Resolve root directory of duo-agent project
   */
  static getDuoAgentDir(): string {
    if (this.cachedDuoPath) return this.cachedDuoPath;

    // 1. Check environment variable
    if (process.env.DUO_AGENT_PATH && fs.existsSync(process.env.DUO_AGENT_PATH)) {
      this.cachedDuoPath = path.resolve(process.env.DUO_AGENT_PATH);
      return this.cachedDuoPath;
    }

    // 2. Check sibling directory ../duo-agent
    const sibling = path.resolve(__dirname, '../../duo-agent');
    if (fs.existsSync(sibling) && fs.existsSync(path.join(sibling, 'dist', 'index.js'))) {
      this.cachedDuoPath = sibling;
      return this.cachedDuoPath;
    }

    // 3. Check current working directory parent
    const cwdSibling = path.resolve(process.cwd(), '../duo-agent');
    if (fs.existsSync(cwdSibling) && fs.existsSync(path.join(cwdSibling, 'dist', 'index.js'))) {
      this.cachedDuoPath = cwdSibling;
      return this.cachedDuoPath;
    }

    // Default fallback
    this.cachedDuoPath = sibling;
    return this.cachedDuoPath;
  }

  static getDuoEntrypoint(): string {
    return path.join(this.getDuoAgentDir(), 'dist', 'index.js');
  }

  /**
   * Dynamically import a compiled module from duo-agent/dist
   */
  static async importDuoModule<T = any>(relativePath: string): Promise<T> {
    const fullPath = path.join(this.getDuoAgentDir(), 'dist', relativePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Duo-Agent compiled module not found at: ${fullPath}. Please run 'npm run build' inside duo-agent.`);
    }
    const url = pathToFileURL(fullPath).href;
    return await import(url);
  }

  /**
   * Scan project AST structure via CodeGraph (with resilient fallback)
   */
  static async scanCodeGraph(targetDir?: string, maxFiles: number = 100): Promise<string> {
    const cwd = targetDir ? path.resolve(targetDir) : process.cwd();
    try {
      const { CodeGraph } = await this.importDuoModule('core/codegraph.js');
      return await CodeGraph.generateSkeleton(cwd, maxFiles);
    } catch {
      return await this.fallbackScanSkeleton(cwd, maxFiles);
    }
  }

  /**
   * Detect stack conventions and rule files (with resilient fallback)
   */
  static async detectStack(targetDir?: string): Promise<{
    type: string;
    language: string;
    ruleFile?: string;
    ruleContent?: string;
    testCommand?: string;
  }> {
    const cwd = targetDir ? path.resolve(targetDir) : process.cwd();
    try {
      const { ProjectDetector } = await this.importDuoModule('detector/project.js');
      const project = await ProjectDetector.detect(cwd);
      return {
        type: project.type,
        language: project.language,
        ruleFile: project.ruleFile,
        ruleContent: project.ruleContent,
        testCommand: project.testCommand,
      };
    } catch {
      return await this.fallbackDetectStack(cwd);
    }
  }

  /**
   * Create git safety checkpoint (with resilient fallback)
   */
  static async createCheckpoint(targetDir?: string): Promise<string> {
    const cwd = targetDir ? path.resolve(targetDir) : process.cwd();
    const origCwd = process.cwd();
    try {
      process.chdir(cwd);
      const { GitGuard } = await this.importDuoModule('core/git-guard.js');
      const ref = await GitGuard.createCheckpoint();
      return ref || 'no-checkpoint-needed';
    } catch {
      return await this.fallbackCreateCheckpoint(cwd);
    } finally {
      process.chdir(origCwd);
    }
  }

  /**
   * Rollback git to latest checkpoint (with resilient fallback)
   */
  static async rollback(targetDir?: string): Promise<{ success: boolean; message: string }> {
    const cwd = targetDir ? path.resolve(targetDir) : process.cwd();
    const origCwd = process.cwd();
    try {
      process.chdir(cwd);
      const { GitGuard } = await this.importDuoModule('core/git-guard.js');
      const ok = await GitGuard.rollback();
      return {
        success: ok,
        message: ok ? 'Rollback completed successfully.' : 'Rollback failed or working tree already clean.',
      };
    } catch {
      return await this.fallbackRollback(cwd);
    } finally {
      process.chdir(origCwd);
    }
  }

  static loadDuoEnv() {
    const envPath = path.join(os.homedir(), '.duo', '.env');
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }
  }

  static checkKeyForProvider(provider: string, explicitKey?: string): boolean {
    this.loadDuoEnv();
    if (explicitKey) return true;
    if (provider === 'openai-compatible') return true; // Local Ollama
    if (provider === 'anthropic') return !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
    if (provider === 'google') return !!process.env.GEMINI_API_KEY;
    if (provider === 'openai') return !!process.env.OPENAI_API_KEY;
    if (provider === 'deepseek') return !!process.env.DEEPSEEK_API_KEY;
    return false;
  }

  /**
   * Inspect active configuration (checks real API keys needed for duo_orchestrate)
   */
  static async getConfigStatus(): Promise<{
    roles: {
      architect: { provider: string; model: string; effort?: string; hasKey: boolean };
      builder: { provider: string; model: string; effort?: string; hasKey: boolean };
      auditor: { provider: string; model: string; effort?: string; hasKey: boolean };
    };
    missingKeys: string[];
    language: string;
    theme: string;
  }> {
    this.loadDuoEnv();
    try {
      const { ConfigManager } = await this.importDuoModule('config/manager.js');
      const config = await ConfigManager.loadConfig();

      const archHasKey = this.checkKeyForProvider(config.roles.architect.provider, config.roles.architect.apiKey);
      const bldHasKey = this.checkKeyForProvider(config.roles.builder.provider, config.roles.builder.apiKey);
      const audHasKey = this.checkKeyForProvider(config.roles.auditor.provider, config.roles.auditor.apiKey);

      const missing: string[] = [];
      if (!archHasKey) missing.push(`Architect (${config.roles.architect.provider}: thiếu ANTHROPIC_API_KEY trong ~/.duo/.env cho duo_orchestrate)`);
      if (!bldHasKey) missing.push(`Builder (${config.roles.builder.provider}: thiếu GEMINI_API_KEY trong ~/.duo/.env cho duo_orchestrate)`);
      if (!audHasKey) missing.push(`Auditor (${config.roles.auditor.provider}: thiếu ANTHROPIC_API_KEY trong ~/.duo/.env cho duo_orchestrate)`);

      return {
        roles: {
          architect: {
            provider: config.roles.architect.provider,
            model: config.roles.architect.model,
            effort: config.roles.architect.reasoningEffort,
            hasKey: archHasKey,
          },
          builder: {
            provider: config.roles.builder.provider,
            model: config.roles.builder.model,
            effort: config.roles.builder.reasoningEffort,
            hasKey: bldHasKey,
          },
          auditor: {
            provider: config.roles.auditor.provider,
            model: config.roles.auditor.model,
            effort: config.roles.auditor.reasoningEffort,
            hasKey: audHasKey,
          },
        },
        missingKeys: missing,
        language: config.language || 'vi',
        theme: config.theme || 'cyber',
      };
    } catch {
      return await this.fallbackGetConfigStatus();
    }
  }

  /**
   * Execute full multi-agent orchestration via Duo-Agent CLI in child process
   */
  static async executeOrchestration(params: {
    task: string;
    directory?: string;
    autoAccept?: boolean;
    effort?: 'low' | 'medium' | 'high' | 'off';
    preset?: string;
    model?: string;
    architectModel?: string;
    builderModel?: string;
    auditorModel?: string;
  }): Promise<{ output: string; exitCode: number }> {
    const targetDir = params.directory ? path.resolve(params.directory) : process.cwd();
    const entrypoint = this.getDuoEntrypoint();

    if (!fs.existsSync(entrypoint)) {
      throw new Error(
        `Duo-Agent CLI entrypoint not found at ${entrypoint}.\nPlease configure DUO_AGENT_PATH or run 'npm run build' inside duo-agent.`
      );
    }

    const args = [entrypoint, params.task];
    if (params.autoAccept !== false) {
      args.push('--auto-accept');
    }
    if (params.effort) {
      args.push('--effort', params.effort);
    }
    if (params.preset) {
      args.push('--preset', params.preset);
    }
    if (params.model) {
      args.push('-m', params.model);
    }
    if (params.architectModel) {
      args.push('--architect', params.architectModel);
    }
    if (params.builderModel) {
      args.push('--builder', params.builderModel);
    }
    if (params.auditorModel) {
      args.push('--auditor', params.auditorModel);
    }

    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: targetDir,
        env: {
          ...process.env,
          FORCE_COLOR: '0', // Disable chalk colors for cleaner markdown
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf-8');
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf-8');
        process.stderr.write(chunk);
      });

      child.on('close', (code) => {
        const fullOutput = stripVTControlCharacters((stdout + (stderr ? '\n[STDERR]\n' + stderr : '')).trim());
        resolve({
          output: fullOutput,
          exitCode: code ?? 0,
        });
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Persistently switch or update active AI models and presets
   */
  static async switchConfigModel(params: {
    preset?: string;
    model?: string;
    architect?: string;
    builder?: string;
    auditor?: string;
    reasoningEffort?: 'low' | 'medium' | 'high' | 'off';
  }): Promise<{
    success: boolean;
    message: string;
    configStatus: Awaited<ReturnType<typeof DuoBridge.getConfigStatus>>;
  }> {
    try {
      const { ConfigManager } = await this.importDuoModule('config/manager.js');
      let config = await ConfigManager.loadConfig();

      if (params.preset) {
        const presetRoles = ConfigManager.getPreset(params.preset);
        if (!presetRoles) {
          throw new Error(
            `Unknown preset '${params.preset}'. Valid options: offline, claude_pure, openai_pure, gemini_pure, deepseek_pure, hybrid, fast, codestral.`
          );
        }
        config.roles = { ...config.roles, ...presetRoles };
      }

      if (params.model) {
        const singleRole = ConfigManager.resolveRole(params.model);
        config.roles.architect = { ...singleRole, reasoningEffort: 'medium' };
        config.roles.builder = { ...singleRole, reasoningEffort: 'off' };
        config.roles.auditor = { ...singleRole, reasoningEffort: 'medium' };
      }

      if (params.architect) {
        config.roles.architect = ConfigManager.resolveRole(params.architect, 'medium');
      }
      if (params.builder) {
        config.roles.builder = ConfigManager.resolveRole(params.builder, 'off');
      }
      if (params.auditor) {
        config.roles.auditor = ConfigManager.resolveRole(params.auditor, 'medium');
      }

      if (params.reasoningEffort) {
        config.roles.architect.reasoningEffort = params.reasoningEffort;
        config.roles.builder.reasoningEffort = params.reasoningEffort;
        config.roles.auditor.reasoningEffort = params.reasoningEffort;
      }

      await ConfigManager.saveConfig(config);
      const updatedStatus = await this.getConfigStatus();

      return {
        success: true,
        message: 'Duo Agent model configuration updated successfully.',
        configStatus: updatedStatus,
      };
    } catch {
      // Direct config file update fallback
      return await this.fallbackSwitchConfigModel(params);
    }
  }

  // ==========================================
  // HANDOFF COLLABORATION (Claude -> Antigravity)
  // ==========================================

  static async saveHandoffPlan(params: {
    title: string;
    task: string;
    summary: string;
    steps: HandoffStepInput[];
    conventions?: string;
    directory?: string;
    planner?: string;
    executor?: string;
  }): Promise<{ plan: HandoffPlan; planMarkdownPath: string; planJsonPath: string }> {
    return await HandoffManager.savePlan(params);
  }

  static async getHandoffPlan(directory?: string): Promise<HandoffPlan | null> {
    return await HandoffManager.getPlan(directory);
  }

  static async updateHandoffStep(params: {
    stepId: number;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    note?: string;
    directory?: string;
  }): Promise<{ plan: HandoffPlan; planMarkdownPath: string }> {
    return await HandoffManager.updateStepStatus(params);
  }

  /**
   * ALL-IN-ONE Plan Execution Trigger:
   * 1. Auto-creates git safety checkpoint
   * 2. Detects project stack and test commands
   * 3. Sets current step to in_progress
   * 4. Returns complete payload for executor
   */
  static async startPlanExecution(params: {
    directory?: string;
    stepId?: number;
    autoCheckpoint?: boolean;
  }): Promise<{
    plan: HandoffPlan;
    currentStep: HandoffStep;
    checkpointRef?: string;
    stack: { type: string; language: string; testCommand?: string; ruleFile?: string };
    planMarkdownPath: string;
  }> {
    const cwd = params.directory ? path.resolve(params.directory) : process.cwd();
    const plan = await HandoffManager.getPlan(cwd);
    if (!plan) {
      throw new Error('No active handoff plan found in this project. Ask Claude to create one first using duo_handoff_plan.');
    }

    let checkpointRef: string | undefined;
    if (params.autoCheckpoint !== false) {
      checkpointRef = await this.createCheckpoint(cwd);
    }

    const stack = await this.detectStack(cwd);

    let targetStep = plan.steps.find((s) => s.id === params.stepId);
    if (!targetStep) {
      targetStep = plan.steps.find((s) => s.status !== 'completed') || plan.steps[0];
    }

    const { plan: updatedPlan, planMarkdownPath } = await HandoffManager.updateStepStatus({
      stepId: targetStep.id,
      status: 'in_progress',
      directory: cwd,
    });

    return {
      plan: updatedPlan,
      currentStep: updatedPlan.steps.find((s) => s.id === targetStep!.id) || targetStep,
      checkpointRef,
      stack,
      planMarkdownPath,
    };
  }

  /**
   * ALL-IN-ONE Survey & Guard:
   * 1. Scans CodeGraph structure skeleton
   * 2. Detects Stack, framework, conventions, and test runner
   * 3. Creates atomic Git safety checkpoint
   */
  static async inspectAndGuard(params?: {
    directory?: string;
    maxFiles?: number;
    createCheckpoint?: boolean;
  }): Promise<{
    checkpointRef?: string;
    stack: { type: string; language: string; testCommand?: string; ruleFile?: string; ruleContent?: string };
    skeleton: string;
  }> {
    const cwd = params?.directory ? path.resolve(params.directory) : process.cwd();
    const maxFiles = params?.maxFiles ?? 100;

    let checkpointRef: string | undefined;
    if (params?.createCheckpoint !== false) {
      checkpointRef = await this.createCheckpoint(cwd);
    }

    const [stack, skeleton] = await Promise.all([
      this.detectStack(cwd),
      this.scanCodeGraph(cwd, maxFiles),
    ]);

    return {
      checkpointRef,
      stack,
      skeleton,
    };
  }

  // ==========================================
  // RESILIENT FALLBACK IMPLEMENTATIONS
  // ==========================================

  private static async fallbackScanSkeleton(cwd: string, maxFiles: number): Promise<string> {
    const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.nuxt', 'coverage', '.cache']);
    const files: string[] = [];

    const walk = async (dir: string) => {
      if (files.length >= maxFiles) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (files.length >= maxFiles) break;
        const full = path.join(dir, entry.name);
        const rel = path.relative(cwd, full);
        if (entry.isDirectory()) {
          if (!ignoredDirs.has(entry.name) && !entry.name.startsWith('.')) {
            await walk(full);
          }
        } else if (entry.isFile()) {
          files.push(rel);
        }
      }
    };

    await walk(cwd);

    const lines = [`Project Root: ${cwd}`, `Scanned Files: ${files.length} (Cap: ${maxFiles})`, ''];
    for (const f of files.slice(0, maxFiles)) {
      lines.push(`├── ${f}`);
    }
    return lines.join('\n');
  }

  private static async fallbackDetectStack(cwd: string) {
    let type = 'unknown';
    let language = 'unknown';
    let testCommand = '';
    let ruleFile: string | undefined;
    let ruleContent: string | undefined;

    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      type = 'nodejs';
      language = fs.existsSync(path.join(cwd, 'tsconfig.json')) ? 'typescript' : 'javascript';
      try {
        const pkg = await fs.readJson(pkgPath);
        if (pkg.scripts?.test) {
          testCommand = 'npm test';
        }
      } catch {
        // ignore
      }
    } else if (fs.existsSync(path.join(cwd, 'pom.xml'))) {
      type = 'java-maven';
      language = 'java';
      testCommand = 'mvn test';
    } else if (fs.existsSync(path.join(cwd, 'go.mod'))) {
      type = 'golang';
      language = 'go';
      testCommand = 'go test ./...';
    } else if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
      type = 'rust';
      language = 'rust';
      testCommand = 'cargo test';
    }

    const checkRules = ['.duorules', 'CLAUDE.md', 'AGENT.md', '.agents/rules.md'];
    for (const r of checkRules) {
      const full = path.join(cwd, r);
      if (fs.existsSync(full)) {
        ruleFile = r;
        ruleContent = await fs.readFile(full, 'utf-8');
        break;
      }
    }

    return { type, language, testCommand, ruleFile, ruleContent };
  }

  private static async fallbackCreateCheckpoint(cwd: string): Promise<string> {
    try {
      const ref = execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf-8' }).trim();
      return `git-head-${ref}`;
    } catch {
      return 'no-git-repository';
    }
  }

  private static async fallbackRollback(cwd: string): Promise<{ success: boolean; message: string }> {
    try {
      execSync('git checkout -- .', { cwd, stdio: 'ignore' });
      return { success: true, message: 'Working directory restored via git checkout.' };
    } catch (err: any) {
      return { success: false, message: `Git rollback failed: ${err.message}` };
    }
  }

  private static async fallbackGetConfigStatus() {
    const configPath = path.join(os.homedir(), '.duo', 'config.json');
    let config: any = null;
    if (fs.existsSync(configPath)) {
      try {
        config = await fs.readJson(configPath);
      } catch {
        // ignore
      }
    }

    const archProvider = config?.roles?.architect?.provider || 'anthropic';
    const bldProvider = config?.roles?.builder?.provider || 'google';
    const audProvider = config?.roles?.auditor?.provider || 'anthropic';

    const archHasKey = this.checkKeyForProvider(archProvider, config?.roles?.architect?.apiKey);
    const bldHasKey = this.checkKeyForProvider(bldProvider, config?.roles?.builder?.apiKey);
    const audHasKey = this.checkKeyForProvider(audProvider, config?.roles?.auditor?.apiKey);

    const missing: string[] = [];
    if (!archHasKey) missing.push(`Architect (${archProvider}: thiếu ANTHROPIC_API_KEY trong ~/.duo/.env cho duo_orchestrate)`);
    if (!bldHasKey) missing.push(`Builder (${bldProvider}: thiếu GEMINI_API_KEY trong ~/.duo/.env cho duo_orchestrate)`);
    if (!audHasKey) missing.push(`Auditor (${audProvider}: thiếu ANTHROPIC_API_KEY trong ~/.duo/.env cho duo_orchestrate)`);

    return {
      roles: {
        architect: {
          provider: archProvider,
          model: config?.roles?.architect?.model || 'claude-opus-5-5',
          effort: config?.roles?.architect?.reasoningEffort || 'medium',
          hasKey: archHasKey,
        },
        builder: {
          provider: bldProvider,
          model: config?.roles?.builder?.model || 'gemini-3.8-flash',
          effort: config?.roles?.builder?.reasoningEffort || 'off',
          hasKey: bldHasKey,
        },
        auditor: {
          provider: audProvider,
          model: config?.roles?.auditor?.model || 'claude-opus-5-5',
          effort: config?.roles?.auditor?.reasoningEffort || 'medium',
          hasKey: audHasKey,
        },
      },
      missingKeys: missing,
      language: config?.language || 'vi',
      theme: config?.theme || 'cyber',
    };
  }

  private static async fallbackSwitchConfigModel(params: any) {
    const configDir = path.join(os.homedir(), '.duo');
    const configPath = path.join(configDir, 'config.json');
    await fs.ensureDir(configDir);

    let config: any = {};
    if (fs.existsSync(configPath)) {
      try {
        config = await fs.readJson(configPath);
      } catch {
        config = {};
      }
    }

    if (!config.roles) {
      config.roles = {
        architect: { provider: 'anthropic', model: 'claude-opus-5-5' },
        builder: { provider: 'google', model: 'gemini-3.8-flash' },
        auditor: { provider: 'anthropic', model: 'claude-opus-5-5' },
      };
    }

    if (params.model) {
      config.roles.architect.model = params.model;
      config.roles.builder.model = params.model;
      config.roles.auditor.model = params.model;
    }
    if (params.architect) config.roles.architect.model = params.architect;
    if (params.builder) config.roles.builder.model = params.builder;
    if (params.auditor) config.roles.auditor.model = params.auditor;
    if (params.reasoningEffort) {
      config.roles.architect.reasoningEffort = params.reasoningEffort;
      config.roles.builder.reasoningEffort = params.reasoningEffort;
      config.roles.auditor.reasoningEffort = params.reasoningEffort;
    }

    await fs.writeJson(configPath, config, { spaces: 2 });
    const status = await this.fallbackGetConfigStatus();

    return {
      success: true,
      message: 'Model configuration updated in ~/.duo/config.json',
      configStatus: status,
    };
  }
}
