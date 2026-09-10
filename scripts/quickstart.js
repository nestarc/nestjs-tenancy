#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const EXAMPLE = path.join(ROOT, 'examples', 'quickstart');

function run(command, args, env = process.env) {
  execFileSync(command, args, { cwd: ROOT, env, stdio: 'inherit' });
}

function compose(args, env = process.env, project = 'tenancy-quickstart') {
  run('docker', ['compose', '-f', path.join(EXAMPLE, 'compose.yaml'), '-p', project, ...args], env);
}

function prepare(env = process.env) {
  run('npm', ['run', 'build'], env);
  run(process.execPath, ['node_modules/prisma/build/index.js', 'generate', '--config', path.join(EXAMPLE, 'prisma.config.ts')], env);
  run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', path.join(EXAMPLE, 'tsconfig.json')], env);
}

async function setupDatabase(env = process.env) {
  run(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--config', path.join(EXAMPLE, 'prisma.config.ts')], env);
  const client = new Client({
    connectionString: env.QUICKSTART_ADMIN_DATABASE_URL
      ?? 'postgresql://quickstart_admin:quickstart_admin@127.0.0.1:5434/tenancy_quickstart',
  });
  await client.connect();
  try {
    for (const filename of ['setup.sql', 'seed.sql']) {
      await client.query(fs.readFileSync(path.join(EXAMPLE, filename), 'utf8'));
    }
  } finally { await client.end(); }
}

function execute(filename, env = process.env) {
  run(process.execPath, ['-r', 'ts-node/register', path.join(EXAMPLE, filename)], {
    ...env, TS_NODE_PROJECT: path.join(EXAMPLE, 'tsconfig.json'),
  });
}

async function main() {
  const command = process.argv[2];
  if (command === 'setup') {
    prepare();
    compose(['up', '-d', '--wait']);
    await setupDatabase();
    console.log('[quickstart] database ready; run npm run example:quickstart:start');
  } else if (command === 'start') {
    execute('main.ts');
  } else {
    throw new Error('Usage: node scripts/quickstart.js setup|start');
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = error.status || 1;
  });
}

module.exports = { ROOT, EXAMPLE, compose, execute, prepare, setupDatabase };
