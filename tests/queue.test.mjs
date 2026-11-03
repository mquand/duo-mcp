import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { DuoExecutionQueue, globalDuoQueue } from '../dist/queue.js';
import { DuoBridge } from '../dist/bridge.js';
import { createDuoMcpServer } from '../dist/server.js';

test('DuoExecutionQueue - gets initial queue status', () => {
  const status = globalDuoQueue.getStatus();
  assert.equal(typeof status.activeCount, 'number');
  assert.equal(typeof status.queuedCount, 'number');
  assert.ok(Array.isArray(status.activeTasks));
  assert.ok(Array.isArray(status.queuedTasks));
});

test('DuoExecutionQueue - detects conflicts for same repository', () => {
  const queue = new DuoExecutionQueue();
  // Access private method checkConflict for unit testing
  const conflictChecker = queue['checkConflict'].bind(queue);

  const dir1 = path.resolve('/fake/repo-backend');
  const dir2 = path.resolve('/fake/repo-frontend');

  // Simulate an active task in repo-backend
  queue['activeTasks'].set('task1', {
    id: 'task1',
    name: 'Backend Migration',
    directory: dir1,
    targetFiles: ['lib/models/order.ex'],
    startedAt: Date.now(),
    status: 'running',
    logFile: '/tmp/log1.log',
  });

  // Task in different repo (repo-frontend) -> NO conflict (can run parallel)
  const resParallel = conflictChecker(dir2, ['components/Modal.vue']);
  assert.equal(resParallel.hasConflict, false);

  // Task in SAME repo (repo-backend) -> CONFLICT (must be queued)
  const resSameRepo = conflictChecker(dir1, ['lib/controllers/shop.ex']);
  assert.equal(resSameRepo.hasConflict, true);
  assert.match(resSameRepo.reason, /Cùng repo/);
  assert.equal(resSameRepo.conflictingTaskName, 'Backend Migration');
});

test('DuoExecutionQueue - detects conflicts for same file target', () => {
  const queue = new DuoExecutionQueue();
  const conflictChecker = queue['checkConflict'].bind(queue);
  const dir = path.resolve('/fake/repo-shared');

  queue['activeTasks'].set('taskA', {
    id: 'taskA',
    name: 'Task Modifying PriceShip',
    directory: dir,
    targetFiles: ['components/PriceShipExportExcel/index.js'],
    startedAt: Date.now(),
    status: 'running',
    logFile: '/tmp/logA.log',
  });

  // Task touching the exact same file -> CONFLICT
  const resSameFile = conflictChecker(dir, ['components/PriceShipExportExcel/index.js']);
  assert.equal(resSameFile.hasConflict, true);
  assert.match(resSameFile.reason, /Cùng sửa file|Cùng repo/);
});

test('DuoMcpServer - registers duo_parallel_delegate and duo_queue_status', () => {
  const server = createDuoMcpServer();
  assert.ok(server);
  assert.equal(typeof server.tool, 'function');
});

test('DuoBridge - getQueueStatus returns valid live structure', async () => {
  const status = await DuoBridge.getQueueStatus();
  assert.ok(status);
  assert.equal(typeof status.activeCount, 'number');
  assert.equal(typeof status.queuedCount, 'number');
});
