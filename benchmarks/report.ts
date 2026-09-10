import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface BenchmarkOptions {
  allowFixtureReset: boolean;
  help: boolean;
  output?: string;
  warmup: number;
  iterations: number;
}

export interface BenchmarkSample {
  durationMs: number;
  rowCount: number;
}

export interface BenchResult {
  id: string;
  label: string;
  iterations: number;
  rowCount: number;
  totalMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
  samples: BenchmarkSample[];
}

export interface SourceSnapshot {
  gitCommit: string | null;
  gitDirty: boolean | null;
  sha256: Record<string, string>;
}

function countOption(name: string, value: string, minimum: number): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return Number(value);
}

export function parseOptions(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): BenchmarkOptions {
  const options: BenchmarkOptions = {
    allowFixtureReset: env.BENCH_ALLOW_FIXTURE_RESET === '1',
    help: false,
    output: env.BENCH_OUTPUT || undefined,
    warmup: 50,
    iterations: 500,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') options.help = true;
    else if (arg === '--allow-fixture-reset') options.allowFixtureReset = true;
    else if (arg === '--output' || arg === '--warmup' || arg === '--iterations') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--output') options.output = value;
      else if (arg === '--warmup') options.warmup = countOption(arg, value, 0);
      else options.iterations = countOption(arg, value, 1);
    } else throw new Error(`Unknown benchmark option: ${arg}`);
  }
  return options;
}

export function analyze(id: string, label: string, samples: BenchmarkSample[]): BenchResult {
  if (samples.length === 0) throw new Error('A benchmark needs at least one measured sample');
  const rowCount = samples[0].rowCount;
  for (const sample of samples) {
    if (!Number.isFinite(sample.durationMs) || sample.durationMs < 0) {
      throw new Error(`Invalid timing in scenario ${id}`);
    }
    if (!Number.isSafeInteger(sample.rowCount) || sample.rowCount < 0 || sample.rowCount !== rowCount) {
      throw new Error(`Inconsistent or invalid returned row count in scenario ${id}`);
    }
  }
  const sorted = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const total = samples.reduce((sum, sample) => sum + sample.durationMs, 0);
  const percentile = (p: number): number => sorted[Math.ceil((p / 100) * sorted.length) - 1];
  // Preserve full precision in JSON so summary numbers can be recomputed from samples.
  return {
    id,
    label,
    iterations: samples.length,
    rowCount,
    totalMs: total,
    avgMs: total / samples.length,
    p50Ms: percentile(50),
    p95Ms: percentile(95),
    p99Ms: percentile(99),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    samples,
  };
}

export function snapshotSources(root: string): SourceSnapshot {
  const files = [
    'package.json', 'package-lock.json', 'tsconfig.json', 'prisma.config.ts',
    'docker-compose.yml', 'test/e2e/setup.sql', 'test/e2e/schema.prisma',
    'benchmarks/rls-overhead.ts', 'benchmarks/report.ts',
  ];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relativePath = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(relativePath);
      else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(relativePath);
    }
  };
  visit('src');
  const sha256: Record<string, string> = {};
  for (const file of files.sort()) {
    sha256[file] = createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
  }
  let gitCommit: string | null = null;
  let gitDirty: boolean | null = null;
  try {
    gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    gitDirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().length > 0;
  } catch {
    // Source archives still have hashes; Git provenance is explicitly unavailable.
  }
  return { gitCommit, gitDirty, sha256 };
}

export function writeReport(output: string, report: unknown): void {
  const resolved = path.resolve(output);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  // Never replace an earlier measurement or a user-supplied file.
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
}
