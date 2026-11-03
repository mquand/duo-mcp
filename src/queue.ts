import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { DuoBridge } from './bridge.js';

export interface QueueTaskInput {
  id?: string;
  name?: string;
  prompt: string;
  directory?: string;
  targetFiles?: string[];
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'off';
  timeoutMinutes?: number;
  autoCompile?: boolean;
}

export interface ActiveTaskInfo {
  id: string;
  name: string;
  directory: string;
  targetFiles: string[];
  startedAt: number;
  status: 'running';
  logFile: string;
}

export interface QueuedTaskInfo {
  id: string;
  name: string;
  directory: string;
  targetFiles: string[];
  enqueuedAt: number;
  queueReason: string;
}

export interface TaskExecutionResult {
  id: string;
  name: string;
  directory: string;
  targetFiles: string[];
  status: 'completed' | 'failed' | 'timeout';
  exitCode: number;
  output: string;
  compileOutput?: string;
  durationMs: number;
  waitedInQueueMs: number;
  concurrencyMode: 'parallel' | 'queued';
  queueReason?: string;
  logFile: string;
}

interface InternalQueueItem {
  input: QueueTaskInput;
  id: string;
  name: string;
  canonicalDir: string;
  canonicalFiles: string[];
  enqueuedAt: number;
  queueReason?: string;
  waitedInQueueMs: number;
  resolve: (result: TaskExecutionResult) => void;
  reject: (err: any) => void;
}

export class DuoExecutionQueue {
  private activeTasks = new Map<string, ActiveTaskInfo>();
  private waitingQueue: InternalQueueItem[] = [];
  private taskCounter = 0;

  private getQueueLogPath(): string {
    return path.join(os.homedir(), '.duo', 'queue.log');
  }

  private async logQueue(msg: string): Promise<void> {
    const p = this.getQueueLogPath();
    await fs.ensureDir(path.dirname(p));
    const timestamp = new Date().toISOString();
    await fs.appendFile(p, `[${timestamp}] ${msg}\n`).catch(() => {});
  }

  /**
   * Determine if an incoming task conflicts with any currently running active task.
   * Conflict rule:
   * 1. Same repository directory (canonical path match)
   * 2. Or overlapping targetFiles (file collision)
   */
  private checkConflict(
    canonicalDir: string,
    canonicalFiles: string[]
  ): { hasConflict: boolean; reason?: string; conflictingTaskName?: string } {
    for (const active of this.activeTasks.values()) {
      const activeCanonicalDir = path.resolve(active.directory);

      // Check file overlap first
      if (canonicalFiles.length > 0 && active.targetFiles.length > 0) {
        const activeCanonicalFiles = active.targetFiles.map((f) => path.resolve(activeCanonicalDir, f));
        const overlap = canonicalFiles.filter((f) => activeCanonicalFiles.includes(f));
        if (overlap.length > 0) {
          return {
            hasConflict: true,
            reason: `Cùng sửa file: ${overlap.map((f) => path.basename(f)).join(', ')}`,
            conflictingTaskName: active.name,
          };
        }
      }

      // Check same repository
      if (activeCanonicalDir === canonicalDir) {
        return {
          hasConflict: true,
          reason: `Cùng repo: ${path.basename(canonicalDir)}`,
          conflictingTaskName: active.name,
        };
      }
    }

    return { hasConflict: false };
  }

  /**
   * Enqueue a single task and return a promise that resolves when the task finishes.
   */
  async enqueue(task: QueueTaskInput): Promise<TaskExecutionResult> {
    this.taskCounter++;
    const id = task.id || `task_${Date.now()}_${this.taskCounter}`;
    const name = task.name || `Task #${this.taskCounter}`;
    const canonicalDir = path.resolve(task.directory || process.cwd());
    const canonicalFiles = (task.targetFiles || []).map((f) => path.resolve(canonicalDir, f));

    return new Promise<TaskExecutionResult>((resolve, reject) => {
      const item: InternalQueueItem = {
        input: task,
        id,
        name,
        canonicalDir,
        canonicalFiles,
        enqueuedAt: Date.now(),
        waitedInQueueMs: 0,
        resolve,
        reject,
      };

      const conflict = this.checkConflict(canonicalDir, canonicalFiles);
      if (conflict.hasConflict) {
        item.queueReason = `${conflict.reason} (đang được xử lý bởi "${conflict.conflictingTaskName}")`;
        this.waitingQueue.push(item);
        this.logQueue(`⏳ QUEUED: "${name}" (${id}) - Lý do: ${item.queueReason}`);
      } else {
        // Can run immediately
        this.runTask(item, 'parallel');
      }
    });
  }

  private async runTask(item: InternalQueueItem, mode: 'parallel' | 'queued'): Promise<void> {
    const startTime = Date.now();
    const safeName = item.name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const taskLogFile = path.join(os.homedir(), '.duo', `live_${safeName}_${item.id}.log`);

    const activeInfo: ActiveTaskInfo = {
      id: item.id,
      name: item.name,
      directory: item.canonicalDir,
      targetFiles: item.input.targetFiles || [],
      startedAt: startTime,
      status: 'running',
      logFile: taskLogFile,
    };

    this.activeTasks.set(item.id, activeInfo);
    await this.logQueue(`🚀 STARTING [${mode.toUpperCase()}]: "${item.name}" (ID: ${item.id}) trong ${item.canonicalDir}`);

    try {
      // Execute via DuoBridge with dedicated log file
      const result = await DuoBridge.executeViaAgy({
        prompt: item.input.prompt,
        model: item.input.model,
        effort: item.input.effort,
        directory: item.canonicalDir,
        timeoutMinutes: item.input.timeoutMinutes,
        autoCompile: item.input.autoCompile,
        customLogFile: taskLogFile,
      });

      const endTime = Date.now();
      const executionResult: TaskExecutionResult = {
        id: item.id,
        name: item.name,
        directory: item.canonicalDir,
        targetFiles: item.input.targetFiles || [],
        status: result.exitCode === 0 ? 'completed' : 'failed',
        exitCode: result.exitCode,
        output: result.output,
        compileOutput: result.compileOutput,
        durationMs: endTime - startTime,
        waitedInQueueMs: item.waitedInQueueMs,
        concurrencyMode: mode,
        queueReason: item.queueReason,
        logFile: taskLogFile,
      };

      await this.logQueue(`✅ FINISHED: "${item.name}" (ID: ${item.id}) - Mã thoát: ${result.exitCode} (${Math.round((endTime - startTime) / 1000)}s)`);
      item.resolve(executionResult);
    } catch (err: any) {
      const endTime = Date.now();
      await this.logQueue(`❌ ERROR: "${item.name}" (ID: ${item.id}) - ${err.message || String(err)}`);
      item.resolve({
        id: item.id,
        name: item.name,
        directory: item.canonicalDir,
        targetFiles: item.input.targetFiles || [],
        status: 'failed',
        exitCode: 1,
        output: `Error executing task: ${err.message || String(err)}`,
        durationMs: endTime - startTime,
        waitedInQueueMs: item.waitedInQueueMs,
        concurrencyMode: mode,
        queueReason: item.queueReason,
        logFile: taskLogFile,
      });
    } finally {
      this.activeTasks.delete(item.id);
      this.processNextInQueue();
    }
  }

  /**
   * After any task finishes, check waiting queue and dispatch any tasks whose conflicts are resolved.
   */
  private processNextInQueue(): void {
    if (this.waitingQueue.length === 0) return;

    const remainingWaiting: InternalQueueItem[] = [];

    for (const waitingItem of this.waitingQueue) {
      const conflict = this.checkConflict(waitingItem.canonicalDir, waitingItem.canonicalFiles);
      if (!conflict.hasConflict) {
        // Can run now!
        waitingItem.waitedInQueueMs = Date.now() - waitingItem.enqueuedAt;
        this.runTask(waitingItem, 'queued');
      } else {
        // Still conflicting, update reason and keep in waiting queue
        waitingItem.queueReason = `${conflict.reason} (đang chờ "${conflict.conflictingTaskName}" xong)`;
        remainingWaiting.push(waitingItem);
      }
    }

    this.waitingQueue = remainingWaiting;
  }

  /**
   * Execute a batch of tasks. Independent tasks run concurrently in parallel,
   * while tasks touching the same repo or same files are safely queued.
   */
  async executeBatch(tasks: QueueTaskInput[]): Promise<TaskExecutionResult[]> {
    if (!tasks || tasks.length === 0) {
      return [];
    }

    // Launch all through the queue system
    const promises = tasks.map((t) => this.enqueue(t));
    return Promise.all(promises);
  }

  /**
   * Return current live status of the queue.
   */
  getStatus(): {
    activeCount: number;
    queuedCount: number;
    activeTasks: ActiveTaskInfo[];
    queuedTasks: QueuedTaskInfo[];
  } {
    const active = Array.from(this.activeTasks.values());
    const queued: QueuedTaskInfo[] = this.waitingQueue.map((item) => ({
      id: item.id,
      name: item.name,
      directory: item.canonicalDir,
      targetFiles: item.input.targetFiles || [],
      enqueuedAt: item.enqueuedAt,
      queueReason: item.queueReason || 'Waiting for resources',
    }));

    return {
      activeCount: active.length,
      queuedCount: queued.length,
      activeTasks: active,
      queuedTasks: queued,
    };
  }
}

// Global Singleton Instance
export const globalDuoQueue = new DuoExecutionQueue();
