# 0.8.0 Validation Report

Date: 2026-04-04
Project: `@nestarc/tenancy`

## Scope

- Local verification by main agent
- Parallel review by specialist subagents
- Review focus: tenant-isolation safety, packaging/type-surface correctness, release readiness, docs/API consistency

## Review Team

- Main agent: local build/test/lint/pack execution, publish-surface validation, result integration
- Security/tenant-isolation reviewer subagent: safety assumptions, public type surface, transport/runtime risk
- Testing/release reviewer subagent: CI/release gates, compatibility coverage, operational validation
- Docs/DX reviewer subagent: README, changelog, CLI and user-facing accuracy
- API/architecture reviewer subagent: public API consistency, optional dependency behavior, release coherence

## Executed Checks

- `git status --short` -> pass (clean worktree)
- `npm run build` -> pass
- `npm test` -> pass (`32` suites, `310` tests)
- `npm run lint` -> pass
- `npm pack --dry-run --cache /tmp/npm-cache-codex` -> pass
- `npm pack --pack-destination /tmp --cache /tmp/npm-cache-codex` -> pass (`nestarc-tenancy-0.8.0.tgz`)
- Isolated TypeScript consumer repro for packaged declarations without `@types/express` -> fail (`TS2307: Cannot find module 'express'`)
- `npm run test:e2e` -> inconclusive in this environment; Docker image pull completed, then `docker compose up -d --wait` failed with `Error response from daemon: No such container ...`

## Findings

### P1. `@types/express` is not actually optional for TypeScript consumers

Affected files:
- `package.json`
- `src/interfaces/tenancy-module-options.interface.ts`
- `src/interfaces/tenant-extractor.interface.ts`
- `src/events/tenancy-events.ts`
- published declaration surface under `dist/`

`package.json` marks `@types/express` as an optional peer (`package.json:60-74`), but the published declaration surface imports Express types directly. The emitted declarations reference `express` from `dist/interfaces/tenancy-module-options.interface.d.ts:3`, `dist/interfaces/tenant-extractor.interface.d.ts:1`, `dist/events/tenancy-events.d.ts:1`, and all built-in extractor declarations, which are re-exported from `dist/index.d.ts:4-40`.

This was reproduced in an isolated `/tmp` consumer by copying the packaged `dist/` output, wiring only the non-optional peers (`@nestjs/*`, `@prisma/client`, `rxjs`, `@types/node`), and running `tsc`. The remaining failures were all `TS2307: Cannot find module 'express'`.

Why this matters:
- Fastify or non-Express NestJS consumers can install the package in a configuration the metadata claims is valid, then fail type-checking immediately.
- This is the same class of release blocker as the previous optional-dependency metadata mismatch: the published package advertises a looser compatibility contract than the actual artifact supports.

### P2. Advertised Nest 10 / Prisma 5 compatibility is not gated by real-database E2E coverage

Affected files:
- `.github/workflows/ci.yml`
- `README.md`
- `test/e2e/prisma-extension.e2e-spec.ts`

The compatibility matrix in `.github/workflows/ci.yml:37-61` overrides dependencies for Nest 10 / Prisma 5, but only runs `npm test` and `npm run build`. The real-database E2E job (`.github/workflows/ci.yml:63-91`) runs only on the default stack. Meanwhile, the README still advertises `NestJS 10 & 11` and `Prisma 5 & 6` compatibility (`README.md:34`).

Why this matters:
- The riskiest 0.8.0 path, `interactiveTransactionSupport`, depends on Prisma private APIs and only has real-database verification on the default toolchain.
- A Prisma 5 runtime regression can still ship even though the release messaging claims that stack is supported.

### P3. `interactiveTransactionSupport` documentation still contradicts the implemented behavior

Affected files:
- `README.md`
- `src/prisma/prisma-tenancy.extension.ts`

The option table correctly documents `interactiveTransactionSupport` as transparent support (`README.md:151`), and the dedicated section documents the transparent mode (`README.md:175-187`). But the note immediately above still says interactive transactions always require a manual `set_config()` call (`README.md:156`). The same stale limitation remains in the Prisma extension JSDoc (`src/prisma/prisma-tenancy.extension.ts:61-67`) even though the implementation now supports the transparent path (`src/prisma/prisma-tenancy.extension.ts:169-189`) and the E2E suite covers it (`test/e2e/prisma-extension.e2e-spec.ts:277-348`).

Why this matters:
- Users can be pushed away from a 0.8.0 feature that now exists and is tested.
- Generated declaration comments and README guidance currently tell two different stories about the same capability.

### P3. `SECURITY.md` still documents obsolete supported release lines

Affected files:
- `SECURITY.md`
- `package.json`
- `CHANGELOG.md`

`SECURITY.md:5-10` still lists `0.5.x` as the newest supported line and omits the active `0.8.0` release family documented in `package.json:3` and `CHANGELOG.md:7-18`.

Why this matters:
- Vulnerability-reporting guidance is internally inconsistent at release time.
- Security policy drift undermines trust in maintenance and support commitments.

## Strengths

- The operational blockers from the 0.7.0 report are fixed in the current tree: build, lint, unit tests, and pack all pass locally.
- Regression coverage exists for the previously missing cases: span cleanup on hook failure, mixed `current_setting()` drift detection, custom `dbSettingKey`, and `interactiveTransactionSupport` E2E.
- README and changelog coverage are materially improved relative to 0.7.0, with cross-checking, telemetry, events, and CLI drift checks now broadly documented.

## Verdict

0.8.0 is not fully release-ready in the current repository state on 2026-04-04.

The hard blocker is the package contract mismatch around `@types/express`: the published artifact currently requires an Express type dependency that the metadata marks optional. The remaining issues are lower severity, but they still weaken the credibility of the release story: compatibility claims are not fully E2E-gated, the interactive-transaction docs are partially stale, and the security policy has not kept up with the release line.

## Recommended Next Actions

1. Resolve the `@types/express` contract mismatch before publishing: either make the dependency non-optional, or remove Express-specific types from the exported declaration surface.
2. Decide whether Prisma 5 / Nest 10 support is a tested guarantee or a best-effort claim, then align CI and README accordingly.
3. Remove the stale manual-`set_config()` guidance from README and Prisma extension JSDoc so 0.8.0 documentation matches the implemented feature set.
4. Update `SECURITY.md` to include the currently supported release lines.
