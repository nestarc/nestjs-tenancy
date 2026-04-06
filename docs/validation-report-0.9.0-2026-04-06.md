# 0.9.0 Validation Report

Date: 2026-04-06
Project: `@nestarc/tenancy`

## Scope

- Local verification by main agent
- Review focus: 0.9.0 first follow-up fixes, release readiness, Windows developer experience, public type surface, docs consistency

## Executed Checks

- `git status --short` -> note: existing untracked report draft was present before validation
- `node -v` -> pass (`v24.14.1`)
- `npm run lint` -> pass
- `npm test` -> pass (`33` suites, `315` tests)
- `npm run build` -> pass
- `npm pack --dry-run` -> pass (`nestarc-tenancy-0.9.0.tgz`, `91` files, unpacked size `164.3 kB`)
- `npm run test:e2e` -> fail on native Windows shell (`Unrecognized option "runInBand;"`)
- Manual E2E sequence on the same tree:
  - `docker compose up -d --wait` -> pass
  - `prisma generate --schema=test/e2e/schema.prisma` -> pass
  - `jest --config test/e2e/jest.e2e.config.ts --runInBand` -> pass (`2` suites, `22` tests)
  - `docker compose down` -> pass

## Findings

### P2. `npm run test:e2e` is still not portable to the native Windows npm shell

Affected files:
- `package.json`

`package.json:36` still uses POSIX-style shell control flow:

`docker compose up -d --wait && prisma generate --schema=test/e2e/schema.prisma && jest --config test/e2e/jest.e2e.config.ts --runInBand; EXIT=$?; docker compose down; exit $EXIT`

On native Windows npm execution, the `;` after `--runInBand` is passed through to Jest as part of the CLI argument. This reproduces locally as:

- `Unrecognized option "runInBand;". Did you mean "runInBand"?`

Why this matters:
- Contributors on native Windows cannot run the documented E2E entrypoint successfully even though Docker, Prisma generation, and the E2E tests themselves are working.
- Cleanup is coupled to the same POSIX control flow, so a failed Windows run can also leave Docker resources running until they are manually stopped.

## Strengths

- The main 0.9.0 package surface is now framework-agnostic as intended. The exported request/response contracts use `TenancyRequest` / `TenancyResponse`, and the README lifecycle hook table matches that API.
- The package contract is cleaner than in 0.8.0: `@types/express` is no longer listed in `peerDependencies`, and the built declarations under `dist/` no longer import Express types.
- Local release-readiness checks are strong on the non-E2E path: lint, unit/integration tests, build, and `npm pack --dry-run` all pass on this tree.
- The E2E test code itself is healthy. When the npm script is bypassed and the same steps are executed directly, both E2E suites pass against PostgreSQL.
- `SECURITY.md` is now aligned with the active `0.9.x` line.

## Verdict

0.9.0 first follow-up is close to release-ready and materially improved from the earlier 0.9.0 validation draft.

The core release goals now validate successfully in this repository state on 2026-04-06:
- public API migration away from Express-specific types,
- passing lint/test/build/pack flows,
- synchronized README and security policy updates,
- passing real-database E2E tests when run directly.

The remaining gap is operational rather than functional: `npm run test:e2e` is still broken for native Windows shells because the script uses POSIX exit handling. That should be fixed before calling the local validation story fully complete across supported contributor environments.

## Recommended Next Actions

1. Replace `package.json` `test:e2e` shell chaining with a cross-platform Node helper or a portable script runner so Windows can execute the same validation command successfully.
2. Keep the manual E2E command sequence as the fallback verification path until the npm script is corrected.
3. Consider adding a Windows CI job that executes the package scripts directly, so shell portability regressions are caught automatically.
