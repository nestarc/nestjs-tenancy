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
const DEFAULT_DATABASE_URL = 'postgresql://tenancy:tenancy@localhost:5433/tenancy_test';
const DEFAULT_APP_DATABASE_URL = 'postgresql://app_user:app_user@localhost:5433/tenancy_test';

function applyDefaultEnv(env) {
  if (env.DATABASE_URL === undefined) {
    env.DATABASE_URL = DEFAULT_DATABASE_URL;
  }
  if (env.APP_DATABASE_URL === undefined) {
    env.APP_DATABASE_URL = DEFAULT_APP_DATABASE_URL;
  }
  return env;
}

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

function main() {
  applyDefaultEnv(process.env);

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
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_APP_DATABASE_URL,
  DEFAULT_DATABASE_URL,
  applyDefaultEnv,
  main,
};
