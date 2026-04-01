# 0.5.0 Validation Report

Date: 2026-04-01
Project: `@nestarc/tenancy` 0.5.0

## Scope

- Local verification by main agent
- Parallel review by specialist subagents
- Code review focus: security, public API, CLI/DX, test coverage, release readiness

## Executed Checks

- `npm run lint` -> pass
- `npm test` -> pass (`26` suites, `215` tests)
- `npm run build` -> pass
- `npm run test:e2e` -> pass (`2` suites, `19` tests)

## Findings

### P1. Generated RLS setup can fail open for table owners

Affected files:
- `src/cli/templates/setup-sql.ts`
- `README.md`

The generated SQL and Quick Start only enable RLS with `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. PostgreSQL table owners normally bypass RLS unless `ALTER TABLE ... FORCE ROW LEVEL SECURITY` is also applied, or ownership/runtime roles are separated correctly. Teams that run migrations and application traffic with the same role can follow the current guidance and still end up with no tenant isolation at runtime.

Why this matters:
- This is a tenant-isolation failure mode, not just a documentation gap.
- The current README only warns about superusers, which is incomplete for RLS safety.

### P2. `dbSettingKey` is easy to misconfigure and partly dead in module config

Affected files:
- `src/interfaces/tenancy-module-options.interface.ts`
- `src/tenancy.module.ts`
- `src/cli/templates/module-setup.ts`
- `src/prisma/prisma-tenancy.extension.ts`
- `src/prisma/tenancy-transaction.ts`
- `README.md`

`dbSettingKey` is exposed on `TenancyModule.forRoot()`, but the actual query path reads the key only from `createPrismaTenancyExtension()` and `tenancyTransaction()`. On top of that, the CLI scaffold only emits extension options when `autoInjectTenantId` or `sharedModels` is enabled, so a user can select a custom key and still get a generated Prisma snippet that silently keeps using `app.current_tenant`.

Why this matters:
- The API surface suggests one configuration point, but runtime behavior requires two more.
- Misconfiguration leads to confusing failures such as empty query results under RLS.

### P2. Custom regex can generate uncompilable scaffold code

Affected files:
- `src/cli/templates/module-setup.ts`
- `test/cli/templates.spec.ts`

The CLI inserts `customRegex` directly into a JavaScript regex literal:

```ts
validateTenantId: (id) => /${options.customRegex}/.test(id)
```

If the user enters a valid regex containing `/`, the generated TypeScript becomes syntactically invalid.

Example:
- Input: `^acme/.+$`
- Output: `validateTenantId: (id) => /^acme/.+$/.test(id),`

Why this matters:
- The CLI can produce broken scaffolding for valid user input.
- Current tests only cover slash-free patterns.

### P2. CLI does not support Prisma multi-schema models

Affected files:
- `src/cli/prisma-schema-parser.ts`
- `src/cli/templates/setup-sql.ts`
- `test/cli/prisma-schema-parser.spec.ts`

The Prisma schema parser keeps `modelName` and `@@map(...)`, but ignores `@@schema(...)`. The generated SQL then hardcodes `public` and emits unqualified table names. For multi-schema Prisma projects, the scaffold targets the wrong schema objects.

Why this matters:
- Generated SQL is incorrect for a valid Prisma feature set.
- There is no regression coverage for `@@schema(...)`.

### P2. Public API leaks Express types without declaring them for consumers

Affected files:
- `src/interfaces/tenant-extractor.interface.ts`
- `src/interfaces/tenancy-module-options.interface.ts`
- `src/events/tenancy-events.ts`
- `package.json`

Public exported types reference `express` `Request`/`Response`, but `express` and its types are not declared as runtime or peer dependencies for consumers. This narrows effective compatibility to Express-oriented Nest apps and can break consumer type-checking in non-Express setups.

Why this matters:
- The package claims broad NestJS compatibility.
- Consumers can hit install or type-resolution failures without obvious guidance.

### P3. Build and e2e scripts are POSIX-shell specific

Affected file:
- `package.json`

`postbuild` relies on `printf | cat | mv`, and `test:e2e` uses shell variables like `EXIT=$?`. These scripts are not portable to native Windows shells.

Why this matters:
- Release and validation workflows are less portable than the package surface suggests.
- CI or contributors on Windows may fail before reaching actual library code.

## Notes

- One subagent reported an e2e failure (`relation "users" does not exist`), but that result was not reproducible. The main agent reran `npm run test:e2e` successfully and excluded that report from final findings.
- Overall runtime behavior for the current happy path is solid: lint, unit tests, build, and e2e all pass locally.
- The largest remaining risks are release ergonomics and configuration correctness, not the core request-scoped tenant flow.
