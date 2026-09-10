# Reproduce the RLS extension benchmark

This benchmark measures an awaited Prisma operation, including network time, returned rows, and any transaction work. Its extension comparison is **D minus C**: the same application role, RLS policy, transaction-local `set_config()`, and 402 returned rows. It does not isolate the cost of `AsyncLocalStorage` or establish zero overhead.

| Scenario | Operation | Returned rows |
| --- | --- | --- |
| A | Admin `findMany`, all rows, bypassing RLS | 1005 |
| B | Admin `findMany` with a tenant `WHERE` filter, bypassing RLS | 402 |
| C | Application role, manual RLS transaction (`set_config()` + `findMany`) | 402 |
| D | Application role, tenancy extension `findMany` | 402 |
| E | Application role, tenancy extension `findFirst` | 1 |

A is context only. B versus C includes both RLS and transaction costs and a different database role. E is a single-row reference. Only C versus D aligns the conditions needed for the extension comparison.

## Run on a disposable database

The setup executes [`test/e2e/setup.sql`](https://github.com/nestarc/nestjs-tenancy/blob/main/test/e2e/setup.sql). It drops and recreates `users`, `force_owner_users`, and `countries` with `CASCADE`; creates `app_user` if absent; and grants that role fixture permissions. It adds 1,000 users to the five initial rows. Fixtures remain after the run; discard the database/container when finished. Never select an application or shared test database containing data you need. The script requires explicit `--allow-fixture-reset` before connecting.

From the repository root, install the lockfile dependencies with `npm ci`, then use a fresh container on an available local port. The following container is independent of the repository's shared Docker Compose service:

```sh
docker run --detach --rm --name tenancy-benchmark \
  --publish 127.0.0.1:55433:5432 \
  --env POSTGRES_USER=tenancy \
  --env POSTGRES_PASSWORD=tenancy \
  --env POSTGRES_DB=tenancy_benchmark \
  postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777

# Repeat until PostgreSQL reports that it accepts connections.
docker exec tenancy-benchmark pg_isready -U tenancy -d tenancy_benchmark

DATABASE_URL=postgresql://tenancy:tenancy@127.0.0.1:55433/tenancy_benchmark \
APP_DATABASE_URL=postgresql://app_user:app_user@127.0.0.1:55433/tenancy_benchmark \
  npm run bench -- --allow-fixture-reset --output benchmarks/results/local-run.json

docker stop tenancy-benchmark
```

Choose a new output filename for each run; existing files are never overwritten. `--output FILE` can also be supplied through `BENCH_OUTPUT`. `BENCH_ALLOW_FIXTURE_RESET=1` is the environment alternative for the reset flag. `DATABASE_URL` and `APP_DATABASE_URL` must point to the same disposable database; the admin connection must be able to create roles, prepare fixtures, and bypass RLS. The application role must be a non-superuser without `BYPASSRLS`. All returned row counts are checked during warmup and measurement.

Defaults are 50 warmup calls and 500 measured calls per scenario, with one call at a time in A–E order. `--warmup N` (zero or more) and `--iterations N` (one or more) make the parameters explicit. A short run such as `--warmup 2 --iterations 5` verifies execution and artifact output; it is not suitable for performance conclusions. Prisma Client is generated from the test schema before measurement.

## JSON artifact, schema version 1

Only a completed run writes a result. The console retains the human-readable summary; JSON keeps unrounded timings so its statistics can be recomputed.

| Field | Contents |
| --- | --- |
| `schemaVersion`, `benchmark` | Format version and benchmark name |
| `measuredAt`, `finishedAt` | UTC ISO timestamps around the scenario sequence, including warmup |
| `source.before`, `source.after` | Git commit, repository dirty state, and SHA-256 hashes before setup and after measurement |
| `source.sourcesChangedDuringRun` | Whether the Git commit or scoped file hashes changed; rerun before drawing conclusions if true |
| `environment` | Node, operating system/platform/architecture, CPU, PostgreSQL server, Prisma Client/CLI/adapter, and tenancy package versions |
| `parameters` | Warmup, iterations, concurrency, order, fixture and tenant row counts, settings key, default extension options, timing units/scope, and percentile method |
| `scenarios` | A–E summaries and each measured `{ durationMs, rowCount }` sample in execution order |
| `comparisons` | D-minus-C average/p95 delta and C-minus-B average delta, including average percentages |

Source hashes cover all `src/**/*.ts`, the benchmark and reporting implementation, fixture SQL/schema, `package.json`, `package-lock.json`, `tsconfig.json`, Prisma config, and Docker Compose config. They identify scoped files in a dirty worktree; they do not archive those files or prove the entire environment. Git fields are `null` when Git metadata is unavailable. The artifact records explicit metadata fields only: no database URLs, passwords, full environment variables, or query result contents are included.

Scenarios run in fixed order and share a host/database. Cache warming, scheduling, network load, and other processes can affect results; repeat runs and inspect raw samples. A small negative D-minus-C delta is not evidence that the extension makes queries faster. Keep the JSON and the matching source revision when publishing a result, and state whether the worktree was dirty. If sources change during a run, retain it only as diagnostic output and rerun on stable sources.

The earlier Prisma 7.9.1 example did not include an original timestamped raw artifact. It has been removed from the current performance claims; no retrospective provenance has been fabricated. Generate a new artifact to assess the current code and your environment.

## Recorded verification run

The [2026-09-10 raw artifact](./results/2026-09-10-documentation-remediation.json) records 500 measurements per scenario after 50 warmup calls, on an Apple M1 Pro with Node 24.11.1, Prisma 7.10.0, and an isolated PostgreSQL 16.15 container. The image was `postgres:16.15-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685`. It used the remediation working tree, marked dirty, with scoped hashes unchanged during the run.

For this run, extension `findMany` averaged 3.837 ms versus 3.529 ms for the equivalent manual RLS transaction: a 0.308 ms difference. These observations validate the measurement path and preserve its raw evidence; a single run under other local activity is not a general performance guarantee. The artifact includes all 2,500 measured samples, the underlying precision, and provenance for independent recalculation.

## Check reporting without a database

```sh
node --require ts-node/register --test benchmarks/report.test.cjs
npm run bench -- --help
```

These checks validate argument handling, reset refusal, sample statistics, and artifact preservation. They do not measure database performance.
