# v0.13.0 Tenant-Aware Cache Interceptor - Design Spec

Date: 2026-06-05
Status: Draft

## Goal

Ship a focused v0.13.0 feature that prevents cross-tenant HTTP response cache leakage by providing a NestJS cache interceptor that automatically includes the current tenant context in generated cache keys.

The feature should integrate with NestJS `@nestjs/cache-manager` rather than replacing it. Users should keep their existing `CacheModule`, cache stores, `@CacheTTL()`, and `@CacheKey()` usage, while `@nestarc/tenancy` adds tenant-aware key namespacing.

## Context

`@nestarc/tenancy` already protects database access through PostgreSQL RLS and Prisma query scoping, but the README explicitly notes that RLS is not resource isolation and that non-database cache keys must include tenant IDs. This is currently guidance only; users still need to remember to add tenant prefixes by hand.

The v0.11.0 roadmap identified `Tenant-Aware Cache Interceptor` as a high-impact feature because Redis and in-memory caches can leak data between tenants when identical URLs or manual cache keys are reused. This release should convert that warning into a reusable, testable library primitive.

NestJS supports response caching through `@nestjs/cache-manager` and documents `CacheInterceptor` subclassing via `trackBy()` overrides for custom cache key behavior. The v0.13.0 design should use that extension point and stay compatible with NestJS 10 and 11.

## References

- `README.md`: RLS operational note about cache keys and non-database resource isolation.
- `docs/v0.11.0-roadmap.md`: original Tenant-Aware Cache Interceptor roadmap item.
- NestJS caching documentation: https://docs.nestjs.com/techniques/caching

## Release Principles

1. Prevent cache-key collisions across tenants by default.
2. Build on `@nestjs/cache-manager`; do not introduce a custom cache store.
3. Keep cache integration optional so current users do not need caching dependencies.
4. Preserve existing tenancy semantics: `@BypassTenancy()` bypasses guard enforcement only; it does not clear tenant context.
5. Prefer explicit shared-cache opt-in over implicit unscoped cache behavior.
6. Keep the first release HTTP-focused; leave service-method caching and distributed invalidation for later.

## In Scope

### 1. `TenantCacheInterceptor`

Add a NestJS interceptor that subclasses `CacheInterceptor` from `@nestjs/cache-manager` and prefixes cache keys with tenant context.

Default key behavior:

```text
tenant:{tenantIdLength}:{tenantId}:{baseCacheKey}
```

For a request with tenant `acme` and a base NestJS key such as `GET:/products?limit=20`, the effective key becomes:

```text
tenant:acme:GET:/products?limit=20
```

Required behavior:

- For tenant-scoped requests, include the tenant ID in the cache key.
- Preserve NestJS cache behavior for TTL, cache store selection, and supported HTTP methods.
- Return `undefined` from `trackBy()` when the base `CacheInterceptor` would not cache the request.
- Do not cache tenant-required HTTP routes without a tenant context.
- Support bypassed/public routes through explicit shared-cache metadata.

Files:

- `src/cache/tenant-cache.interceptor.ts`
- `src/cache/index.ts`
- `src/index.ts`
- `test/tenant-cache.interceptor.spec.ts`

### 2. Shared Cache Opt-In

Add metadata for routes whose cache should be shared across tenants.

Proposed API:

```typescript
import { SharedTenantCache, TenantCacheInterceptor } from '@nestarc/tenancy/cache';
import { CacheTTL } from '@nestjs/cache-manager';

@UseInterceptors(TenantCacheInterceptor)
@SharedTenantCache()
@CacheTTL(60)
@Get('/public/catalog')
findPublicCatalog() {
  return this.catalogService.findPublicCatalog();
}
```

Shared key behavior:

```text
shared:{baseCacheKey}
```

Required behavior:

- Shared cache must be explicit through `@SharedTenantCache()`.
- Shared cache should work with and without current tenant context.
- Shared cache should not emit tenancy bypass events; it is cache metadata, not tenancy authorization metadata.
- `@SharedTenantCache()` should be usable at method and controller class level.

Files:

- `src/decorators/shared-tenant-cache.decorator.ts`
- `src/tenancy.constants.ts`
- `src/index.ts`
- `test/shared-tenant-cache.decorator.spec.ts`
- `test/tenant-cache.interceptor.spec.ts`

### 3. Configurable Key Prefixes

Support constructor options for teams that need different namespace strings or tenant ID normalization.

Proposed API:

```typescript
new TenantCacheInterceptor(cacheManager, reflector, {
  tenantPrefix: 'tenant',
  sharedPrefix: 'shared',
  separator: ':',
  hashTenantId: false,
});
```

Required behavior:

- Defaults work without options.
- `tenantPrefix`, `sharedPrefix`, and `separator` customize key formatting.
- `hashTenantId: true` hashes tenant IDs before including them in keys, reducing tenant ID exposure in external cache systems.
- Hashing uses Node.js built-in `crypto`; no new dependency is introduced.

Files:

- `src/cache/tenant-cache.interceptor.ts`
- `src/cache/tenant-cache-options.interface.ts`
- `test/tenant-cache.interceptor.spec.ts`

### 4. Optional Peer Dependency Metadata

Add `@nestjs/cache-manager` and `cache-manager` as optional peer dependencies if they are not already present.

Required behavior:

- Existing users who do not use caching should not need to install cache packages.
- TypeScript source can compile in this repository by adding dev dependencies for tests.
- Runtime import errors should be understandable if a user imports `TenantCacheInterceptor` without installing cache dependencies.

Files:

- `package.json`
- `package-lock.json`
- `README.md`

### 5. Documentation

Document how to use the interceptor safely.

Required documentation:

- Basic `CacheModule` setup.
- Per-route usage with `@UseInterceptors(TenantCacheInterceptor)`.
- Global interceptor usage with `APP_INTERCEPTOR`.
- Interaction with `@CacheTTL()` and `@CacheKey()`.
- Shared/public cache example with `@SharedTenantCache()`.
- Warning that cache invalidation remains the application/store responsibility.
- Warning that tenant-aware cache keys protect key collisions but not authorization logic.

Files:

- `README.md`
- `CHANGELOG.md`
- Optional: `docs/roadmap.md`

## Out of Scope

- Service-method caching decorators.
- Cache invalidation APIs such as `evictTenantCache()` or tag-based purge.
- Redis-specific implementation details.
- Cache warming.
- Cross-process or distributed cache consistency guarantees.
- Per-tenant rate limiting.
- WebSocket cache support.
- GraphQL field-level cache support.
- Automatic caching of non-HTTP RPC handlers.
- Changing `@BypassTenancy()` semantics.

## Design Decisions

### Interceptor-Based Integration

The first release should subclass NestJS `CacheInterceptor` instead of wrapping the cache manager directly. This keeps compatibility with existing `@nestjs/cache-manager` behavior and lets NestJS remain responsible for TTL metadata, HTTP method filtering, and cache store abstraction.

The main custom behavior lives in `trackBy(context)`. The implementation should call `super.trackBy(context)` first. If NestJS returns no key, the tenant-aware interceptor also returns no key.

### Tenant Context Source

The interceptor should read the tenant from `TenancyContext.getCurrentTenantId()` rather than injecting request-scoped state. This matches existing propagation helpers such as `propagateTenantHeaders()` and keeps the interceptor usable when manually constructed.

The interceptor does not validate tenant IDs itself. Tenant extraction and validation remain the responsibility of `TenantMiddleware` and `TenancyGuard`.

### Missing Tenant Behavior

If a route is not marked shared and no tenant context exists, the interceptor should return `undefined` so the response is not cached.

Reasoning:

- Throwing from a cache interceptor would make global interceptor usage risky for public routes.
- Falling back to an unscoped key would reintroduce the leak this feature is meant to prevent.
- Returning `undefined` preserves the request path while avoiding unsafe cache writes.

### Shared Cache Metadata

`@SharedTenantCache()` should be the only built-in way to intentionally use a tenant-independent key. This makes public/shared caching visible in code review.

If both tenant context and shared-cache metadata are present, shared-cache metadata wins. This supports public routes that accept optional tenant headers without fragmenting identical public cache entries by tenant.

### Key Formatting

The base key should not be parsed or reordered by `@nestarc/tenancy`. It should be treated as an opaque string returned by NestJS.

Default formatting:

```typescript
`${tenantPrefix}${separator}${tenantId.length}:${tenantId}${separator}${baseKey}`
`${sharedPrefix}${separator}${baseKey}`
```

The non-hashed tenant ID component is length-prefixed so tenant IDs containing the configured separator cannot collide with opaque NestJS base keys. If `hashTenantId` is enabled, the tenant ID component is replaced with a stable SHA-256 hex digest. The base key remains unchanged because it is already controlled by NestJS and user-provided `@CacheKey()` metadata.

### Optional Dependency Handling

Because `@nestjs/cache-manager` is optional, `TenantCacheInterceptor` necessarily imports an optional package. That is acceptable because users only hit this path when they import the cache feature.

The README should state that cache users must install:

```bash
npm install @nestjs/cache-manager cache-manager
```

The package should mark these as optional peers so dependency managers warn correctly without forcing all tenancy users to install caching support.

## Proposed Public API

```typescript
export { TenantCacheInterceptor } from './cache/tenant-cache.interceptor';
export type { TenantCacheInterceptorOptions } from './cache/tenant-cache-options.interface';
export { SharedTenantCache } from './decorators/shared-tenant-cache.decorator';
```

Implementation note: expose this cache feature through `@nestarc/tenancy/cache` rather than the root entrypoint so root `@nestarc/tenancy` imports do not eagerly load the optional `@nestjs/cache-manager` runtime.

### Route-Level Usage

```typescript
import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { CacheTTL } from '@nestjs/cache-manager';
import { TenantCacheInterceptor } from '@nestarc/tenancy/cache';

@Controller('products')
export class ProductsController {
  @UseInterceptors(TenantCacheInterceptor)
  @CacheTTL(60)
  @Get()
  findAll() {
    return this.products.findAll();
  }
}
```

### Global Usage

```typescript
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CacheModule } from '@nestjs/cache-manager';
import { TenancyModule } from '@nestarc/tenancy';
import { TenantCacheInterceptor } from '@nestarc/tenancy/cache';

@Module({
  imports: [
    CacheModule.register(),
    TenancyModule.forRoot({ tenantExtractor: 'X-Tenant-Id' }),
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantCacheInterceptor,
    },
  ],
})
export class AppModule {}
```

### Shared Route Usage

```typescript
import { SharedTenantCache, TenantCacheInterceptor } from '@nestarc/tenancy/cache';

@UseInterceptors(TenantCacheInterceptor)
@SharedTenantCache()
@CacheTTL(300)
@Get('/public/catalog')
findPublicCatalog() {
  return this.catalog.findPublicCatalog();
}
```

## Internal Structure

```text
src/
  cache/
    index.ts
    tenant-cache.interceptor.ts
    tenant-cache-options.interface.ts
  decorators/
    shared-tenant-cache.decorator.ts
```

`TenantCacheInterceptor` dependencies should mirror NestJS `CacheInterceptor` constructor requirements for supported NestJS versions. If NestJS 10 and 11 constructor signatures differ, the implementation should use the narrowest compatible constructor signature validated by tests.

## Testing Plan

### Unit Tests

Add focused tests for:

- Tenant context prefixes the base cache key.
- No tenant and no shared metadata returns `undefined`.
- `@SharedTenantCache()` uses `shared:{baseKey}`.
- Method-level and class-level shared metadata work.
- Shared metadata wins over tenant context.
- `@CacheKey()` custom keys are still namespaced.
- `super.trackBy()` returning `undefined` remains `undefined`.
- Custom prefixes and separators format keys correctly.
- `hashTenantId` produces stable keys and does not expose the raw tenant ID.

### Integration-Style Tests

Use NestJS testing utilities to prove:

- A controller using `@UseInterceptors(TenantCacheInterceptor)` caches tenant A and tenant B separately for the same URL.
- A shared route reuses the same cache entry across tenant contexts.
- A public route without tenant context is not cached unless marked shared.

### Public API Tests

Extend public API smoke tests to assert:

- `TenantCacheInterceptor` is exported from the `@nestarc/tenancy/cache` subpath.
- `SharedTenantCache` is exported from the `@nestarc/tenancy/cache` subpath.
- `TenantCacheInterceptorOptions` type is importable.

### Verification Commands

The implementation plan should verify:

```bash
npm test
npm run lint
npm run build
```

Run `npm run test:e2e` only if the implementation touches request middleware, guard behavior, or package dependency behavior that cannot be covered by unit tests.

## Documentation Updates

README should add a "Tenant-Aware Caching" section near propagation or security guidance.

CHANGELOG should add a v0.13.0 entry covering:

- Added `TenantCacheInterceptor`.
- Added `@SharedTenantCache()`.
- Added optional cache-manager peer dependency guidance.

`docs/roadmap.md` should mark the cache interceptor item as completed if v0.13.0 ships this feature.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Optional cache dependency breaks non-cache users | Keep dependency optional and avoid importing cache code from eager module setup |
| NestJS 10/11 `CacheInterceptor` constructor differences | Add tests against installed NestJS version and keep constructor signature minimal |
| Shared cache accidentally used for tenant-sensitive routes | Require explicit `@SharedTenantCache()` and document review guidance |
| Tenant IDs exposed in Redis keys | Provide `hashTenantId` option |
| Global interceptor caches public routes unsafely | Missing tenant returns `undefined` unless shared metadata is present |
| Cache invalidation expectations exceed feature scope | Document that invalidation stays application/store-specific |

## Acceptance Criteria

- Users can install cache dependencies and use `TenantCacheInterceptor` without changing their cache store.
- Same URL and same `@CacheKey()` values produce different cache entries for different tenant contexts.
- Missing tenant context does not create unscoped cache entries by default.
- Public/shared routes can explicitly opt into shared cache entries.
- Public root exports expose the new interceptor, decorator, and options type.
- Unit tests, lint, and build pass after implementation.

## Deferred Follow-Ups

- Tenant cache eviction helper.
- Cache key debug logging or telemetry events.
- Per-tenant cache metrics.
- Service-method cache decorator.
- GraphQL-aware key generation.
- Redis key scan utilities for operational cleanup.
