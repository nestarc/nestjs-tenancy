# v0.12.0 API Cleanup and Safety Release - Design Spec

Date: 2026-05-23
Status: Draft

## Goal

Ship v0.12.0 as a focused API cleanup and safety release before larger v1.0.0 work. The release should remove deprecated configuration, tighten package and CLI behavior, add consumer-facing export checks, and clarify high-risk tenancy semantics without expanding the library into new runtime feature areas.

This is a small breaking-change release: deprecated fields that already warn about v0.12.0 removal are removed, while supported replacement APIs remain stable.

## Context

The current package is already broad: HTTP request tenancy, AsyncLocalStorage context, Prisma RLS integration, testing utilities, event/telemetry hooks, CLI scaffolding/checking, and microservice propagation are all implemented and covered by unit tests. The main remaining risk is not missing feature breadth; it is ambiguity around public surface, local operational reliability, and security-sensitive semantics.

Recent investigation found these release drivers:

- `crossCheckExtractor` and `onCrossCheckFailed` are deprecated with warnings that say they are planned for removal in v0.12.0.
- Public barrel exports are not tested as a consumer would import them.
- README says Node.js >= 18, but `package.json` has no `engines` field.
- Local `npm run test:e2e` depends on ambient `DATABASE_URL` during Prisma generation.
- `prompts` is optional, but `tenancy init` requires it for interactive mode.
- `@BypassTenancy()` bypasses guard enforcement but does not clear tenant context, which is easy to misunderstand.
- `interactiveTransactionSupport` depends on Prisma private APIs and should remain clearly secondary to `tenancyTransaction()`.

## Release Principles

1. Prefer cleanup over new feature scope.
2. Make consumer-facing behavior testable from package entry points.
3. Do not silently weaken tenant isolation.
4. Keep compatibility notes explicit when behavior is breaking or operationally sensitive.
5. Leave multi-database strategies, admin APIs, rate limiting, and caching for later roadmap items.

## In Scope

### 1. Remove Deprecated Cross-Check Options

Remove `crossCheckExtractor` and `onCrossCheckFailed` from `TenancyModuleOptions` and `TenantMiddleware`.

Supported replacement:

```typescript
TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',
  crossCheck: {
    extractor: new JwtClaimTenantExtractor('tenant_id'),
    onFailed: 'reject',
    required: true,
  },
});
```

Required behavior:

- `crossCheck.extractor` remains the only cross-check configuration entrypoint.
- `crossCheck.onFailed` keeps existing `'reject' | 'log'` behavior.
- `crossCheck.required` keeps existing missing-secondary-source behavior.
- README and migration notes include a direct before/after example.

Files:

- `src/interfaces/tenancy-module-options.interface.ts`
- `src/middleware/tenant.middleware.ts`
- `test/tenant.middleware.spec.ts`
- `README.md`

### 2. Add Public API Smoke Tests

Add tests that import from the package public entrypoints instead of internal source modules.

Required coverage:

- Root entrypoint exports module, services, extractors, decorators, Prisma helpers, propagation helpers, events, telemetry, errors, and public types.
- Testing subpath exports `TestTenancyModule`, `withTenant`, and `expectTenantIsolation`.
- Tests should protect the package export contract without asserting every internal implementation detail.

Preferred implementation:

- Add a focused Jest test that imports from `../src` and `../src/testing` for source-level coverage.
- Add a build-time package smoke script only if source-level tests are insufficient to catch `package.json` export drift.

Files:

- `test/public-api.spec.ts`
- `test/testing-public-api.spec.ts` or a combined public API spec
- `src/index.ts`
- `src/testing/index.ts`

### 3. Add Node Engine Metadata

Add an `engines` field matching the documented runtime support:

```json
{
  "engines": {
    "node": ">=18"
  }
}
```

Required behavior:

- README and package metadata agree on Node.js support.
- No stricter Node version is introduced without CI matrix changes.

Files:

- `package.json`
- `README.md` if wording needs alignment

### 4. Stabilize Local E2E Runner

Make `npm run test:e2e` deterministic in a clean shell.

Required behavior:

- `scripts/test-e2e.js` sets default `DATABASE_URL` and `APP_DATABASE_URL` before running `prisma generate` and Jest, unless the user already provided them.
- Existing CI-provided environment variables remain respected.
- Docker teardown still runs in `finally`.

Files:

- `scripts/test-e2e.js`
- `test/e2e/global-setup.ts` only if duplicate defaults should be centralized

### 5. Decide and Encode `prompts` Dependency Policy

The `tenancy init` command currently requires `prompts`, but the dependency is marked optional. v0.12.0 should make the install behavior match the CLI behavior.

Preferred decision:

- Move `prompts` from `optionalDependencies` to `dependencies`.

Reasoning:

- `tenancy init` is a primary documented command.
- The package already handles optional runtime integrations through peer dependencies, but the CLI prompt package is required for the documented interactive path.
- A non-interactive CLI mode is useful, but it is not required for v0.12.0.

Files:

- `package.json`
- `package-lock.json`
- `src/cli/init.ts` only if error text needs simplification

### 6. Make CLI Shebang Injection Idempotent

Update `postbuild` so repeated execution does not prepend duplicate shebangs.

Required behavior:

- Fresh `npm run build` still emits an executable CLI file.
- Running the postbuild command twice leaves exactly one shebang.

Preferred implementation:

- Replace inline `node -e` with a small script if readability becomes poor.
- Keep the behavior cross-platform.

Files:

- `package.json`
- Optional: `scripts/ensure-cli-shebang.js`

### 7. Clarify Bypass Semantics

Document and test the distinction between guard bypass and tenant-context bypass.

Required behavior:

- `@BypassTenancy()` means "do not require a tenant for this HTTP route."
- It does not clear an existing tenant context when a tenant header is present.
- `TenancyService.withoutTenant()` remains the explicit API for unscoped Prisma access.

Required documentation:

- Add a short README note near `@BypassTenancy()` and `withoutTenant()`.
- Include an example showing a bypassed route using `withoutTenant()` for admin/cross-tenant queries.

Optional test:

- A guard/middleware integration-style unit test that proves a bypassed route can still observe tenant context when a valid tenant header is present.

Files:

- `README.md`
- `test/bypass-tenancy.decorator.spec.ts`
- `test/tenancy.guard.spec.ts` or `test/tenant.middleware.spec.ts`

### 8. Reframe Transparent Interactive Transaction Support

Keep `interactiveTransactionSupport` available, but document it as a compatibility-sensitive path. `tenancyTransaction()` should be the recommended default for interactive transactions because it uses public Prisma APIs.

Required behavior:

- No behavior change is required in the extension for v0.12.0.
- README should present `tenancyTransaction()` first and mark transparent support as opt-in for teams that accept Prisma internal API risk.
- Existing E2E coverage remains.

Files:

- `README.md`
- `src/prisma/prisma-tenancy.extension.ts` comments only if wording should match docs

## Out of Scope

- Schema-per-tenant or database-per-tenant support.
- Tenant-aware cache interceptors.
- Tenant-scoped logging APIs.
- Per-tenant rate limiting.
- Runtime tenant provisioning services.
- New ORM adapters.
- New admin bypass APIs beyond documentation for existing `withoutTenant()`.
- Prisma 7-specific compatibility work unless it is needed to keep existing tests passing.

## Design Decisions

### Breaking Change Policy

Removing `crossCheckExtractor` and `onCrossCheckFailed` is acceptable in v0.12.0 because the code already emits a targeted deprecation warning naming this release. The migration path is direct and already implemented.

The release notes must call this out as breaking.

### Dependency Policy

`prompts` should be a regular dependency. Optional peer dependencies remain the right model for integrations that consumers may not use, such as OpenTelemetry and Nest EventEmitter. The CLI prompt library is different because it is required for a documented package command.

### Public API Testing Policy

Public API tests should protect consumer behavior, not freeze all internal file layout. Tests should import from barrels and validate representative runtime values or type availability. They should not duplicate all existing unit tests.

### Bypass Policy

Do not change `@BypassTenancy()` semantics in v0.12.0. Clearing tenant context automatically could surprise users who intentionally use bypassed routes while still needing tenant-aware services. Documentation is safer than runtime behavior changes.

## Execution Order

1. Remove deprecated cross-check options and update tests.
2. Add public API smoke tests.
3. Add Node engine metadata.
4. Stabilize `scripts/test-e2e.js` environment defaults.
5. Move `prompts` to regular dependencies.
6. Make CLI shebang injection idempotent.
7. Update README for migration, bypass semantics, transaction guidance, and dependency/runtime notes.
8. Run unit tests, build, lint, and e2e if Docker is available.
9. Bump version and prepare release notes after implementation is verified.

## Testing Strategy

Required local verification:

- `npm test -- --runInBand`
- `npm run build`
- `npm run lint`

Recommended release verification:

- `npm run test:e2e`
- `npm pack --dry-run --json`
- A clean install smoke test against the generated tarball if time permits.

Specific regression checks:

- Deprecated cross-check fields no longer compile against `TenancyModuleOptions`.
- `crossCheck` object form continues to reject, log, and require secondary extraction as before.
- Public root and testing subpath imports work.
- Local e2e runner works without manually exporting `DATABASE_URL`.
- Built CLI has one shebang after repeated postbuild execution.

## Documentation Requirements

README updates must include:

- v0.12.0 migration note for removed cross-check fields.
- Current `crossCheck` examples only.
- Explicit statement that JWT claim extraction decodes claims but does not verify signatures.
- Explicit `@BypassTenancy()` vs `withoutTenant()` distinction.
- Interactive transaction recommendation: prefer `tenancyTransaction()`, opt into transparent support knowingly.
- Node.js >= 18 consistency with `package.json`.

## Success Criteria

- Deprecated cross-check API is removed from source, tests, and docs.
- Existing supported `crossCheck` behavior remains covered.
- Public entrypoint tests fail if a major export is accidentally dropped.
- Local e2e script no longer relies on ambient database URLs.
- CLI dependency metadata matches documented behavior.
- Build output contains exactly one CLI shebang.
- README no longer describes removed configuration.
- Unit tests, build, and lint pass after implementation.

## Risks

- Removing deprecated fields can break users who ignored warnings. Mitigation: release notes include a clear migration snippet.
- Moving `prompts` into dependencies increases install footprint slightly. Mitigation: it makes documented CLI behavior reliable.
- Public API tests can become noisy if they assert too much. Mitigation: assert representative exports and importability, not implementation details.
- E2E stabilization may expose local Docker or port conflicts. Mitigation: keep defaults overridable through environment variables.
