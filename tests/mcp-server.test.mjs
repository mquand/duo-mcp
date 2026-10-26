import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuoMcpServer } from '../dist/server.js';
import { DuoBridge } from '../dist/bridge.js';

test('DuoBridge - resolves duo-agent directory properly', () => {
  const dir = DuoBridge.getDuoAgentDir();
  assert.ok(dir);
  assert.match(dir, /duo-agent/);
});

test('DuoBridge - scans codegraph via bridge', async () => {
  const skeleton = await DuoBridge.scanCodeGraph(process.cwd());
  assert.ok(skeleton);
  assert.ok(skeleton.length > 0);
});

test('DuoBridge - detects project stack', async () => {
  const stack = await DuoBridge.detectStack(process.cwd());
  assert.ok(stack.type);
  assert.ok(stack.language);
});

test('DuoMcpServer - registers all expected tools', () => {
  const server = createDuoMcpServer();
  assert.ok(server);
  assert.equal(typeof server.tool, 'function');
});

test('DuoBridge - gets config status', async () => {
  const status = await DuoBridge.getConfigStatus();
  assert.ok(status.roles);
  assert.ok(status.roles.architect);
  assert.ok(status.roles.builder);
  assert.ok(status.roles.auditor);
  assert.ok(Array.isArray(status.missingKeys));
});

test('DuoBridge - saves, retrieves, and updates handoff plan', async () => {
  const testDir = process.cwd();
  const saveRes = await DuoBridge.saveHandoffPlan({
    title: 'Test Feature: Bulk Export',
    task: 'Export orders to excel file',
    summary: 'Use exceljs to stream rows to .xlsx',
    conventions: 'Follow Clean Architecture in TypeScript',
    directory: testDir,
    planner: 'claude',
    executor: 'antigravity',
    steps: [
      {
        title: 'Install exceljs dependency',
        files: ['package.json'],
        instruction: 'Run npm install exceljs',
        verification: 'npm list exceljs',
      },
      {
        title: 'Create ExcelService',
        files: ['src/excel.service.ts'],
        instruction: 'Implement ExcelService class',
        verification: 'npm test',
      },
    ],
  });

  assert.equal(saveRes.plan.title, 'Test Feature: Bulk Export');
  assert.equal(saveRes.plan.totalSteps, 2);
  assert.equal(saveRes.plan.completedSteps, 0);

  // Retrieve plan
  const retrieved = await DuoBridge.getHandoffPlan(testDir);
  assert.ok(retrieved);
  assert.equal(retrieved.title, 'Test Feature: Bulk Export');
  assert.equal(retrieved.steps.length, 2);

  // Update step 1 to in_progress
  const updateRes1 = await DuoBridge.updateHandoffStep({
    stepId: 1,
    status: 'in_progress',
    directory: testDir,
  });
  assert.equal(updateRes1.plan.steps[0].status, 'in_progress');
  assert.equal(updateRes1.plan.completedSteps, 0);

  // Update step 1 to completed
  const updateRes2 = await DuoBridge.updateHandoffStep({
    stepId: 1,
    status: 'completed',
    note: 'exceljs installed without conflict',
    directory: testDir,
  });
  assert.equal(updateRes2.plan.steps[0].status, 'completed');
  assert.equal(updateRes2.plan.completedSteps, 1);
  assert.equal(updateRes2.plan.status, 'in_progress');

  // Update step 2 to completed -> entire plan completed
  const updateRes3 = await DuoBridge.updateHandoffStep({
    stepId: 2,
    status: 'completed',
    directory: testDir,
  });
  assert.equal(updateRes3.plan.completedSteps, 2);
  assert.equal(updateRes3.plan.status, 'completed');
});

test('DuoBridge - startPlanExecution triggers all-in-one execution', async () => {
  const testDir = process.cwd();
  await DuoBridge.saveHandoffPlan({
    title: 'Test All-in-One Execution',
    task: 'Add health check endpoint',
    summary: 'Add /health route',
    directory: testDir,
    steps: [
      {
        title: 'Add route',
        files: ['src/health.ts'],
        instruction: 'Create health router',
        verification: 'npm test',
      },
    ],
  });

  const execRes = await DuoBridge.startPlanExecution({
    directory: testDir,
    autoCheckpoint: true,
  });

  assert.ok(execRes.plan);
  assert.equal(execRes.currentStep.id, 1);
  assert.equal(execRes.currentStep.status, 'in_progress');
  assert.ok(execRes.checkpointRef);
  assert.ok(execRes.stack);
});

test('DuoBridge - inspectAndGuard performs all-in-one survey and checkpoint', async () => {
  const testDir = process.cwd();
  const res = await DuoBridge.inspectAndGuard({
    directory: testDir,
    maxFiles: 50,
    createCheckpoint: true,
  });

  assert.ok(res.skeleton);
  assert.ok(res.skeleton.length > 0);
  assert.ok(res.stack.type);
  assert.ok(res.checkpointRef);
});



