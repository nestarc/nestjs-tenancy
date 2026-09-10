const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { analyze, parseOptions, writeReport } = require('./report.ts');

test('options require explicit fixture reset and reject invalid sample counts', () => {
  assert.equal(parseOptions([], {}).allowFixtureReset, false);
  assert.deepEqual(parseOptions(['--allow-fixture-reset', '--warmup', '0', '--iterations', '5', '--output', 'run.json'], {}), {
    allowFixtureReset: true, help: false, warmup: 0, iterations: 5, output: 'run.json',
  });
  assert.equal(parseOptions([], { BENCH_ALLOW_FIXTURE_RESET: '1', BENCH_OUTPUT: 'env.json' }).output, 'env.json');
  for (const args of [['--iterations', '0'], ['--warmup', '-1'], ['--iterations', '1.5'], ['--output'], ['--typo']]) {
    assert.throws(() => parseOptions(args, {}));
  }
});

test('statistics preserve raw sample order and use nearest-rank percentiles', () => {
  const samples = [8, 1, 4, 2].map((durationMs) => ({ durationMs, rowCount: 402 }));
  const result = analyze('C', 'Manual RLS', samples);
  assert.equal(result.totalMs, 15);
  assert.equal(result.avgMs, 3.75);
  assert.equal(result.p50Ms, 2);
  assert.equal(result.p95Ms, 8);
  assert.equal(result.p99Ms, 8);
  assert.deepEqual(result.samples.map((sample) => sample.durationMs), [8, 1, 4, 2]);
  assert.equal(result.rowCount, 402);
});

test('invalid measurements and inconsistent returned row counts cannot become a result', () => {
  assert.throws(() => analyze('C', 'Manual RLS', []));
  assert.throws(() => analyze('C', 'Manual RLS', [{ durationMs: NaN, rowCount: 402 }]));
  assert.throws(() => analyze('C', 'Manual RLS', [
    { durationMs: 1, rowCount: 402 }, { durationMs: 2, rowCount: 1005 },
  ]));
});

test('JSON results retain sample precision and never overwrite an existing artifact', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenancy-benchmark-report-'));
  try {
    const output = path.join(directory, 'nested', 'run.json');
    const report = { schemaVersion: 1, scenarios: [analyze('C', 'Manual RLS', [{ durationMs: 1.123456789, rowCount: 402 }])] };
    writeReport(output, report);
    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), report);
    assert.throws(() => writeReport(output, { replaced: true }), { code: 'EEXIST' });
    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), report);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI refuses fixture reset before contacting a database', () => {
  const result = spawnSync(process.execPath, ['-r', 'ts-node/register', 'benchmarks/rls-overhead.ts'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, BENCH_ALLOW_FIXTURE_RESET: '', DATABASE_URL: 'postgresql://user:secret@127.0.0.1:1/unreachable' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Fixture reset requires --allow-fixture-reset/);
  assert.doesNotMatch(result.stdout + result.stderr, /secret|ECONNREFUSED|Setting up/);
});
