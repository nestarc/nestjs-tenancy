// Run from the tenancy checkout after building dist, optionally passing a packed candidate.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { packPackage, COMMON_DEPENDENCIES } from '../../../scripts/test-package-consumer.js';
import {
  MODERN_COMPOSE_FILE, composeArgs, createComposeEnv, createComposeProjectName,
  databaseDefaultsForPort, parseComposePort, resolveCommand,
} from '../../../scripts/test-modern-ecosystem-e2e.js';

const root = path.resolve(import.meta.dirname, '../../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tenancy-audit-'));
const composeFile = path.join(root, MODERN_COMPOSE_FILE);
const composeProject = createComposeProjectName();
const compose = (args, capture = false) => execFileSync('docker', composeArgs(composeProject, composeFile, args), {
  env: createComposeEnv(process.env), stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8',
});

let started = false;
try {
  const tarball = process.argv[2] ? path.resolve(process.argv[2]) : packPackage(root, scratch);
  const dependencies = {
    ...COMMON_DEPENDENCIES,
    '@nestarc/tenancy': 'file:' + tarball,
    '@nestarc/audit-log': '0.7.0',
    '@nestarc/soft-delete': '0.7.5',
    '@prisma/adapter-pg': COMMON_DEPENDENCIES['@prisma/client'],
    prisma: COMMON_DEPENDENCIES['@prisma/client'],
    pg: '8.20.0',
  };
  fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ private: true, dependencies }));
  for (const file of ['schema.prisma', 'setup.sql', 'verify.mjs']) {
    fs.copyFileSync(path.join(import.meta.dirname, file), path.join(scratch, file));
  }
  const npm = resolveCommand('npm', ['install', '--strict-peer-deps', '--no-legacy-peer-deps', '--no-force', '--no-audit', '--no-fund']);
  execFileSync(npm.command, npm.args, { cwd: scratch, stdio: 'inherit' });
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'generate', '--schema=schema.prisma'], {
    cwd: scratch, stdio: 'inherit',
  });
  started = true;
  compose(['up', '-d', '--wait', 'postgres']);
  const port = parseComposePort(compose(['port', 'postgres', '5432'], true));
  const { databaseUrl, appDatabaseUrl } = databaseDefaultsForPort(port);
  execFileSync(process.execPath, ['verify.mjs'], {
    cwd: scratch, stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl, APP_DATABASE_URL: appDatabaseUrl },
  });
} finally {
  try {
    if (started) compose(['down', '--volumes']);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
