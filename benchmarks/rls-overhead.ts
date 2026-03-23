/**
 * Benchmark: RLS extension overhead measurement
 *
 * Compares:
 *   A) Direct Prisma query (no extension)
 *   B) Prisma query with tenancy extension (batch $transaction + set_config)
 *
 * Usage:
 *   docker compose up -d --wait
 *   DATABASE_URL=postgresql://tenancy:tenancy@localhost:5433/tenancy_test \
 *     npx ts-node benchmarks/rls-overhead.ts
 */

import { execFileSync } from 'child_process';
import { Client } from 'pg';
import * as path from 'path';
import * as fs from 'fs';
import { TenancyContext } from '../src/services/tenancy-context';
import { TenancyService } from '../src/services/tenancy.service';
import { createPrismaTenancyExtension } from '../src/prisma/prisma-tenancy.extension';

const ADMIN_URL =
  process.env.DATABASE_URL ?? 'postgresql://tenancy:tenancy@localhost:5433/tenancy_test';
const APP_URL =
  process.env.APP_DATABASE_URL ?? 'postgresql://app_user:app_user@localhost:5433/tenancy_test';

const TENANT_1 = '11111111-1111-1111-1111-111111111111';
const WARMUP = 50;
const ITERATIONS = 500;

interface BenchResult {
  label: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function analyze(label: string, timings: number[]): BenchResult {
  const sorted = [...timings].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  return {
    label,
    iterations: sorted.length,
    totalMs: Math.round(total * 100) / 100,
    avgMs: Math.round((total / sorted.length) * 100) / 100,
    p50Ms: Math.round(percentile(sorted, 50) * 100) / 100,
    p95Ms: Math.round(percentile(sorted, 95) * 100) / 100,
    p99Ms: Math.round(percentile(sorted, 99) * 100) / 100,
    minMs: Math.round(sorted[0] * 100) / 100,
    maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
  };
}

async function main() {
  console.log('=== @nestarc/tenancy Benchmark ===\n');

  // --- Setup ---
  console.log('Setting up database...');
  const adminClient = new Client({ connectionString: ADMIN_URL });
  await adminClient.connect();

  const setupSql = fs.readFileSync(
    path.join(__dirname, '..', 'test', 'e2e', 'setup.sql'),
    'utf-8',
  );
  await adminClient.query(setupSql);

  // Seed more rows for realistic workload
  console.log('Seeding 1000 rows...');
  for (let i = 0; i < 200; i++) {
    await adminClient.query(
      `INSERT INTO users (tenant_id, name, email) VALUES
       ($1, $2, $3), ($1, $4, $5),
       ($6, $7, $8), ($6, $9, $10),
       ($11, $12, $13)`,
      [
        TENANT_1, `user_${i}_a`, `a${i}@t1.com`,
        `user_${i}_b`, `b${i}@t1.com`,
        '22222222-2222-2222-2222-222222222222', `user_${i}_c`, `c${i}@t2.com`,
        `user_${i}_d`, `d${i}@t2.com`,
        '33333333-3333-3333-3333-333333333333', `user_${i}_e`, `e${i}@t3.com`,
      ],
    );
  }

  const countResult = await adminClient.query('SELECT count(*) FROM users');
  console.log(`Total rows: ${countResult.rows[0].count}\n`);

  // --- Prisma generate ---
  console.log('Generating Prisma client...');
  const schemaPath = path.join(__dirname, '..', 'test', 'e2e', 'schema.prisma');
  execFileSync('npx', ['prisma', 'generate', `--schema=${schemaPath}`], {
    env: { ...process.env, DATABASE_URL: APP_URL },
    stdio: 'pipe',
  });

  const generatedPath = path.join(__dirname, '..', 'test', 'e2e', 'generated');
  const { PrismaClient } = require(generatedPath);

  // --- Client A: no extension (superuser, no RLS) ---
  const prismaBaseline = new PrismaClient({ datasourceUrl: ADMIN_URL });
  await prismaBaseline.$connect();

  // --- Client B: with extension (app_user, RLS active) ---
  const context = new TenancyContext();
  const service = new TenancyService(context);
  const prismaBase = new PrismaClient({ datasourceUrl: APP_URL });
  const prismaWithExt = prismaBase.$extends(createPrismaTenancyExtension(service));
  await prismaWithExt.$connect();

  // --- Benchmark A: Baseline (no extension) ---
  console.log(`Warming up (${WARMUP} iterations)...`);
  for (let i = 0; i < WARMUP; i++) {
    await prismaBaseline.user.findMany();
  }

  console.log(`Running Benchmark A: Direct query, no extension (${ITERATIONS} iterations)...`);
  const timingsA: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await prismaBaseline.user.findMany();
    timingsA.push(performance.now() - start);
  }

  // --- Benchmark B: With tenancy extension ---
  console.log(`Warming up (${WARMUP} iterations)...`);
  for (let i = 0; i < WARMUP; i++) {
    await new Promise<void>((resolve) => {
      context.run(TENANT_1, async () => {
        await prismaWithExt.user.findMany();
        resolve();
      });
    });
  }

  console.log(`Running Benchmark B: With tenancy extension (${ITERATIONS} iterations)...`);
  const timingsB: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    await new Promise<void>((resolve) => {
      context.run(TENANT_1, async () => {
        const start = performance.now();
        await prismaWithExt.user.findMany();
        timingsB.push(performance.now() - start);
        resolve();
      });
    });
  }

  // --- Benchmark C: findFirst (single row) ---
  console.log(`Running Benchmark C: findFirst with extension (${ITERATIONS} iterations)...`);
  const timingsC: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    await new Promise<void>((resolve) => {
      context.run(TENANT_1, async () => {
        const start = performance.now();
        await prismaWithExt.user.findFirst();
        timingsC.push(performance.now() - start);
        resolve();
      });
    });
  }

  // --- Results ---
  const resultA = analyze('A) Direct query (no extension, no RLS)', timingsA);
  const resultB = analyze('B) findMany with tenancy extension', timingsB);
  const resultC = analyze('C) findFirst with tenancy extension', timingsC);

  const overhead = resultB.avgMs - resultA.avgMs;
  const overheadPct = ((overhead / resultA.avgMs) * 100).toFixed(1);

  console.log('\n' + '='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));

  for (const r of [resultA, resultB, resultC]) {
    console.log(`\n${r.label}`);
    console.log(`  Iterations: ${r.iterations}`);
    console.log(`  Avg: ${r.avgMs}ms | P50: ${r.p50Ms}ms | P95: ${r.p95Ms}ms | P99: ${r.p99Ms}ms`);
    console.log(`  Min: ${r.minMs}ms | Max: ${r.maxMs}ms`);
  }

  console.log('\n' + '-'.repeat(70));
  console.log(`Extension overhead (avg): +${overhead.toFixed(2)}ms (+${overheadPct}%)`);
  console.log(`Extension overhead (p95): +${(resultB.p95Ms - resultA.p95Ms).toFixed(2)}ms`);
  console.log('-'.repeat(70));

  // --- Cleanup ---
  await prismaBaseline.$disconnect();
  await prismaWithExt.$disconnect();
  await adminClient.query('DROP TABLE IF EXISTS users CASCADE');
  await adminClient.end();

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
