# 0.6.0 Validation Report

Date: 2026-04-02
Project: `@nestarc/tenancy` 0.6.0

## Scope

- Local verification by main agent
- Parallel review by specialist subagents
- Review focus: architecture/API compatibility, tenant-isolation behavior, CLI/DX, testing, release readiness

## Review Team

- Main agent: local verification, docs/DX review, risk integration
- Architecture/API reviewer subagent: public API design, backwards-compatibility, extensibility
- Testing/release reviewer subagent: verification quality, packaging, CI/release risks

## Executed Checks

- `npm run lint` -> pass
- `npm test` -> pass (`31` suites, `281` tests)
- `npm run build` -> pass
- `npm pack --dry-run --cache /tmp/npm-cache-codex` -> pass
- `npm run test:e2e` -> could not complete (`Docker daemon unavailable`)

## Findings

### P1. New propagation/interceptor examples depend on `TenancyContext`, but the package does not export it

Affected files:
- `src/index.ts`
- `package.json`
- `README.md`
- `CHANGELOG.md`

0.6.0 documents usage such as `new TenancyContext()` for `HttpTenantPropagator`, `BullTenantPropagator`, and `TenantContextInterceptor`, but the root package entrypoint does not export `TenancyContext` (`src/index.ts:1-46`). The package only exposes `.` and `./testing` subpaths (`package.json:10-25`).

Why this matters:
- Consumers cannot follow the new documented examples through supported imports.
- This makes a headline 0.6.0 feature set partially unusable from the official public surface.

### P1. CLI `check` can report false green because it only compares table coverage, not actual policy drift

Affected files:
- `src/cli/check.ts`
- `test/cli/check.spec.ts`
- `CHANGELOG.md`

`runCheck()` only parses `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` statements and compares table names (`src/cli/check.ts:48-88`). It does not verify:

- `FORCE ROW LEVEL SECURITY`
- `CREATE POLICY` presence
- `current_setting(...)` key correctness
- policy body correctness

That means `tenancy-setup.sql` can be materially wrong while `check` still exits successfully. The tests mirror this limitation and only cover table presence/absence (`test/cli/check.spec.ts:26-166`).

Why this matters:
- 0.6.0 presents `check` as a drift detector in the changelog, but today it is a table-coverage detector.
- Users can get a successful validation result while tenant isolation SQL is still misconfigured.

### P1. Deprecated `experimentalTransactionSupport` is no longer a safe compatibility path

Affected files:
- `src/prisma/prisma-tenancy.extension.ts`
- `CHANGELOG.md`
- `README.md`

In 0.6.0, `experimentalTransactionSupport` feeds directly into the new startup-time validation path (`src/prisma/prisma-tenancy.extension.ts:86-109`). If Prisma does not expose `_createItxClient`, extension creation now throws immediately instead of preserving the old fallback-style behavior.

That conflicts with the migration framing in the changelog and README, which present the old flag as still working with only a deprecation warning (`CHANGELOG.md:22-39`, `README.md:141-177`).

Why this matters:
- This is effectively a hidden compatibility break for users who stayed on the deprecated flag.
- The public migration story currently understates the operational change.

### P1. The documented HTTP interceptor path is broken with the current global guard and weaker than the middleware path

Affected files:
- `src/propagation/tenant-context.interceptor.ts`
- `src/guards/tenancy.guard.ts`
- `src/tenancy.module.ts`
- `src/interfaces/tenancy-module-options.interface.ts`
- `src/middleware/tenant.middleware.ts`

The interceptor is documented as an HTTP alternative to `TenantMiddleware` (`src/propagation/tenant-context.interceptor.ts:37-38`), but `TenancyModule` still installs a global `APP_GUARD` that reads tenant context before interceptors run (`src/tenancy.module.ts:31-43`, `src/guards/tenancy.guard.ts:21-40`).

That means a user who replaces the middleware with the interceptor for HTTP will still hit the guard first with an empty `TenancyContext`, and protected routes will return `403`.

If users work around that by disabling or bypassing the guard, they still lose important behavior that only exists in the middleware path:

- configured extractor strategy
- `validateTenantId`
- `onTenantResolved`
- `onTenantNotFound`
- event emission

Why this matters:
- The currently documented HTTP integration path does not compose with the module's default runtime ordering.
- The obvious workaround weakens the input-validation and hook surface for tenant identity.

### P2. `TenantContextInterceptor` is broader and less predictable than the new transport abstraction implies

Affected files:
- `src/propagation/tenant-context.interceptor.ts`
- `src/interfaces/tenant-context-carrier.interface.ts`

The new interceptor restores tenant context with transport-specific heuristics:

- `ctx.getMessage()` => Kafka
- `ctx.get()` + `ctx.set()` => gRPC
- any RPC payload object => Bull-style extraction

See `src/propagation/tenant-context.interceptor.ts:104-152`.

This has two API problems:

- It can accidentally bind tenant context for unrelated RPC transports or arbitrary payloads carrying the Bull key.
- `TenantContextCarrier<T>` is presented as the transport-agnostic abstraction, but the consumer-side restoration path is still hard-coded rather than pluggable.

Why this matters:
- Unsupported transports can silently opt into tenant restoration via generic payload shape.
- The transport abstraction is only half-open, which raises long-term maintenance risk.

### P2. `TenantContextInterceptor` has an observable lifecycle risk and missing regression coverage

Affected files:
- `src/propagation/tenant-context.interceptor.ts`
- `test/tenant-context-interceptor.spec.ts`

The interceptor manually creates a new `Observable` and subscribes to `next.handle()` without returning teardown (`src/propagation/tenant-context.interceptor.ts:77-81`).

```ts
return new Observable((subscriber) => {
  this.context.run(tenantId, () => {
    next.handle().subscribe(subscriber);
  });
});
```

That pattern does not explicitly propagate unsubscription to the inner subscription, which is risky for long-lived or streaming handlers. Current tests only cover short happy-path completions and do not exercise error, streaming, or unsubscribe behavior (`test/tenant-context-interceptor.spec.ts:76-218`).

Why this matters:
- Transport-level interceptors are often used on streams and long-lived consumers.
- A leak or stuck subscription here would be hard to diagnose in production.

### P2. README and release docs are behind the shipped 0.6.0 surface

Affected files:
- `README.md`
- `src/index.ts`
- `src/cli/index.ts`
- `CHANGELOG.md`

The package exports 0.6.0 APIs for:

- `BullTenantPropagator`
- `KafkaTenantPropagator`
- `GrpcTenantPropagator`
- `TenantContextInterceptor`
- `TenantContextCarrier`

See `src/index.ts:26-38`.

However, the README still documents the old `experimentalTransactionSupport` path as the primary interactive-transaction option and does not document the new stable `interactiveTransactionSupport` option (`README.md:141-177`). The microservice section still only covers HTTP propagation and `HttpTenantPropagator` (`README.md:575-617`). The CLI help advertises `check`, but README coverage for `check`, `--dry-run`, and multi-schema support is missing (`src/cli/index.ts:5-23`). Some examples also rely on `TenancyContext`, which is not exported from the root package.

Why this matters:
- 0.6.0 users will read stale guidance for one of the release's headline changes.
- Support load moves from code defects to avoidable integration confusion.

### P3. Compatibility claims are broader than the verified matrix

Affected files:
- `package.json`
- `.github/workflows/ci.yml`
- `test/e2e/prisma-extension.e2e-spec.ts`

The package claims Nest `^10 || ^11` and Prisma `^5 || ^6` peer compatibility (`package.json:55-63`), but local dev dependencies are only Nest 11 and Prisma 6 (`package.json:72-94`), and CI only varies Node versions (`.github/workflows/ci.yml:12-28`). The E2E suite validates the Prisma extension against the default path only and does not exercise `interactiveTransactionSupport: true` on a real generated client (`test/e2e/prisma-extension.e2e-spec.ts:35-220`).

Why this matters:
- The compatibility promise is wider than the tested surface.
- The highest-risk path in 0.6.0 still depends on mocked Prisma internals in unit tests.

## Strengths

- Root exports are coherent: the new propagation interfaces, transport propagators, and interceptor are all available from the main package entrypoint.
- Transport integrations avoid hard runtime dependencies on BullMQ, KafkaJS, and `@grpc/grpc-js`, which keeps adoption friction low.
- Unit and type-check coverage remain strong enough to catch most straightforward regressions quickly.
- Packaging looks healthy: build output, CLI files, and published tarball contents were generated successfully.

## Verdict

0.6.0 is close to release quality, but not fully release-clean.

The core implementation quality is solid enough to ship behind normal caution, and the package builds/tests successfully. The remaining risks are concentrated in three places:

- validation confidence overstated by the new `check` command
- migration/docs accuracy around transaction support
- interceptor behavior at transport boundaries

If those gaps are addressed, 0.6.0 will have a much cleaner release story than its current code risk profile suggests.
