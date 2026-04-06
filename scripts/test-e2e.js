#!/usr/bin/env node
/**
 * Cross-platform E2E test runner.
 *
 * Orchestrates: docker compose up → prisma generate → jest → docker compose down
 * Always tears down Docker regardless of test result, then exits with jest's code.
 */
const { execSync } = require('child_process');

const SCHEMA = 'test/e2e/schema.prisma';
const JEST_CONFIG = 'test/e2e/jest.e2e.config.ts';

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

let exitCode = 0;

try {
  run('docker compose up -d --wait');
  run(`prisma generate --schema=${SCHEMA}`);
  run(`jest --config ${JEST_CONFIG} --runInBand`);
} catch (e) {
  exitCode = e.status || 1;
} finally {
  try {
    run('docker compose down');
  } catch {
    // best-effort cleanup
  }
}

process.exit(exitCode);
