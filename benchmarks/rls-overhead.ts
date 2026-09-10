/**
 * Benchmark: RLS extension overhead measurement
 *
 * Compares:
 *   A) Admin direct query, all rows (context only; not an extension baseline)
 *   B) Admin direct query, tenant-filtered with WHERE (same returned row count, RLS bypassed)
 *   C) app_user manual RLS transaction (set_config + query, no extension)
 *   D) app_user tenancy extension (same app role, RLS policy, and returned row count)
 *   E) app_user tenancy extension findFirst (single-row reference)
 *
 * The headline extension overhead is D - C. This keeps database role, RLS policy,
 * set_config, transaction wrapping, and returned row count aligned.
 *
 * Usage:
 *   docker compose up -d --wait
 *   DATABASE_URL=postgresql://tenancy:tenancy@localhost:5433/tenancy_test \
 *     npm run bench -- --allow-fixture-reset --output benchmarks/results/local.json
 *
 * Use a disposable database: setup.sql replaces users, force_owner_users, and
 * countries. See benchmarks/README.md for provenance and output format details.
 */

import { execFileSync } from 'child_process';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { TenancyContext } from '../src/services/tenancy-context';
import { TenancyService } from '../src/services/tenancy.service';
import { createPrismaTenancyExtension } from '../src/prisma/prisma-tenancy.extension';
import { DEFAULT_DB_SETTING_KEY } from '../src/tenancy.constants';
import { analyze, BenchResult, BenchmarkSample, parseOptions, snapshotSources, writeReport } from './report';

const ADMIN_URL =
  process.env.DATABASE_URL ?? 'postgresql://tenancy:tenancy@localhost:5433/tenancy_test';
const APP_URL =
  process.env.APP_DATABASE_URL ?? 'postgresql://app_user:app_user@localhost:5433/tenancy_test';

const TENANT_1 = '11111111-1111-1111-1111-111111111111';
const TENANT_2 = '22222222-2222-2222-2222-222222222222';
const TENANT_3 = '33333333-3333-3333-3333-333333333333';
const ROOT = path.join(__dirname, '..');

interface PrismaUserDelegate {
  findMany(args?: Record<string, unknown>): Promise<unknown[]>;
  findFirst(args?: Record<string, unknown>): Promise<unknown | null>;
}

interface PrismaClientLike {
  user: PrismaUserDelegate;
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  $transaction<T extends readonly unknown[]>(queries: T): Promise<unknown[]>;
  $extends(extension: unknown): PrismaClientLike;
}

interface PrismaClientConstructor {
  new(options: { adapter: unknown }): PrismaClientLike;
}

function createClient(
  PrismaClient: PrismaClientConstructor,
  connectionString: string,
): PrismaClientLike {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

type BenchTask<T> = () => Promise<T>;

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function inferRowCount(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  return result == null ? 0 : 1;
}

function formatSigned(value: number, digits = 3): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function formatDelta(deltaMs: number, baselineMs: number): string {
  const pct = baselineMs === 0 ? 'n/a' : `${formatSigned((deltaMs / baselineMs) * 100, 1)}%`;
  return `${formatSigned(deltaMs)}ms (${pct})`;
}

async function runBenchmark<T>(
  id: string,
  label: string,
  task: BenchTask<T>,
  warmup: number,
  iterations: number,
  expectedRows: number,
): Promise<BenchResult> {
  const checkRows = (result: unknown): number => {
    const rowCount = inferRowCount(result);
    if (rowCount !== expectedRows) {
      throw new Error(`Scenario ${id} returned ${rowCount} rows; expected ${expectedRows}. Check the fixture, database roles, and RLS policies.`);
    }
    return rowCount;
  };
  console.log(`Warming up ${label} (${warmup} iterations)...`);
  for (let i = 0; i < warmup; i++) {
    checkRows(await task());
  }

  console.log(`Running ${label} (${iterations} iterations, rows=${expectedRows})...`);

  const samples: BenchmarkSample[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const result = await task();
    const durationMs = performance.now() - start;
    samples.push({ durationMs, rowCount: checkRows(result) });
  }

  return analyze(id, label, samples);
}

async function seedBenchmarkRows(adminClient: Client): Promise<void> {
  console.log('Seeding 1000 additional rows...');
  await adminClient.query('BEGIN');
  try {
    for (let i = 0; i < 200; i++) {
      await adminClient.query(
        `INSERT INTO users (tenant_id, name, email) VALUES
         ($1, $2, $3), ($1, $4, $5),
         ($6, $7, $8), ($6, $9, $10),
         ($11, $12, $13)`,
        [
          TENANT_1, `user_${i}_a`, `a${i}@t1.com`,
          `user_${i}_b`, `b${i}@t1.com`,
          TENANT_2, `user_${i}_c`, `c${i}@t2.com`,
          `user_${i}_d`, `d${i}@t2.com`,
          TENANT_3, `user_${i}_e`, `e${i}@t3.com`,
        ],
      );
    }
    await adminClient.query('COMMIT');
  } catch (err) {
    await adminClient.query('ROLLBACK');
    throw err;
  }
}

function packageVersion(name: string): string | null {
  try {
    return (require(`${name}/package.json`) as { version: string }).version;
  } catch {
    // Some packages export their entry point but not package.json.
    try {
      let directory = path.dirname(require.resolve(name));
      for (;;) {
        const metadataPath = path.join(directory, 'package.json');
        if (fs.existsSync(metadataPath)) {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as { name: string; version: string };
          if (metadata.name === name) return metadata.version;
        }
        const parent = path.dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
    } catch {
      // Keep unavailable metadata explicit rather than guessing from a range.
    }
    return null;
  }
}

async function readEnvironment(adminClient: Client) {
  const postgres = await adminClient.query('SHOW server_version');
  return {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    osRelease: os.release(),
    cpuModel: os.cpus()[0]?.model ?? null,
    cpuCount: os.cpus().length,
    postgres: (postgres.rows[0]?.server_version as string | undefined) ?? null,
    prismaClient: packageVersion('@prisma/client'),
    prismaCli: packageVersion('prisma'),
    prismaAdapterPg: packageVersion('@prisma/adapter-pg'),
    tenancyPackage: (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }).version,
  };
}

async function findManyWithManualRls(prisma: PrismaClientLike): Promise<unknown[]> {
  const [, rows] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config(${DEFAULT_DB_SETTING_KEY}, ${TENANT_1}, TRUE)`,
    prisma.user.findMany(),
  ]);

  return rows as unknown[];
}

async function runWithTenant<T>(
  context: TenancyContext,
  task: () => Promise<T>,
): Promise<T> {
  return context.run(TENANT_1, async () => {
    // PrismaPromise execution must be awaited inside the ALS callback.
    const result = await task();
    return result;
  });
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: npm run bench -- --allow-fixture-reset [--output FILE] [--warmup 50] [--iterations 500]

Use a disposable database only. The fixture resets users, force_owner_users,
and countries, and grants permissions to app_user. DATABASE_URL selects the
admin connection; APP_DATABASE_URL selects the application connection.
BENCH_OUTPUT and BENCH_ALLOW_FIXTURE_RESET=1 are environment alternatives.
Output files are created exclusively; an existing file is never overwritten.`);
    return;
  }
  if (!options.allowFixtureReset) {
    throw new Error('Fixture reset requires --allow-fixture-reset (or BENCH_ALLOW_FIXTURE_RESET=1). Use a disposable database; setup replaces users, force_owner_users, and countries. See benchmarks/README.md.');
  }
  if (options.output && fs.existsSync(path.resolve(options.output))) {
    throw new Error('The benchmark output file already exists. Choose a new --output path.');
  }

  console.log('=== @nestarc/tenancy Benchmark ===\n');
  const sourceBefore = snapshotSources(ROOT);
  const adminClient = new Client({ connectionString: ADMIN_URL });
  const prismaClients: PrismaClientLike[] = [];
  try {
    console.log('Setting up disposable database fixtures...');
    await adminClient.connect();
    const setupSql = fs.readFileSync(path.join(ROOT, 'test', 'e2e', 'setup.sql'), 'utf8');
    await adminClient.query(setupSql);
    await seedBenchmarkRows(adminClient);

    const countResult = await adminClient.query('SELECT count(*) FROM users');
    const totalRows = Number(countResult.rows[0].count);
    if (totalRows !== 1005) throw new Error(`Expected 1005 fixture rows, received ${totalRows}`);
    const environment = await readEnvironment(adminClient);
    console.log(`Total rows: ${totalRows}\n`);
    console.log('Environment:');
    console.log(`  Node: ${environment.node}`);
    console.log(`  Platform: ${environment.platform} ${environment.architecture}`);
    console.log(`  CPU: ${environment.cpuModel ?? 'unknown'}`);
    console.log(`  PostgreSQL: ${environment.postgres ?? 'unknown'}`);
    console.log(`  Prisma Client: ${environment.prismaClient ?? 'unknown'}`);
    console.log(`  Warmup: ${options.warmup} | Iterations: ${options.iterations}\n`);

    console.log('Generating Prisma client...');
    const schemaPath = path.join(ROOT, 'test', 'e2e', 'schema.prisma');
    execFileSync('npx', ['prisma', 'generate', `--schema=${schemaPath}`], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: APP_URL },
      stdio: 'inherit',
    });

    const generatedPath = path.join(ROOT, 'test', 'e2e', 'generated', 'client');
    const { PrismaClient } = require(generatedPath) as { PrismaClient: PrismaClientConstructor };
    const prismaAdmin = createClient(PrismaClient, ADMIN_URL);
    prismaClients.push(prismaAdmin);
    await prismaAdmin.$connect();
    const prismaAppManual = createClient(PrismaClient, APP_URL);
    prismaClients.push(prismaAppManual);
    await prismaAppManual.$connect();
    const context = new TenancyContext();
    const service = new TenancyService(context);
    const prismaBase = createClient(PrismaClient, APP_URL);
    prismaClients.push(prismaBase);
    const prismaWithExt = prismaBase.$extends(createPrismaTenancyExtension(service));
    await prismaWithExt.$connect();

    const measuredAt = new Date().toISOString();
    const run = <T>(id: string, label: string, task: BenchTask<T>, rows: number) =>
      runBenchmark(id, label, task, options.warmup, options.iterations, rows);
    const adminAllRows = await run(
      'A', 'A) Admin direct findMany (all rows, no RLS)',
      () => prismaAdmin.user.findMany(), 1005,
    );
    const adminTenantFilter = await run(
      'B', 'B) Admin tenant-filtered findMany (WHERE tenant_id, no RLS)',
      () => prismaAdmin.user.findMany({ where: { tenant_id: TENANT_1 } }), 402,
    );
    const manualRls = await run(
      'C', 'C) app_user manual RLS transaction (set_config + findMany)',
      () => findManyWithManualRls(prismaAppManual), 402,
    );
    const extensionRls = await run(
      'D', 'D) app_user tenancy extension findMany',
      () => runWithTenant(context, () => prismaWithExt.user.findMany()), 402,
    );
    const extensionFindFirst = await run(
      'E', 'E) app_user tenancy extension findFirst',
      () => runWithTenant(context, () => prismaWithExt.user.findFirst()), 1,
    );
    const finishedAt = new Date().toISOString();
    const sourceAfter = snapshotSources(ROOT);
    const sourcesChangedDuringRun = JSON.stringify(sourceBefore.sha256) !== JSON.stringify(sourceAfter.sha256)
      || sourceBefore.gitCommit !== sourceAfter.gitCommit;
    const results = [adminAllRows, adminTenantFilter, manualRls, extensionRls, extensionFindFirst];
    const extensionOverhead = extensionRls.avgMs - manualRls.avgMs;
    const extensionP95Overhead = extensionRls.p95Ms - manualRls.p95Ms;
    const rlsCost = manualRls.avgMs - adminTenantFilter.avgMs;
    const report = {
      schemaVersion: 1,
      benchmark: '@nestarc/tenancy RLS extension overhead',
      measuredAt,
      finishedAt,
      source: { before: sourceBefore, after: sourceAfter, sourcesChangedDuringRun },
      environment,
      parameters: {
        warmupPerScenario: options.warmup,
        iterationsPerScenario: options.iterations,
        concurrency: 1,
        scenarioOrder: results.map((result) => result.id),
        fixtureRows: totalRows,
        tenantRows: 402,
        tenantCount: 3,
        dbSettingKey: DEFAULT_DB_SETTING_KEY,
        extensionOptions: 'defaults',
        durationUnit: 'milliseconds',
        percentileMethod: 'nearest-rank',
        timingScope: 'awaited client call including network, transaction, and returned rows; excludes row-count assertion',
      },
      scenarios: results,
      comparisons: {
        extensionVsManualRls: {
          baselineScenario: 'C', comparedScenario: 'D',
          avgDeltaMs: extensionOverhead,
          avgDeltaPercent: manualRls.avgMs === 0 ? null : (extensionOverhead / manualRls.avgMs) * 100,
          p95DeltaMs: extensionP95Overhead,
        },
        manualRlsVsAdminTenantFilter: {
          baselineScenario: 'B', comparedScenario: 'C', avgDeltaMs: rlsCost,
          avgDeltaPercent: adminTenantFilter.avgMs === 0 ? null : (rlsCost / adminTenantFilter.avgMs) * 100,
        },
      },
    };

    console.log('\n' + '='.repeat(78));
    console.log('RESULTS');
    console.log('='.repeat(78));
    for (const result of results) {
      console.log(`\n${result.label}`);
      console.log(`  Iterations: ${result.iterations} | Rows: ${result.rowCount}`);
      console.log(`  Avg: ${roundMs(result.avgMs)}ms | P50: ${roundMs(result.p50Ms)}ms | P95: ${roundMs(result.p95Ms)}ms | P99: ${roundMs(result.p99Ms)}ms`);
      console.log(`  Min: ${roundMs(result.minMs)}ms | Max: ${roundMs(result.maxMs)}ms`);
    }
    console.log('\n' + '-'.repeat(78));
    console.log(`Extension overhead vs manual RLS transaction (avg): ${formatDelta(extensionOverhead, manualRls.avgMs)}`);
    console.log(`Extension overhead vs manual RLS transaction (p95): ${formatSigned(extensionP95Overhead)}ms`);
    console.log(`RLS + transaction cost vs admin tenant-filtered query (avg): ${formatDelta(rlsCost, adminTenantFilter.avgMs)}`);
    console.log('Admin all-rows result is context only; it is not used as the extension overhead baseline.');
    console.log('Scenario order is fixed; small deltas can be measurement noise. This does not isolate AsyncLocalStorage cost.');
    if (sourcesChangedDuringRun) console.log('Source files changed during this run; rerun with stable sources before using these numbers.');
    console.log('-'.repeat(78));
    if (options.output) {
      writeReport(options.output, report);
      console.log(`\nJSON result: ${path.resolve(options.output)}`);
    } else {
      console.log('\nNo JSON saved. Use --output FILE (or BENCH_OUTPUT) to retain raw samples and provenance.');
    }
  } finally {
    await Promise.allSettled(prismaClients.map((client) => client.$disconnect()));
    // The disposable database owns the fixtures and role; drop it after use.
    await adminClient.end();
  }
  console.log('\nDone.');
}

main().catch((error: unknown) => {
  // Connection errors can include supplied connection strings; omit their details.
  const message = error instanceof Error ? error.message : 'Unknown benchmark failure';
  console.error(message.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[redacted database URL]'));
  process.exitCode = 1;
});
