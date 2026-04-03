# 0.7.0 Validation Report

Date: 2026-04-03
Project: `@nestarc/tenancy`

## Scope

- Local verification by main agent
- Parallel review by specialist subagents
- Review focus: release readiness, API/docs consistency, CLI/DX, tenant-isolation safety, compatibility coverage

## Review Team

- Main agent: local execution checks, architecture/security cross-check, result integration
- Testing/release reviewer subagent: CI, packaging, compatibility, release gating
- Docs/DX reviewer subagent: README, changelog, CLI behavior, user-facing accuracy

## Executed Checks

- `git status --short` -> clean worktree
- `npm run lint` -> fail (`TS2307: Cannot find module '@opentelemetry/api'`)
- `npm test` -> fail (`32` suites total, `29` passed, `3` failed for the same TypeScript error)
- `npm run build` -> fail (`TS2307: Cannot find module '@opentelemetry/api'`)
- `npm pack --dry-run --cache /tmp/npm-cache-codex` -> fail (build step fails for the same TypeScript error)
- `npm run test:e2e` -> could not complete (`Docker daemon unavailable` in this environment)

## Findings

### P1. Clean-install build is broken by the optional OpenTelemetry integration

Affected files:
- `src/telemetry/tenancy-telemetry.service.ts`
- `package.json`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

`TenancyTelemetryService` dynamically imports `@opentelemetry/api` (`src/telemetry/tenancy-telemetry.service.ts:30-34`), but the package is only declared as an optional peer dependency and is not installed in local or CI dev dependencies (`package.json:55-99`). In a clean checkout, `npm run lint`, `npm test`, `npm run build`, and `npm pack --dry-run` all fail with `TS2307`.

Why this matters:
- The package cannot pass its own default validation flow from a clean `npm ci`.
- Both CI and release workflows execute build/test after `npm ci`, so the release is blocked before publish (`.github/workflows/ci.yml:25-28`, `.github/workflows/release.yml:18-21`, `.github/workflows/release.yml:69-71`).

### P1. The repository still identifies itself as 0.6.0, not 0.7.0

Affected files:
- `package.json`
- `CHANGELOG.md`
- `.github/workflows/release.yml`

As of 2026-04-03, the package version is still `0.6.0` (`package.json:3`) and the latest changelog entry is `0.6.0` dated 2026-04-02 (`CHANGELOG.md:7`). There is no `0.7.0` release note block, and the release workflow publishes directly from the checked-out metadata without any version bump step (`.github/workflows/release.yml:69-71`).

Why this matters:
- A claimed 0.7.0 release is internally inconsistent with the repository metadata.
- If `0.6.0` is already published, `npm publish` will fail; otherwise the published artifact will still advertise itself as `0.6.0`.

### P1. `tenancy check` can falsely report drift for valid projects that customize `dbSettingKey`

Affected files:
- `src/cli/check.ts`
- `src/cli/index.ts`
- `src/cli/init.ts`
- `README.md`

The internal `runCheck()` API supports `dbSettingKey` (`src/cli/check.ts:5-8`, `src/cli/check.ts:27-30`), and the README explicitly documents custom keys plus setting-key consistency validation (`README.md:146-154`, `README.md:777-783`). However, the actual CLI entrypoint exposes no flag or prompt reuse for `check`; it always calls `runCheck()` with default options (`src/cli/index.ts:14-17`), which means the validator always expects `'app.current_tenant'`.

Why this matters:
- A project generated with a custom `dbSettingKey` can be fully correct and still get a false drift warning from `npx @nestarc/tenancy check`.
- This breaks one of the release's advertised validation guarantees for non-default setups.

### P2. `tenancy check` can also miss mixed `current_setting()` drift inside the same SQL file

Affected files:
- `src/cli/check.ts`
- `test/cli/check.spec.ts`

The setting-key validation only reads the first `current_setting(...)` match in the file (`src/cli/check.ts:118-124`). That means a SQL file with multiple tenant policies can still return `inSync: true` if the first table uses the expected key and a later table uses a different key. Current tests only cover the simple single-key mismatch case (`test/cli/check.spec.ts:243-264`) and do not protect against this mixed-file false green.

Why this matters:
- Users can get a successful drift check while some tables still reference the wrong tenant setting.
- This weakens the safety value of the CLI for RLS review because the bug hides partial misconfiguration.

### P2. `interactiveTransactionSupport` still lacks real E2E coverage on the risky path

Affected files:
- `test/prisma-tenancy.extension.spec.ts`
- `test/e2e/prisma-extension.e2e-spec.ts`
- `.github/workflows/ci.yml`

The `interactiveTransactionSupport` branch is covered in unit tests with mocked Prisma internals (`test/prisma-tenancy.extension.spec.ts:685-879`), but the E2E suite only exercises the default extension path and `tenancyTransaction()` against a real database (`test/e2e/prisma-extension.e2e-spec.ts:35-140`, `test/e2e/prisma-extension.e2e-spec.ts:213-275`). The compatibility job also skips E2E entirely and only runs unit tests plus build (`.github/workflows/ci.yml:37-61`).

Why this matters:
- This feature depends on Prisma private APIs, so mock-only verification is a weak safety net.
- The riskiest compatibility surface remains unproven under real Prisma/PostgreSQL execution, especially for the advertised Nest 10 / Prisma 5 support story.

### P2. README is behind the current public surface for cross-check and telemetry features

Affected files:
- `README.md`
- `src/interfaces/tenancy-module-options.interface.ts`
- `src/events/tenancy-events.ts`
- `src/index.ts`

The code exposes `crossCheckExtractor`, `onCrossCheckFailed`, and `telemetry` as public module options (`src/interfaces/tenancy-module-options.interface.ts:32-56`), exports `TenancyTelemetryService` from the root entrypoint (`src/index.ts:41-43`), and defines the `tenant.cross_check_failed` event (`src/events/tenancy-events.ts:3-9`). The README event section still lists only four events and omits `tenant.cross_check_failed` (`README.md:555-583`), and it does not document how to configure cross-checking or telemetry.

Why this matters:
- Real security and observability features are effectively undiscoverable from the main documentation.
- Users are more likely to re-implement weaker solutions or miss already-shipped protections.

### P3. Telemetry spans are not closed if `onTenantResolved` throws

Affected files:
- `src/middleware/tenant.middleware.ts`
- `test/tenant.middleware.spec.ts`

`TenantMiddleware` starts the `tenant.resolved` span before invoking `onTenantResolved`, then calls `endSpan()` only on the happy path (`src/middleware/tenant.middleware.ts:82-90`). If the hook throws, the error is propagated as intended, but the started span is never closed. The current regression test for hook failures asserts only error propagation and does not verify span cleanup (`test/tenant.middleware.spec.ts:151-165`).

Why this matters:
- Observability data can leak unfinished spans during application-level validation or audit failures.
- This is low severity for correctness, but it is a real lifecycle bug in the telemetry path.

## Strengths

- Several 0.6.0 validation findings appear to be fixed in the current codebase: `TenancyContext` is exported from the root entrypoint, CLI deep checks exist, interceptor teardown is implemented, and the compatibility workflow now includes a Nest 10 / Prisma 5 job.
- The repository still has broad unit-test coverage across middleware, propagation, CLI templates, Prisma extension behavior, and testing utilities.
- Public exports remain coherent across the root entrypoint and the `./testing` subpath.

## Verdict

0.7.0 is not release-ready in the current repository state on 2026-04-03.

The primary blocker is operational, not theoretical: a clean install cannot build or test successfully because of the optional OpenTelemetry integration. Even after that is fixed, release metadata still needs to be brought to 0.7.0, and the CLI/docs inconsistency around custom `dbSettingKey` should be resolved before claiming the release is validated.

## Recommended Next Actions

1. Fix the optional OpenTelemetry integration so clean-install TypeScript builds succeed without `@opentelemetry/api`.
2. Bump `package.json` and add a `0.7.0` changelog entry dated 2026-04-03 before any publish attempt.
3. Add a `check` CLI flag for custom `dbSettingKey` or remove the user-facing claim that CLI validation covers non-default keys.
4. Harden `check` so setting-key validation is both configurable and table-complete.
5. Add a real E2E test path for `interactiveTransactionSupport: true`.
6. Update README to document cross-checking, telemetry, and the full event list.
7. Wrap telemetry span lifecycle in `try/finally` and add a regression test for hook-failure cleanup.
