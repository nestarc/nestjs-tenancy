# Tenant-Aware Cache Interceptor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a v0.13.0 tenant-aware HTTP response cache interceptor that namespaces NestJS cache keys by tenant and requires explicit opt-in for shared cache entries.

**Architecture:** Add an optional cache integration layer that subclasses `CacheInterceptor` from `@nestjs/cache-manager` and overrides `trackBy()` only. The interceptor reads tenant context from the existing static `TenancyContext`, uses metadata from a new `@SharedTenantCache()` decorator for public/shared routes, and leaves cache storage, TTL, and HTTP method behavior to NestJS. The feature is exported from the `@nestarc/tenancy/cache` subpath so root package imports do not eagerly load optional cache dependencies.

**Tech Stack:** TypeScript, NestJS 10/11, `@nestjs/cache-manager`, `cache-manager`, Jest, reflect-metadata, Node.js `crypto`

**Spec:** `docs/superpowers/specs/2026-06-05-tenant-aware-cache-interceptor-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/cache/tenant-cache-options.interface.ts` | Public options type for tenant cache key formatting |
| Create | `src/cache/tenant-cache.interceptor.ts` | Tenant-aware `CacheInterceptor` subclass and key formatting logic |
| Create | `src/cache/index.ts` | Cache feature barrel |
| Create | `src/decorators/shared-tenant-cache.decorator.ts` | Metadata decorator for shared cache routes/controllers |
| Modify | `src/tenancy.constants.ts` | Add shared-cache metadata key |
| Modify | `src/index.ts` | Export cache interceptor, options type, and decorator |
| Create | `test/shared-tenant-cache.decorator.spec.ts` | Verify decorator metadata |
| Create | `test/tenant-cache.interceptor.spec.ts` | Verify key namespacing, missing tenant behavior, options, and integration |
| Modify | `test/public-api.spec.ts` | Verify root public exports include cache API |
| Modify | `package.json` | Add optional peer metadata and dev dependencies for cache tests |
| Modify | `package-lock.json` | Reflect npm dependency resolution |
| Modify | `README.md` | Document tenant-aware caching usage and security semantics |
| Modify | `CHANGELOG.md` | Add v0.13.0 feature entry |
| Modify | `docs/roadmap.md` | Mark cache interceptor roadmap item as completed when release ships |

---

### Task 1: Add optional cache dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Confirm cache packages are not already installed**

Run:

```bash
npm ls @nestjs/cache-manager cache-manager
```

Expected before implementation: either an empty tree or missing dependency output. If either package is already present, still continue to Step 2 so package metadata can be made explicit.

- [ ] **Step 2: Add cache packages for development and tests**

Run:

```bash
npm install --save-dev @nestjs/cache-manager cache-manager
```

Expected: `package.json` and `package-lock.json` are updated. `@nestjs/cache-manager` and `cache-manager` appear under `devDependencies`.

- [ ] **Step 3: Add optional peer dependency metadata**

In `package.json`, add cache packages to `peerDependencies`:

```json
  "peerDependencies": {
    "@nestjs/cache-manager": "^2.0.0 || ^3.0.0",
    "@nestjs/common": "^10.0.0 || ^11.0.0",
    "@nestjs/core": "^10.0.0 || ^11.0.0",
    "@nestjs/event-emitter": "^2.0.0 || ^3.0.0",
    "@opentelemetry/api": "^1.0.0",
    "@prisma/client": "^5.0.0 || ^6.0.0",
    "cache-manager": "^5.0.0 || ^6.0.0",
    "reflect-metadata": "^0.1.13 || ^0.2.0",
    "rxjs": "^7.0.0"
  }
```

Add optional metadata:

```json
  "peerDependenciesMeta": {
    "@nestjs/cache-manager": {
      "optional": true
    },
    "@nestjs/event-emitter": {
      "optional": true
    },
    "@opentelemetry/api": {
      "optional": true
    },
    "cache-manager": {
      "optional": true
    }
  }
```

Keep whatever exact `devDependencies` versions `npm install` resolved. Do not manually pin them lower than the installed compatible versions.

- [ ] **Step 4: Verify dependency metadata installs cleanly**

Run:

```bash
npm install --package-lock-only
```

Expected: command exits 0 and does not remove cache peer metadata.

- [ ] **Step 5: Commit dependency metadata**

```bash
git add package.json package-lock.json
git commit -m "chore: add optional cache manager peer metadata"
```

---

### Task 2: Add shared cache metadata decorator

**Files:**
- Modify: `src/tenancy.constants.ts`
- Create: `src/decorators/shared-tenant-cache.decorator.ts`
- Create: `test/shared-tenant-cache.decorator.spec.ts`

- [ ] **Step 1: Write failing decorator metadata tests**

Create `test/shared-tenant-cache.decorator.spec.ts`:

```typescript
import 'reflect-metadata';
import { SHARED_TENANT_CACHE_KEY } from '../src/tenancy.constants';
import { SharedTenantCache } from '../src/decorators/shared-tenant-cache.decorator';

describe('SharedTenantCache', () => {
  it('should set SHARED_TENANT_CACHE_KEY metadata on a handler', () => {
    class TestController {
      @SharedTenantCache()
      handler() {}
    }

    const metadata = Reflect.getMetadata(
      SHARED_TENANT_CACHE_KEY,
      TestController.prototype.handler,
    );

    expect(metadata).toBe(true);
  });

  it('should set SHARED_TENANT_CACHE_KEY metadata on a controller class', () => {
    @SharedTenantCache()
    class TestController {}

    const metadata = Reflect.getMetadata(SHARED_TENANT_CACHE_KEY, TestController);

    expect(metadata).toBe(true);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npx jest test/shared-tenant-cache.decorator.spec.ts --runInBand
```

Expected: FAIL with TypeScript/module resolution errors because `SHARED_TENANT_CACHE_KEY` and `SharedTenantCache` do not exist yet.

- [ ] **Step 3: Add the metadata key**

In `src/tenancy.constants.ts`, after `BYPASS_TENANCY_KEY`, add:

```typescript
export const SHARED_TENANT_CACHE_KEY = Symbol.for(
  '@nestarc/tenancy/SHARED_TENANT_CACHE_KEY',
);
```

- [ ] **Step 4: Add the decorator**

Create `src/decorators/shared-tenant-cache.decorator.ts`:

```typescript
import { SetMetadata } from '@nestjs/common';
import { SHARED_TENANT_CACHE_KEY } from '../tenancy.constants';

/**
 * Marks a route or controller as safe to cache without tenant namespacing.
 *
 * Use only for data that is intentionally identical for every tenant.
 * This affects cache key generation only; it does not bypass tenancy guards
 * or clear tenant context.
 */
export const SharedTenantCache = () => SetMetadata(SHARED_TENANT_CACHE_KEY, true);
```

- [ ] **Step 5: Run the decorator test**

Run:

```bash
npx jest test/shared-tenant-cache.decorator.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit metadata decorator**

```bash
git add src/tenancy.constants.ts src/decorators/shared-tenant-cache.decorator.ts test/shared-tenant-cache.decorator.spec.ts
git commit -m "feat: add shared tenant cache decorator"
```

---

### Task 3: Add TenantCacheInterceptor unit behavior

**Files:**
- Create: `src/cache/tenant-cache-options.interface.ts`
- Create: `src/cache/tenant-cache.interceptor.ts`
- Create: `src/cache/index.ts`
- Create: `test/tenant-cache.interceptor.spec.ts`

- [ ] **Step 1: Write failing unit tests for key formatting**

Create `test/tenant-cache.interceptor.spec.ts` with this initial content:

```typescript
import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { SHARED_TENANT_CACHE_KEY } from '../src/tenancy.constants';
import { TenantCacheInterceptor } from '../src/cache/tenant-cache.interceptor';
import { TenancyContext } from '../src/services/tenancy-context';

type TrackByCapable = {
  trackBy(context: ExecutionContext): string | undefined;
};

class TestTenantCacheInterceptor extends TenantCacheInterceptor {
  constructor(reflector: Reflector, baseKey: string | undefined, options = {}) {
    const cacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      reset: jest.fn(),
      wrap: jest.fn(),
    };
    super(cacheManager as never, reflector, options);
    this.baseKey = baseKey;
  }

  private readonly baseKey: string | undefined;

  protected getBaseCacheKey(_context: ExecutionContext): string | undefined {
    return this.baseKey;
  }
}

function createExecutionContext(
  handler: Function = function handler() {},
  controller: Function = class Controller {},
): ExecutionContext {
  return {
    getType: () => 'http',
    getClass: () => controller,
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', url: '/products' }),
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    switchToRpc: () => ({}),
    switchToWs: () => ({}),
    getArgs: () => [],
    getArgByIndex: () => undefined,
  } as unknown as ExecutionContext;
}

describe('TenantCacheInterceptor', () => {
  let reflector: Reflector;
  let tenancyContext: TenancyContext;

  beforeEach(() => {
    reflector = new Reflector();
    tenancyContext = new TenancyContext();
  });

  it('should prefix base cache key with current tenant', async () => {
    const interceptor = new TestTenantCacheInterceptor(reflector, 'GET:/products');
    const execCtx = createExecutionContext();

    const result = await tenancyContext.run('tenant-a', () =>
      (interceptor as TrackByCapable).trackBy(execCtx),
    );

    expect(result).toBe('tenant:8:tenant-a:GET:/products');
  });

  it('should not cache when base interceptor returns undefined', async () => {
    const interceptor = new TestTenantCacheInterceptor(reflector, undefined);
    const execCtx = createExecutionContext();

    const result = await tenancyContext.run('tenant-a', () =>
      (interceptor as TrackByCapable).trackBy(execCtx),
    );

    expect(result).toBeUndefined();
  });

  it('should not cache missing tenant context unless route is shared', () => {
    const interceptor = new TestTenantCacheInterceptor(reflector, 'GET:/products');
    const execCtx = createExecutionContext();

    expect((interceptor as TrackByCapable).trackBy(execCtx)).toBeUndefined();
  });

  it('should use shared prefix for handler-level shared cache metadata', () => {
    function handler() {}
    Reflect.defineMetadata(SHARED_TENANT_CACHE_KEY, true, handler);
    const interceptor = new TestTenantCacheInterceptor(reflector, 'GET:/catalog');
    const execCtx = createExecutionContext(handler);

    expect((interceptor as TrackByCapable).trackBy(execCtx)).toBe('shared:GET:/catalog');
  });

  it('should use shared prefix for class-level shared cache metadata', () => {
    class CatalogController {}
    Reflect.defineMetadata(SHARED_TENANT_CACHE_KEY, true, CatalogController);
    const interceptor = new TestTenantCacheInterceptor(reflector, 'GET:/catalog');
    const execCtx = createExecutionContext(function handler() {}, CatalogController);

    expect((interceptor as TrackByCapable).trackBy(execCtx)).toBe('shared:GET:/catalog');
  });

  it('should let shared metadata win over tenant context', async () => {
    function handler() {}
    Reflect.defineMetadata(SHARED_TENANT_CACHE_KEY, true, handler);
    const interceptor = new TestTenantCacheInterceptor(reflector, 'GET:/catalog');
    const execCtx = createExecutionContext(handler);

    const result = await tenancyContext.run('tenant-a', () =>
      (interceptor as TrackByCapable).trackBy(execCtx),
    );

    expect(result).toBe('shared:GET:/catalog');
  });

  it('should support custom prefixes and separator', async () => {
    const interceptor = new TestTenantCacheInterceptor(reflector, 'GET:/products', {
      tenantPrefix: 'org',
      sharedPrefix: 'global',
      separator: '|',
    });
    const execCtx = createExecutionContext();

    const result = await tenancyContext.run('tenant-a', () =>
      (interceptor as TrackByCapable).trackBy(execCtx),
    );

    expect(result).toBe('org|tenant-a|GET:/products');
  });

  it('should hash tenant ID when hashTenantId is true', async () => {
    const interceptor = new TestTenantCacheInterceptor(reflector, 'GET:/products', {
      hashTenantId: true,
    });
    const execCtx = createExecutionContext();

    const result = await tenancyContext.run('tenant-a', () =>
      (interceptor as TrackByCapable).trackBy(execCtx),
    );

    expect(result).toMatch(/^tenant:[a-f0-9]{64}:GET:\/products$/);
    expect(result).not.toContain('tenant-a');
  });
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
npx jest test/tenant-cache.interceptor.spec.ts --runInBand
```

Expected: FAIL because `src/cache/tenant-cache.interceptor.ts` does not exist.

- [ ] **Step 3: Add the options type**

Create `src/cache/tenant-cache-options.interface.ts`:

```typescript
export interface TenantCacheInterceptorOptions {
  /** Prefix for tenant-scoped cache entries. @default 'tenant' */
  tenantPrefix?: string;
  /** Prefix for intentionally shared cache entries. @default 'shared' */
  sharedPrefix?: string;
  /** Separator used between key parts. @default ':' */
  separator?: string;
  /** Hash tenant IDs before placing them in cache keys. @default false */
  hashTenantId?: boolean;
}
```

- [ ] **Step 4: Add the interceptor implementation**

Create `src/cache/tenant-cache.interceptor.ts`:

```typescript
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CacheInterceptor } from '@nestjs/cache-manager';
import { createHash } from 'crypto';
import { SHARED_TENANT_CACHE_KEY } from '../tenancy.constants';
import { TenancyContext } from '../services/tenancy-context';
import { TenantCacheInterceptorOptions } from './tenant-cache-options.interface';

@Injectable()
export class TenantCacheInterceptor extends CacheInterceptor {
  private readonly tenantPrefix: string;
  private readonly sharedPrefix: string;
  private readonly separator: string;
  private readonly hashTenantId: boolean;

  constructor(
    cacheManager: ConstructorParameters<typeof CacheInterceptor>[0],
    reflector: Reflector,
    options?: TenantCacheInterceptorOptions,
  ) {
    super(cacheManager, reflector);
    this.tenantPrefix = options?.tenantPrefix ?? 'tenant';
    this.sharedPrefix = options?.sharedPrefix ?? 'shared';
    this.separator = options?.separator ?? ':';
    this.hashTenantId = options?.hashTenantId ?? false;
  }

  protected getBaseCacheKey(context: ExecutionContext): string | undefined {
    return super.trackBy(context);
  }

  protected trackBy(context: ExecutionContext): string | undefined {
    const baseKey = this.getBaseCacheKey(context);
    if (!baseKey) {
      return undefined;
    }

    if (this.isSharedCache(context)) {
      return this.joinKeyParts(this.sharedPrefix, baseKey);
    }

    const tenantId = TenancyContext.getCurrentTenantId();
    if (!tenantId) {
      return undefined;
    }

    return this.joinKeyParts(
      this.tenantPrefix,
      this.hashTenantId ? hashTenantId(tenantId) : formatTenantId(tenantId),
      baseKey,
    );
  }

  private isSharedCache(context: ExecutionContext): boolean {
    return this.reflector.getAllAndOverride<boolean>(
      SHARED_TENANT_CACHE_KEY,
      [context.getHandler(), context.getClass()],
    ) === true;
  }

  private joinKeyParts(...parts: string[]): string {
    return parts.join(this.separator);
  }
}

function hashTenantId(tenantId: string): string {
  return createHash('sha256').update(tenantId).digest('hex');
}

function formatTenantId(tenantId: string): string {
  return `${tenantId.length}:${tenantId}`;
}
```

- [ ] **Step 5: Add the cache barrel**

Create `src/cache/index.ts`:

```typescript
export { TenantCacheInterceptor } from './tenant-cache.interceptor';
export type { TenantCacheInterceptorOptions } from './tenant-cache-options.interface';
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npx jest test/tenant-cache.interceptor.spec.ts test/shared-tenant-cache.decorator.spec.ts --runInBand
```

Expected: PASS. If TypeScript reports that `CacheInterceptor` constructor types are incompatible, inspect the installed `@nestjs/cache-manager` declaration and adjust only the constructor parameter type, keeping runtime behavior the same.

- [ ] **Step 7: Commit interceptor unit behavior**

```bash
git add src/cache/tenant-cache-options.interface.ts src/cache/tenant-cache.interceptor.ts src/cache/index.ts test/tenant-cache.interceptor.spec.ts
git commit -m "feat: add tenant-aware cache key interceptor"
```

---

### Task 4: Add Nest integration-style cache tests

**Files:**
- Modify: `test/tenant-cache.interceptor.spec.ts`

- [ ] **Step 1: Add integration-style tests to the same spec**

Append this block to `test/tenant-cache.interceptor.spec.ts`:

```typescript
import { CacheKey, CacheModule, CacheTTL } from '@nestjs/cache-manager';
import { Controller, Get, INestApplication, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { BypassTenancy } from '../src/decorators/bypass-tenancy.decorator';
import { SharedTenantCache } from '../src/decorators/shared-tenant-cache.decorator';
import { HeaderTenantExtractor } from '../src/extractors/header.extractor';
import { TenancyModule } from '../src/tenancy.module';

describe('TenantCacheInterceptor integration', () => {
  let app: INestApplication;
  let tenantHitCount = 0;
  let sharedHitCount = 0;
  let publicHitCount = 0;

  @Controller()
  class TestController {
    @UseInterceptors(TenantCacheInterceptor)
    @CacheKey('products')
    @CacheTTL(60)
    @Get('/products')
    products() {
      tenantHitCount += 1;
      return { hit: tenantHitCount };
    }

    @UseInterceptors(TenantCacheInterceptor)
    @BypassTenancy()
    @SharedTenantCache()
    @CacheKey('catalog')
    @CacheTTL(60)
    @Get('/catalog')
    catalog() {
      sharedHitCount += 1;
      return { hit: sharedHitCount };
    }

    @UseInterceptors(TenantCacheInterceptor)
    @BypassTenancy()
    @CacheKey('public')
    @CacheTTL(60)
    @Get('/public')
    publicRoute() {
      publicHitCount += 1;
      return { hit: publicHitCount };
    }
  }

  beforeEach(async () => {
    tenantHitCount = 0;
    sharedHitCount = 0;
    publicHitCount = 0;

    const moduleRef = await Test.createTestingModule({
      imports: [
        CacheModule.register(),
        TenancyModule.forRoot({
          tenantExtractor: new HeaderTenantExtractor('x-tenant-id'),
          validateTenantId: (id) => id.length > 0,
        }),
      ],
      controllers: [TestController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should cache same route separately per tenant', async () => {
    await request(app.getHttpServer()).get('/products').set('x-tenant-id', 'tenant-a').expect(200, { hit: 1 });
    await request(app.getHttpServer()).get('/products').set('x-tenant-id', 'tenant-a').expect(200, { hit: 1 });
    await request(app.getHttpServer()).get('/products').set('x-tenant-id', 'tenant-b').expect(200, { hit: 2 });
    await request(app.getHttpServer()).get('/products').set('x-tenant-id', 'tenant-b').expect(200, { hit: 2 });
  });

  it('should reuse shared cache across tenant contexts', async () => {
    await request(app.getHttpServer()).get('/catalog').set('x-tenant-id', 'tenant-a').expect(200, { hit: 1 });
    await request(app.getHttpServer()).get('/catalog').set('x-tenant-id', 'tenant-b').expect(200, { hit: 1 });
    await request(app.getHttpServer()).get('/catalog').expect(200, { hit: 1 });
  });

  it('should not cache public route without tenant when route is not shared', async () => {
    await request(app.getHttpServer()).get('/public').expect(200, { hit: 1 });
    await request(app.getHttpServer()).get('/public').expect(200, { hit: 2 });
  });
});
```

If `supertest` is not already installed, add it before running the test:

```bash
npm install --save-dev supertest @types/supertest
```

- [ ] **Step 2: Run integration-focused cache tests**

Run:

```bash
npx jest test/tenant-cache.interceptor.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 3: Commit integration tests**

```bash
git add package.json package-lock.json test/tenant-cache.interceptor.spec.ts
git commit -m "test: cover tenant-aware cache integration"
```

---

### Task 5: Export public API

**Files:**
- Modify: `src/index.ts`
- Modify: `test/public-api.spec.ts`

- [ ] **Step 1: Add failing public API expectations**

In `test/public-api.spec.ts`, add runtime imports to the first import block:

```typescript
  SharedTenantCache,
  TenantCacheInterceptor,
```

Add type import to the type import block:

```typescript
  TenantCacheInterceptorOptions,
```

In the `runtimeExports` object, add:

```typescript
      SharedTenantCache,
      TenantCacheInterceptor,
```

In the matching expectation object, add:

```typescript
        SharedTenantCache: expect.any(Function),
        TenantCacheInterceptor: expect.any(Function),
```

In the public types test, add:

```typescript
    const tenantCacheOptions: TenantCacheInterceptorOptions = {
      tenantPrefix: 'tenant',
      sharedPrefix: 'shared',
      separator: ':',
      hashTenantId: true,
    };
```

Include `tenantCacheOptions` in the final `expect(...)` shape used by that test so TypeScript cannot remove it as unused:

```typescript
      tenantCacheOptions,
```

Expected: this test fails before exports are added.

- [ ] **Step 2: Run public API test and verify failure**

Run:

```bash
npx jest test/public-api.spec.ts --runInBand
```

Expected: FAIL because root exports do not include `SharedTenantCache`, `TenantCacheInterceptor`, or `TenantCacheInterceptorOptions`.

- [ ] **Step 3: Export cache API from root barrel**

In `src/index.ts`, add:

```typescript
// Cache integration
export { TenantCacheInterceptor } from './cache/tenant-cache.interceptor';
export type { TenantCacheInterceptorOptions } from './cache/tenant-cache-options.interface';
export { SharedTenantCache } from './decorators/shared-tenant-cache.decorator';
```

- [ ] **Step 4: Run public API test**

Run:

```bash
npx jest test/public-api.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit public exports**

```bash
git add src/index.ts test/public-api.spec.ts
git commit -m "feat: export tenant cache public API"
```

---

### Task 6: Document tenant-aware caching

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Add README section**

In `README.md`, add this section after "Microservice Propagation" or near the security guidance:

```markdown
## Tenant-Aware Caching

Database RLS does not protect Redis or in-memory response caches. If two tenants request the same URL or use the same `@CacheKey()`, an unscoped cache key can leak one tenant's response to another tenant.

`TenantCacheInterceptor` extends NestJS `CacheInterceptor` and prefixes generated cache keys with the current tenant ID:

```typescript
import { CacheModule, CacheTTL } from '@nestjs/cache-manager';
import { TenancyModule } from '@nestarc/tenancy';
import { TenantCacheInterceptor } from '@nestarc/tenancy/cache';

@Module({
  imports: [
    CacheModule.register(),
    TenancyModule.forRoot({ tenantExtractor: 'X-Tenant-Id' }),
  ],
})
export class AppModule {}

@UseInterceptors(TenantCacheInterceptor)
@CacheTTL(60)
@Get('/products')
findProducts() {
  return this.products.findAll();
}
```

For tenant `tenant-a`, the effective cache key is prefixed like:

```text
tenant:8:tenant-a:{baseCacheKey}
```

Install the optional cache dependencies before using the interceptor:

```bash
npm install @nestjs/cache-manager cache-manager
```

Use `@SharedTenantCache()` only for data that is intentionally identical for every tenant:

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

`@SharedTenantCache()` affects cache keys only. It does not bypass `TenancyGuard`, clear tenant context, or authorize access. Cache invalidation remains application-specific and depends on your cache store.
```

- [ ] **Step 2: Add CHANGELOG entry**

At the top of `CHANGELOG.md`, add:

```markdown
## [0.13.0] - Unreleased

### Added

- **Tenant-aware response caching** — `TenantCacheInterceptor` extends NestJS `CacheInterceptor` and prefixes cache keys with the current tenant ID to prevent cross-tenant cache collisions.
- **Shared cache opt-in** — `@SharedTenantCache()` marks public routes/controllers whose cached responses are intentionally shared across tenants.
- **Optional cache dependency metadata** — `@nestjs/cache-manager` and `cache-manager` are documented as optional peer dependencies for cache users.
```

- [ ] **Step 3: Update roadmap**

In `docs/roadmap.md`, add a new completed line in the phase summary or mark the v0.11.0 cache item as completed with v0.13.0:

```markdown
✅ v0.13.0           Tenant-aware cache interceptor + shared cache opt-in
```

Do not mark logger or WebSocket isolation as completed.

- [ ] **Step 4: Run documentation grep checks**

Run:

```bash
rg -n "TenantCacheInterceptor|SharedTenantCache|@nestjs/cache-manager|cache-manager" README.md CHANGELOG.md docs/roadmap.md package.json
```

Expected: matches in README, CHANGELOG, roadmap, and package metadata.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md CHANGELOG.md docs/roadmap.md
git commit -m "docs: document tenant-aware caching"
```

---

### Task 7: Full validation

**Files:**
- No source edits unless validation exposes an issue.

- [ ] **Step 1: Run focused cache tests**

Run:

```bash
npx jest test/shared-tenant-cache.decorator.spec.ts test/tenant-cache.interceptor.spec.ts test/public-api.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run full unit suite**

Run:

```bash
npm test
```

Expected: all Jest suites pass.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: `tsc --noEmit && eslint src/ test/` exits 0.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: `tsc -p tsconfig.build.json` exits 0 and `scripts/ensure-cli-shebang.js` exits 0.

- [ ] **Step 5: Run dependency audit**

Run:

```bash
npm audit --omit=optional
```

Expected: `found 0 vulnerabilities`.

- [ ] **Step 6: Decide whether E2E is necessary**

Run E2E only if implementation changed HTTP middleware, guard behavior, Prisma behavior, CLI behavior, or dependency metadata in a way that unit tests cannot cover. For the planned interceptor-only implementation, E2E is not required because Nest integration tests cover the HTTP cache path.

If E2E is run:

```bash
npm run test:e2e
```

Expected: E2E suite passes and Docker teardown runs.

- [ ] **Step 7: Review final diff**

Run:

```bash
git diff --stat
git diff -- src/cache src/decorators src/index.ts src/tenancy.constants.ts test package.json README.md CHANGELOG.md docs/roadmap.md
```

Expected: diff is limited to tenant-aware cache implementation, tests, package metadata, and docs.

- [ ] **Step 8: Commit validation fixes if needed**

If validation required additional fixes, stage the concrete files that changed. For example:

```bash
git add src/cache/tenant-cache.interceptor.ts test/tenant-cache.interceptor.spec.ts
git commit -m "fix: stabilize tenant-aware cache interceptor"
```

If no additional fixes were needed, do not create an empty commit.

---

## Plan Self-Review

- Spec coverage: Tasks cover `TenantCacheInterceptor`, `@SharedTenantCache()`, configurable prefixes, optional cache peer metadata, README/CHANGELOG/roadmap updates, unit tests, integration-style tests, public API tests, and full validation.
- Scope check: The plan stays HTTP response-cache focused. It does not add service-method caching, invalidation APIs, Redis-specific behavior, rate limiting, WebSocket support, GraphQL caching, or RPC caching.
- Type consistency: Public names are `TenantCacheInterceptor`, `TenantCacheInterceptorOptions`, and `SharedTenantCache` from `@nestarc/tenancy/cache`. Metadata key is `SHARED_TENANT_CACHE_KEY`.
- Security invariant: Missing tenant context returns no cache key unless `@SharedTenantCache()` is explicitly present; shared metadata wins only for intentionally public/shared cache entries; non-hashed tenant IDs are length-prefixed before joining so separator characters cannot create ambiguous cache keys.
