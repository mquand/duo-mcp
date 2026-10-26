#!/usr/bin/env node
import { startMcpServer } from './server.js';

startMcpServer().catch((error) => {
  process.stderr.write(`[duo-mcp] Fatal error: ${error?.stack || error}\n`);
  process.exit(1);
});
