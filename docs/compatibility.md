# Support, compatibility, and migrations

[Package overview](../README.md) · [Documentation index](./README.md) · [Runnable example](../examples/quickstart/README.md)

This reference describes the `@nestarc/tenancy` 0.16.x contract. Declared peer ranges and exact repository test targets have different scopes.

## Support and Compatibility

`@nestarc/tenancy` is pre-1.0. Security fixes are provided for the latest
published minor release line only; `0.16.x` is the current supported line. See
the [security policy](../SECURITY.md) for reporting and response targets.

Package compatibility ranges and repository verification are related, but
they are not the same claim:

| Area | v0.16.x contract | Current repository evidence |
|------|--------------------|----------------------------------------|
| Node.js | `^22.13.0 \|\| ^24.0.0` | Lint, unit/coverage, and build run on exact 22.13.0, the current Node 22 release, and the current Node 24 release. Database and infrastructure jobs run on current Node 22; publishing runs on current Node 24. |
| NestJS | Peer range `^10.0.0 \|\| ^11.0.0` | A strict, isolated packed-tarball consumer matrix covers exact NestJS 10.4.22 and 11.2.1 across both supported Prisma majors on current Node 22. The locked primary graph uses NestJS 11.2.1; separate fully published ecosystem lanes preserve exact NestJS 10.4.20 for the legacy graph and use exact 11.2.1 for the modern graph. |
| Prisma | Peer range `^6.0.0 \|\| ^7.0.0` | The packed consumer matrix covers exact Prisma 6.19.3 and 7.10.0 with each supported NestJS major. The locked primary and direct PostgreSQL lanes use 7.10.0, the PgBouncer matrix uses both exact versions, and separate fully published ecosystem lanes cover the exact legacy 6.19.3 and modern 7.10.0 graphs. |

The four-way consumer matrix installs the actual packed tarball with
`--strict-peer-deps` and without `--force`, `--legacy-peer-deps`, or another
peer bypass, then runs declaration typechecking and a minimal Nest/Prisma
runtime smoke. Its Nest 10 + Prisma 6 lane
also verifies the optional cache/event lower-bound representatives
`@nestjs/cache-manager@2.0.0`, `cache-manager@5.0.0`, and
`@nestjs/event-emitter@2.0.0` with `reflect-metadata@0.1.13`; its Nest 11 +
Prisma 7 lane verifies the repository-locked supported representatives 3.1.3,
7.2.8, and 3.1.0 respectively with `reflect-metadata@0.2.2`. The latter fixture
also pins `keyv@5.6.0` and `cacheable@2.5.0` so the cache module's peer and
declaration dependencies are reproducible. Optional peer ranges are not an
arbitrary cross-product: cache module 2 pairs with cache-manager 5, cache module
3 pairs with cache-manager 6/7, event-emitter 2 is verified on NestJS 10, and
event-emitter 3 supports NestJS 10/11. These exact versions describe the
top-level lane targets, not new patch-level minimums inside the declared peer
ranges. Each run intentionally resolves a fresh transitive graph so CI detects
upstream install drift; it is not a byte-for-byte frozen dependency snapshot.
Prisma data-path behavior remains the responsibility of the direct
PostgreSQL and Prisma 6/7 PgBouncer lanes rather than being duplicated in every
install-only consumer lane. The supported 0.16.x line declares Node.js
`^22.13.0 || ^24.0.0`. Older 0.15.x artifacts retain their published
Node.js `>=20.19.0` metadata, but Node.js 20 is
[upstream EOL](https://nodejs.org/en/about/previous-releases) and is not
supported by 0.16.x. Node 20 consumers must upgrade their runtime or remain on
the unsupported 0.15.x line. Node 26 support is not yet declared and requires
separate validation.

The Nestarc ecosystem gates are artifact-explicit and independent:

- `npm run test:e2e:ecosystem:published-only` preserves the committed, fully
  published NestJS 10.4.20 / Prisma 6.19.3 legacy graph.
- `npm run test:e2e:ecosystem:modern:published-only` installs the separate,
  fully published NestJS 11.2.1 / Prisma 7.10.0 modern graph. It verifies the
  complete committed lock and installed inventory against public npm registry
  resolutions, exact versions, SHA-512 integrity, and non-link/non-symlink
  isolation before running the API key → tenancy → RBAC → RLS/outbox →
  jobs → webhook real-database flow.

Hosted CI runs these as separate `ecosystem-e2e` and `ecosystem-modern-e2e`
jobs. Release validation reuses the complete CI workflow, so both published
graphs must pass before the publish job can run. The modern lane accepts no
candidate tarball or sibling source override. An unpublished tenancy tarball is
tested only through the legacy graph with
`npm run test:e2e:ecosystem:local-artifact -- --tenancy-tarball <absolute.tgz>`;
only tenancy is replaced, while the five sibling packages remain
registry-locked. Neither runner discovers adjacent repositories automatically.
See the [legacy fixture contract](https://github.com/nestarc/nestjs-tenancy/blob/main/test/ecosystem/fixture/README.md) and
[modern fixture contract](https://github.com/nestarc/nestjs-tenancy/blob/main/test/ecosystem/modern-fixture/README.md) for the
exact package tuples and commands.

The automatic tenant-isolation guarantee does not currently cover:

- Raw Prisma operations (`$queryRaw` / `$executeRaw`), which bypass the model extension.
- WebSocket inbound tenant enforcement or context restoration; the supported non-HTTP transports are Kafka, Bull, and gRPC.
- Prisma Data Proxy, managed poolers, or custom PgBouncer configurations. These remain outside the repository support guarantee; deployment owners must validate their exact configuration with equivalent matrix scenarios.

See [Fail-Closed Mode](./prisma.md#fail-closed-mode), [Inbound Context Restoration](./integrations.md#inbound-context-restoration-interceptor), and the [PgBouncer Support Contract](./operations.md#pgbouncer-support-contract) for the corresponding operational requirements.

## Deprecation Policy

Deprecated public APIs are marked with `@deprecated` JSDoc and listed in the changelog. Unless a security issue requires faster removal, deprecated APIs are planned for removal two minor versions later or at the next major release, whichever comes first.

The exact schedule and migration contract are recorded in the
[deprecated API removal ADR](https://github.com/nestarc/nestjs-tenancy/blob/main/docs/2026-08-30-deprecated-api-removal-adr.md).

| API | Added | Deprecated | Last supported | Removal target | Replacement |
|-----|-------|------------|----------------|----------------|-------------|
| `interactiveTransactionSupport` | v0.6.0 | v0.15.0 | v0.16.x | v0.17.0 | `tenancyTransaction()` (public Prisma APIs) |

The event payload optional `request` field was deprecated in v0.11.0 and
removed in v0.16.0 after v0.15.x as its last supported line. Use
`requestSummary`, available since v0.11.0.

## Earlier migration notes

The flat `crossCheckExtractor` / `onCrossCheckFailed` options were removed in v0.12.0. Use the nested shape:

```typescript
TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',
  crossCheck: {
    extractor: new JwtClaimTenantExtractor({ claimKey: 'org_id' }),
    onFailed: 'reject',
    required: true,
  },
});
```

This JWT cross-check requires signature verification before tenant middleware; see [authentication ordering](./http.md#authentication-before-tenant-resolution).

HTTP uses UUID-like validation by default. RPC keeps non-empty-string compatibility during 0.x, so supply `validateTenantId` explicitly. The planned v1.0.0 default and migration rationale are recorded in the [RPC validation ADR](https://github.com/nestarc/nestjs-tenancy/blob/main/docs/2026-08-29-rpc-tenant-validation-compatibility-adr.md).
