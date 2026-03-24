# v0.2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multiple tenant extraction strategies, lifecycle hooks, and Prisma extension enhancements to @nestarc/tenancy while maintaining full backward compatibility with v0.1.0.

**Architecture:** Incrementally extend existing interfaces (`TenancyModuleOptions`, `PrismaTenancyExtensionOptions`) with optional fields. New extractors implement the existing `TenantExtractor` interface. All features are opt-in — zero changes for existing users.

**Tech Stack:** NestJS 10/11, Prisma 5/6, TypeScript 5, Jest 29, PostgreSQL 16

**Spec:** `docs/superpowers/specs/2026-03-24-v020-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/extractors/subdomain.extractor.ts` | Extract tenant from `req.hostname` subdomain |
| `src/extractors/jwt-claim.extractor.ts` | Extract tenant from JWT payload claim |
| `src/extractors/path.extractor.ts` | Extract tenant from URL path segment |
| `src/extractors/composite.extractor.ts` | Chain multiple extractors, first non-null wins |
| `test/subdomain.extractor.spec.ts` | Unit tests |
| `test/jwt-claim.extractor.spec.ts` | Unit tests |
| `test/path.extractor.spec.ts` | Unit tests |
| `test/composite.extractor.spec.ts` | Unit tests |

### Modified Files

| File | What Changes |
|------|-------------|
| `src/interfaces/tenancy-module-options.interface.ts` | Add `onTenantResolved`, `onTenantNotFound` optional fields |
| `src/middleware/tenant.middleware.ts` | Store `options` as field, call hooks, move `onTenantResolved` inside `context.run()` |
| `src/prisma/prisma-tenancy.extension.ts` | Add `model`/`operation` to signature, `sharedModels`, `autoInjectTenantId`, `tenantIdField` |
| `src/index.ts` | Export new extractors |
| `test/tenant.middleware.spec.ts` | Add hook tests |
| `test/prisma-tenancy.extension.spec.ts` | Add sharedModels, autoInject, tenantIdField tests |

---

## Task 1: SubdomainTenantExtractor

**Files:**
- Create: `src/extractors/subdomain.extractor.ts`
- Create: `test/subdomain.extractor.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/subdomain.extractor.spec.ts
import { SubdomainTenantExtractor } from '../src/extractors/subdomain.extractor';

describe('SubdomainTenantExtractor', () => {
  it('should extract subdomain from hostname', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'tenant1.app.com' } as any;
    expect(extractor.extract(req)).toBe('tenant1');
  });

  it('should return null when no subdomain', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'app.com' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should exclude www by default', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'www.app.com' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should support custom exclude list', () => {
    const extractor = new SubdomainTenantExtractor({ excludeSubdomains: ['www', 'api'] });
    const req = { hostname: 'api.app.com' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should extract from deep subdomain', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'tenant1.us-east.app.com' } as any;
    expect(extractor.extract(req)).toBe('tenant1');
  });

  it('should return null for localhost', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'localhost' } as any;
    expect(extractor.extract(req)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/subdomain.extractor.spec.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/extractors/subdomain.extractor.ts
import { Request } from 'express';
import { TenantExtractor } from '../interfaces/tenant-extractor.interface';

export interface SubdomainExtractorOptions {
  excludeSubdomains?: string[];
}

export class SubdomainTenantExtractor implements TenantExtractor {
  private readonly excludes: Set<string>;

  constructor(options?: SubdomainExtractorOptions) {
    this.excludes = new Set(
      (options?.excludeSubdomains ?? ['www']).map((s) => s.toLowerCase()),
    );
  }

  extract(request: Request): string | null {
    const hostname = request.hostname;
    const parts = hostname.split('.');

    // Need at least 3 parts: subdomain.domain.tld
    if (parts.length < 3) return null;

    const subdomain = parts[0].toLowerCase();
    if (this.excludes.has(subdomain)) return null;

    return subdomain;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/subdomain.extractor.spec.ts --no-coverage`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/extractors/subdomain.extractor.ts test/subdomain.extractor.spec.ts
git commit -m "feat: add SubdomainTenantExtractor"
```

---

## Task 2: JwtClaimTenantExtractor

**Files:**
- Create: `src/extractors/jwt-claim.extractor.ts`
- Create: `test/jwt-claim.extractor.spec.ts`

- [ ] **Step 1: Write the failing tests**

Helper to create a valid JWT string (no signing needed — we only decode):

```typescript
// test/jwt-claim.extractor.spec.ts
import { JwtClaimTenantExtractor } from '../src/extractors/jwt-claim.extractor';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fake-signature`;
}

describe('JwtClaimTenantExtractor', () => {
  it('should extract claim from Bearer token', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'tenant_id' });
    const token = makeJwt({ tenant_id: 'acme-corp', sub: 'user-1' });
    const req = { headers: { authorization: `Bearer ${token}` } } as any;
    expect(extractor.extract(req)).toBe('acme-corp');
  });

  it('should return null when no authorization header', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'tenant_id' });
    const req = { headers: {} } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null when no Bearer prefix', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'tenant_id' });
    const req = { headers: { authorization: 'Basic abc123' } } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null when claim key missing from payload', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'tenant_id' });
    const token = makeJwt({ sub: 'user-1' });
    const req = { headers: { authorization: `Bearer ${token}` } } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null for malformed JWT (not 3 parts)', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'tenant_id' });
    const req = { headers: { authorization: 'Bearer not-a-jwt' } } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null for invalid base64url payload', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'tenant_id' });
    const req = { headers: { authorization: 'Bearer header.!!!invalid!!!.sig' } } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should support custom header name', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'org_id', headerName: 'x-auth-token' });
    const token = makeJwt({ org_id: 'org-42' });
    const req = { headers: { 'x-auth-token': `Bearer ${token}` } } as any;
    expect(extractor.extract(req)).toBe('org-42');
  });

  it('should convert non-string claim to string', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'tenant_id' });
    const token = makeJwt({ tenant_id: 12345 });
    const req = { headers: { authorization: `Bearer ${token}` } } as any;
    expect(extractor.extract(req)).toBe('12345');
  });

  it('should return null when authorization header is an array', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'tenant_id' });
    const token = makeJwt({ tenant_id: 'acme' });
    const req = { headers: { authorization: [`Bearer ${token}`, 'Bearer other'] } } as any;
    expect(extractor.extract(req)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/jwt-claim.extractor.spec.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/extractors/jwt-claim.extractor.ts
import { Request } from 'express';
import { TenantExtractor } from '../interfaces/tenant-extractor.interface';

export interface JwtClaimExtractorOptions {
  claimKey: string;
  headerName?: string;
}

export class JwtClaimTenantExtractor implements TenantExtractor {
  private readonly claimKey: string;
  private readonly headerName: string;

  constructor(options: JwtClaimExtractorOptions) {
    this.claimKey = options.claimKey;
    this.headerName = (options.headerName ?? 'authorization').toLowerCase();
  }

  extract(request: Request): string | null {
    const headerValue = request.headers[this.headerName];
    if (!headerValue || Array.isArray(headerValue)) return null;

    if (!headerValue.startsWith('Bearer ')) return null;
    const token = headerValue.slice(7);

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    try {
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      );
      const value = payload[this.claimKey];
      if (value == null) return null;
      return String(value);
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/jwt-claim.extractor.spec.ts --no-coverage`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/extractors/jwt-claim.extractor.ts test/jwt-claim.extractor.spec.ts
git commit -m "feat: add JwtClaimTenantExtractor"
```

---

## Task 3: PathTenantExtractor

**Files:**
- Create: `src/extractors/path.extractor.ts`
- Create: `test/path.extractor.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/path.extractor.spec.ts
import { PathTenantExtractor } from '../src/extractors/path.extractor';

describe('PathTenantExtractor', () => {
  it('should extract param from matching path', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { path: '/api/tenants/abc-123' } as any;
    expect(extractor.extract(req)).toBe('abc-123');
  });

  it('should support prefix match (trailing segments)', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { path: '/api/tenants/abc-123/users/profile' } as any;
    expect(extractor.extract(req)).toBe('abc-123');
  });

  it('should return null when path has fewer segments than pattern', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { path: '/api/tenants' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null when static segments do not match', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { path: '/api/users/abc-123' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should handle param in middle of path', () => {
    const extractor = new PathTenantExtractor({ pattern: '/orgs/:orgId/projects', paramName: 'orgId' });
    const req = { path: '/orgs/my-org/projects' } as any;
    expect(extractor.extract(req)).toBe('my-org');
  });

  it('should return null when paramName not found in pattern', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/:id', paramName: 'tenantId' });
    const req = { path: '/api/123' } as any;
    expect(extractor.extract(req)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/path.extractor.spec.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/extractors/path.extractor.ts
import { Request } from 'express';
import { TenantExtractor } from '../interfaces/tenant-extractor.interface';

export interface PathExtractorOptions {
  pattern: string;
  paramName: string;
}

export class PathTenantExtractor implements TenantExtractor {
  private readonly patternSegments: string[];
  private readonly paramIndex: number;

  constructor(options: PathExtractorOptions) {
    this.patternSegments = options.pattern.split('/').filter(Boolean);
    this.paramIndex = this.patternSegments.findIndex(
      (seg) => seg === `:${options.paramName}`,
    );
  }

  extract(request: Request): string | null {
    if (this.paramIndex === -1) return null;

    const pathSegments = request.path.split('/').filter(Boolean);

    // Request path must have at least as many segments as the pattern
    if (pathSegments.length < this.patternSegments.length) return null;

    // Verify static segments match (up to pattern length)
    for (let i = 0; i < this.patternSegments.length; i++) {
      if (i === this.paramIndex) continue;
      if (this.patternSegments[i] !== pathSegments[i]) return null;
    }

    return pathSegments[this.paramIndex];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/path.extractor.spec.ts --no-coverage`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/extractors/path.extractor.ts test/path.extractor.spec.ts
git commit -m "feat: add PathTenantExtractor"
```

---

## Task 4: CompositeTenantExtractor

**Files:**
- Create: `src/extractors/composite.extractor.ts`
- Create: `test/composite.extractor.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/composite.extractor.spec.ts
import { CompositeTenantExtractor } from '../src/extractors/composite.extractor';
import { TenantExtractor } from '../src/interfaces/tenant-extractor.interface';

const mockExtractor = (value: string | null): TenantExtractor => ({
  extract: jest.fn().mockReturnValue(value),
});

const mockAsyncExtractor = (value: string | null): TenantExtractor => ({
  extract: jest.fn().mockResolvedValue(value),
});

describe('CompositeTenantExtractor', () => {
  it('should return first non-null result', async () => {
    const extractor = new CompositeTenantExtractor([
      mockExtractor(null),
      mockExtractor('tenant-b'),
      mockExtractor('tenant-c'),
    ]);
    const req = {} as any;
    expect(await extractor.extract(req)).toBe('tenant-b');
  });

  it('should return null when all extractors return null', async () => {
    const extractor = new CompositeTenantExtractor([
      mockExtractor(null),
      mockExtractor(null),
    ]);
    const req = {} as any;
    expect(await extractor.extract(req)).toBeNull();
  });

  it('should not call later extractors after first match', async () => {
    const third = mockExtractor('tenant-c');
    const extractor = new CompositeTenantExtractor([
      mockExtractor('tenant-a'),
      mockExtractor(null),
      third,
    ]);
    await extractor.extract({} as any);
    expect(third.extract).not.toHaveBeenCalled();
  });

  it('should support async extractors', async () => {
    const extractor = new CompositeTenantExtractor([
      mockAsyncExtractor(null),
      mockAsyncExtractor('async-tenant'),
    ]);
    expect(await extractor.extract({} as any)).toBe('async-tenant');
  });

  it('should work with single extractor', async () => {
    const extractor = new CompositeTenantExtractor([
      mockExtractor('only-one'),
    ]);
    expect(await extractor.extract({} as any)).toBe('only-one');
  });

  it('should return null with empty extractor array', async () => {
    const extractor = new CompositeTenantExtractor([]);
    expect(await extractor.extract({} as any)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/composite.extractor.spec.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/extractors/composite.extractor.ts
import { Request } from 'express';
import { TenantExtractor } from '../interfaces/tenant-extractor.interface';

export class CompositeTenantExtractor implements TenantExtractor {
  private readonly extractors: TenantExtractor[];

  constructor(extractors: TenantExtractor[]) {
    this.extractors = extractors;
  }

  async extract(request: Request): Promise<string | null> {
    for (const extractor of this.extractors) {
      const result = await extractor.extract(request);
      if (result != null) return result;
    }
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/composite.extractor.spec.ts --no-coverage`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/extractors/composite.extractor.ts test/composite.extractor.spec.ts
git commit -m "feat: add CompositeTenantExtractor"
```

---

## Task 5: Barrel Exports for New Extractors

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add exports**

Add the following lines to `src/index.ts` after the existing `HeaderTenantExtractor` export (line 11):

```typescript
export { SubdomainTenantExtractor } from './extractors/subdomain.extractor';
export { JwtClaimTenantExtractor } from './extractors/jwt-claim.extractor';
export { PathTenantExtractor } from './extractors/path.extractor';
export { CompositeTenantExtractor } from './extractors/composite.extractor';
```

Also export the option interfaces for each extractor:

```typescript
export type { SubdomainExtractorOptions } from './extractors/subdomain.extractor';
export type { JwtClaimExtractorOptions } from './extractors/jwt-claim.extractor';
export type { PathExtractorOptions } from './extractors/path.extractor';
```

- [ ] **Step 2: Verify build succeeds**

Run: `npx tsc -p tsconfig.build.json --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: export new extractors from barrel"
```

---

## Task 6: Tenant Lifecycle Hooks

**Files:**
- Modify: `src/interfaces/tenancy-module-options.interface.ts`
- Modify: `src/middleware/tenant.middleware.ts`
- Modify: `test/tenant.middleware.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/tenant.middleware.spec.ts`:

```typescript
describe('Lifecycle Hooks', () => {
  it('should call onTenantResolved after successful extraction', (done) => {
    const onTenantResolved = jest.fn();
    const mw = createMiddleware({ onTenantResolved });
    const req = mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' });

    mw.use(req, mockRes(), () => {
      expect(onTenantResolved).toHaveBeenCalledWith(
        '550e8400-e29b-41d4-a716-446655440000',
        req,
      );
      done();
    });
  });

  it('should call onTenantResolved inside context.run (getCurrentTenant available)', (done) => {
    const onTenantResolved = jest.fn((tenantId: string) => {
      // Inside the hook, context should be set
      expect(new TenancyContext().getTenantId()).toBe(tenantId);
    });
    const mw = createMiddleware({ onTenantResolved });

    mw.use(
      mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' }),
      mockRes(),
      () => { done(); },
    );
  });

  it('should call onTenantNotFound when no tenant header', (done) => {
    const onTenantNotFound = jest.fn();
    const mw = createMiddleware({ onTenantNotFound });
    const req = mockReq();

    mw.use(req, mockRes(), () => {
      expect(onTenantNotFound).toHaveBeenCalledWith(req);
      done();
    });
  });

  it('should support async hooks', (done) => {
    const onTenantResolved = jest.fn().mockResolvedValue(undefined);
    const mw = createMiddleware({ onTenantResolved });

    mw.use(
      mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' }),
      mockRes(),
      () => {
        expect(onTenantResolved).toHaveBeenCalled();
        done();
      },
    );
  });

  it('should propagate error from hook', async () => {
    const mw = createMiddleware({
      onTenantResolved: async () => { throw new Error('audit failed'); },
    });

    await expect(
      new Promise((resolve, reject) => {
        mw.use(
          mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' }),
          mockRes(),
          resolve,
        ).catch(reject);
      }),
    ).rejects.toThrow('audit failed');
  });

  it('should not call onTenantResolved when validation fails', async () => {
    const onTenantResolved = jest.fn();
    const mw = createMiddleware({ onTenantResolved });

    await expect(
      new Promise((resolve, reject) => {
        mw.use(mockReq({ 'x-tenant-id': 'invalid' }), mockRes(), resolve).catch(reject);
      }),
    ).rejects.toThrow(BadRequestException);

    expect(onTenantResolved).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/tenant.middleware.spec.ts --no-coverage`
Expected: FAIL — `onTenantResolved` is not recognized in options / never called

- [ ] **Step 3: Update the interface**

In `src/interfaces/tenancy-module-options.interface.ts`:

1. Add `import { Request } from 'express';` at the top of the file (new import, not currently present).
2. Add two optional fields after `validateTenantId`:

```typescript
import { Type } from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces';
import { Request } from 'express';  // NEW — required for hook signatures
import { TenantExtractor } from './tenant-extractor.interface';

export interface TenancyModuleOptions {
  tenantExtractor: string | TenantExtractor;
  dbSettingKey?: string;
  validateTenantId?: (tenantId: string) => boolean | Promise<boolean>;
  onTenantResolved?: (tenantId: string, request: Request) => void | Promise<void>;
  onTenantNotFound?: (request: Request) => void | Promise<void>;
}
```

- [ ] **Step 4: Update the middleware**

Replace `src/middleware/tenant.middleware.ts` with:

**IMPORTANT**: `TenancyContext.run()` returns the callback's return value directly (signature: `run<T>(tenantId, callback: () => T): T`). When passing an async callback, it returns a `Promise`. We MUST `await` this Promise so that errors from `onTenantResolved` propagate correctly instead of becoming unhandled rejections.

```typescript
import {
  BadRequestException,
  Inject,
  Injectable,
  NestMiddleware,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenancyModuleOptions } from '../interfaces/tenancy-module-options.interface';
import { TenantExtractor } from '../interfaces/tenant-extractor.interface';
import { TenancyContext } from '../services/tenancy-context';
import { HeaderTenantExtractor } from '../extractors/header.extractor';
import { TENANCY_MODULE_OPTIONS, UUID_REGEX } from '../tenancy.constants';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly extractor: TenantExtractor;
  private readonly validate: (id: string) => boolean | Promise<boolean>;

  constructor(
    @Inject(TENANCY_MODULE_OPTIONS)
    private readonly options: TenancyModuleOptions,
    private readonly context: TenancyContext,
  ) {
    this.extractor =
      typeof options.tenantExtractor === 'string'
        ? new HeaderTenantExtractor(options.tenantExtractor)
        : options.tenantExtractor;

    this.validate =
      options.validateTenantId ?? ((id: string) => UUID_REGEX.test(id));
  }

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const tenantId = await this.extractor.extract(req);

    if (!tenantId) {
      await this.options.onTenantNotFound?.(req);
      next();
      return;
    }

    const isValid = await this.validate(tenantId);
    if (!isValid) {
      throw new BadRequestException('Invalid tenant ID format');
    }

    // await the run() return value — context.run() returns whatever the callback returns.
    // With an async callback, it returns a Promise that must be awaited for error propagation.
    await this.context.run(tenantId, async () => {
      await this.options.onTenantResolved?.(tenantId, req);
      next();
    });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest test/tenant.middleware.spec.ts --no-coverage`
Expected: All tests PASS (existing + new)

- [ ] **Step 6: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/interfaces/tenancy-module-options.interface.ts src/middleware/tenant.middleware.ts test/tenant.middleware.spec.ts
git commit -m "feat: add tenant lifecycle hooks (onTenantResolved, onTenantNotFound)"
```

---

## Task 7: Prisma Extension — sharedModels

**Files:**
- Modify: `src/prisma/prisma-tenancy.extension.ts`
- Modify: `test/prisma-tenancy.extension.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/prisma-tenancy.extension.spec.ts`, inside the main `describe` block:

```typescript
describe('sharedModels', () => {
  it('should skip set_config for shared models', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();

    capturedFactory = null;
    createPrismaTenancyExtension(service, { sharedModels: ['Country'] });
    const extensionConfig = capturedFactory!(mockPrisma);
    const handler = extensionConfig.query.$allModels.$allOperations;

    const mockQuery = jest.fn().mockResolvedValue([{ id: 1, name: 'US' }]);

    await new Promise<void>((resolve, reject) => {
      context.run('550e8400-e29b-41d4-a716-446655440000', async () => {
        try {
          const result = await handler({
            model: 'Country',
            operation: 'findMany',
            args: {},
            query: mockQuery,
          });

          expect(mockTransaction).not.toHaveBeenCalled();
          expect(mockQuery).toHaveBeenCalledWith({});
          expect(result).toEqual([{ id: 1, name: 'US' }]);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it('should still apply set_config for non-shared models', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();

    capturedFactory = null;
    createPrismaTenancyExtension(service, { sharedModels: ['Country'] });
    const extensionConfig = capturedFactory!(mockPrisma);
    const handler = extensionConfig.query.$allModels.$allOperations;

    mockTransaction.mockResolvedValue([1, [{ id: 1 }]]);

    await new Promise<void>((resolve, reject) => {
      context.run('550e8400-e29b-41d4-a716-446655440000', async () => {
        try {
          await handler({
            model: 'Order',
            operation: 'findMany',
            args: {},
            query: jest.fn().mockReturnValue(Promise.resolve([{ id: 1 }])),
          });

          expect(mockTransaction).toHaveBeenCalled();
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/prisma-tenancy.extension.spec.ts --no-coverage`
Expected: FAIL — handler does not accept `model` parameter / sharedModels not implemented

- [ ] **Step 3: Update PrismaTenancyExtensionOptions and handler**

In `src/prisma/prisma-tenancy.extension.ts`, update the interface and handler:

```typescript
import { Prisma } from '@prisma/client';
import { TenancyService } from '../services/tenancy.service';
import { DEFAULT_DB_SETTING_KEY } from '../tenancy.constants';

export interface PrismaTenancyExtensionOptions {
  dbSettingKey?: string;
  autoInjectTenantId?: boolean;
  tenantIdField?: string;
  sharedModels?: string[];
}

export function createPrismaTenancyExtension(
  tenancyService: TenancyService,
  options?: PrismaTenancyExtensionOptions,
) {
  const settingKey = options?.dbSettingKey ?? DEFAULT_DB_SETTING_KEY;
  const sharedModels = new Set(options?.sharedModels ?? []);

  return Prisma.defineExtension((prisma) => {
    const baseClient = prisma as any;

    return baseClient.$extends({
      query: {
        $allModels: {
          async $allOperations({
            model,
            operation,
            args,
            query,
          }: {
            model: string;
            operation: string;
            args: any;
            query: (args: any) => Promise<any>;
          }) {
            const tenantId = tenancyService.getCurrentTenant();

            if (!tenantId || sharedModels.has(model)) {
              return query(args);
            }

            const [, result] = await baseClient.$transaction([
              baseClient.$executeRaw`SELECT set_config(${settingKey}, ${tenantId}, TRUE)`,
              query(args),
            ]);

            return result;
          },
        },
      },
    });
  });
}
```

- [ ] **Step 3.5: Update existing test call sites to pass `model` and `operation`**

The new `$allOperations` signature requires `model: string` and `operation: string`. Update ALL existing handler invocations in `test/prisma-tenancy.extension.spec.ts` to include these fields. For example:

```typescript
// BEFORE (will cause TypeScript error):
const result = await handler({
  args: { where: { id: 1 } },
  query: mockQuery,
});

// AFTER:
const result = await handler({
  model: 'TestModel',
  operation: 'findMany',
  args: { where: { id: 1 } },
  query: mockQuery,
});
```

Apply this to ALL existing `handler({...})` calls in the file (there are 5 call sites in the existing tests: "pass through query", "wrap in batch transaction", "custom dbSettingKey", and "return second element" tests).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/prisma-tenancy.extension.spec.ts --no-coverage`
Expected: All tests PASS (existing + sharedModels tests)

- [ ] **Step 5: Commit**

```bash
git add src/prisma/prisma-tenancy.extension.ts test/prisma-tenancy.extension.spec.ts
git commit -m "feat: add sharedModels option to Prisma extension"
```

---

## Task 8: Prisma Extension — autoInjectTenantId

**Files:**
- Modify: `src/prisma/prisma-tenancy.extension.ts`
- Modify: `test/prisma-tenancy.extension.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/prisma-tenancy.extension.spec.ts`:

```typescript
describe('autoInjectTenantId', () => {
  function getHandlerWithAutoInject(mockPrisma: any, opts?: Partial<PrismaTenancyExtensionOptions>) {
    capturedFactory = null;
    createPrismaTenancyExtension(service, { autoInjectTenantId: true, ...opts });
    const extensionConfig = capturedFactory!(mockPrisma);
    return extensionConfig.query.$allModels.$allOperations;
  }

  it('should inject tenant_id on create', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const handler = getHandlerWithAutoInject(mockPrisma);

    const mockQuery = jest.fn().mockReturnValue(Promise.resolve({ id: 1 }));
    mockTransaction.mockResolvedValue([1, { id: 1 }]);

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-abc', async () => {
        try {
          await handler({
            model: 'Order',
            operation: 'create',
            args: { data: { product: 'Widget' } },
            query: mockQuery,
          });

          expect(mockQuery).toHaveBeenCalledWith({
            data: { product: 'Widget', tenant_id: 'tenant-abc' },
          });
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it('should inject tenant_id on createMany (array)', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const handler = getHandlerWithAutoInject(mockPrisma);

    const mockQuery = jest.fn().mockReturnValue(Promise.resolve({ count: 2 }));
    mockTransaction.mockResolvedValue([1, { count: 2 }]);

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-abc', async () => {
        try {
          await handler({
            model: 'Order',
            operation: 'createMany',
            args: { data: [{ product: 'A' }, { product: 'B' }] },
            query: mockQuery,
          });

          expect(mockQuery).toHaveBeenCalledWith({
            data: [
              { product: 'A', tenant_id: 'tenant-abc' },
              { product: 'B', tenant_id: 'tenant-abc' },
            ],
          });
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it('should inject into upsert create but not update', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const handler = getHandlerWithAutoInject(mockPrisma);

    const mockQuery = jest.fn().mockReturnValue(Promise.resolve({ id: 1 }));
    mockTransaction.mockResolvedValue([1, { id: 1 }]);

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-abc', async () => {
        try {
          await handler({
            model: 'Order',
            operation: 'upsert',
            args: {
              where: { id: 1 },
              create: { product: 'New' },
              update: { product: 'Updated' },
            },
            query: mockQuery,
          });

          const calledArgs = mockQuery.mock.calls[0][0];
          expect(calledArgs.create).toEqual({ product: 'New', tenant_id: 'tenant-abc' });
          expect(calledArgs.update).toEqual({ product: 'Updated' });
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it('should NOT inject on update operations', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const handler = getHandlerWithAutoInject(mockPrisma);

    const mockQuery = jest.fn().mockReturnValue(Promise.resolve({ id: 1 }));
    mockTransaction.mockResolvedValue([1, { id: 1 }]);

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-abc', async () => {
        try {
          await handler({
            model: 'Order',
            operation: 'update',
            args: { where: { id: 1 }, data: { product: 'Changed' } },
            query: mockQuery,
          });

          expect(mockQuery).toHaveBeenCalledWith({
            where: { id: 1 },
            data: { product: 'Changed' },
          });
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it('should use custom tenantIdField', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const handler = getHandlerWithAutoInject(mockPrisma, { tenantIdField: 'organization_id' });

    const mockQuery = jest.fn().mockReturnValue(Promise.resolve({ id: 1 }));
    mockTransaction.mockResolvedValue([1, { id: 1 }]);

    await new Promise<void>((resolve, reject) => {
      context.run('org-42', async () => {
        try {
          await handler({
            model: 'Order',
            operation: 'create',
            args: { data: { product: 'Widget' } },
            query: mockQuery,
          });

          expect(mockQuery).toHaveBeenCalledWith({
            data: { product: 'Widget', organization_id: 'org-42' },
          });
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it('should skip injection for sharedModels', async () => {
    const { mockPrisma } = buildMockPrisma();
    const handler = getHandlerWithAutoInject(mockPrisma, { sharedModels: ['Country'] });

    const mockQuery = jest.fn().mockResolvedValue({ id: 1 });

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-abc', async () => {
        try {
          await handler({
            model: 'Country',
            operation: 'create',
            args: { data: { name: 'US' } },
            query: mockQuery,
          });

          // sharedModels bypass both set_config AND auto-inject
          expect(mockQuery).toHaveBeenCalledWith({ data: { name: 'US' } });
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it('should NOT inject when autoInjectTenantId is false (default)', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const handler = getHandler(mockPrisma); // uses default options (no autoInject)

    const mockQuery = jest.fn().mockReturnValue(Promise.resolve({ id: 1 }));
    mockTransaction.mockResolvedValue([1, { id: 1 }]);

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-abc', async () => {
        try {
          await handler({
            model: 'Order',
            operation: 'create',
            args: { data: { product: 'Widget' } },
            query: mockQuery,
          });

          // data should be unchanged — no tenant_id injected
          expect(mockQuery).toHaveBeenCalledWith({ data: { product: 'Widget' } });
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });
});
```

Add the import at the top of the test file:

```typescript
import { PrismaTenancyExtensionOptions } from '../src/prisma/prisma-tenancy.extension';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/prisma-tenancy.extension.spec.ts --no-coverage`
Expected: FAIL — autoInject logic not implemented

- [ ] **Step 3: Add autoInject logic to the extension**

Update the `$allOperations` handler in `src/prisma/prisma-tenancy.extension.ts`. Add the injection logic between the sharedModels check and the transaction:

```typescript
const autoInject = options?.autoInjectTenantId ?? false;
const tenantIdField = options?.tenantIdField ?? 'tenant_id';

// ... inside $allOperations, after sharedModels check:

if (autoInject && tenantId) {
  switch (operation) {
    case 'create':
      args = { ...args, data: { ...args.data, [tenantIdField]: tenantId } };
      break;
    case 'createMany':
      // Prisma's createMany always requires data to be an array
      args = {
        ...args,
        data: args.data.map((d: any) => ({ ...d, [tenantIdField]: tenantId })),
      };
      break;
    case 'upsert':
      args = {
        ...args,
        create: { ...args.create, [tenantIdField]: tenantId },
      };
      break;
  }
}
```

The complete updated `$allOperations` handler becomes:

```typescript
async $allOperations({
  model,
  operation,
  args,
  query,
}: {
  model: string;
  operation: string;
  args: any;
  query: (args: any) => Promise<any>;
}) {
  const tenantId = tenancyService.getCurrentTenant();

  if (!tenantId || sharedModels.has(model)) {
    return query(args);
  }

  if (autoInject) {
    switch (operation) {
      case 'create':
        args = { ...args, data: { ...args.data, [tenantIdField]: tenantId } };
        break;
      case 'createMany':
        // Prisma's createMany always requires data to be an array
        args = {
          ...args,
          data: args.data.map((d: any) => ({ ...d, [tenantIdField]: tenantId })),
        };
        break;
      case 'upsert':
        args = {
          ...args,
          create: { ...args.create, [tenantIdField]: tenantId },
        };
        break;
    }
  }

  const [, result] = await baseClient.$transaction([
    baseClient.$executeRaw`SELECT set_config(${settingKey}, ${tenantId}, TRUE)`,
    query(args),
  ]);

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/prisma-tenancy.extension.spec.ts --no-coverage`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/prisma/prisma-tenancy.extension.ts test/prisma-tenancy.extension.spec.ts
git commit -m "feat: add autoInjectTenantId, tenantIdField, sharedModels to Prisma extension"
```

---

## Task 9: Export PrismaTenancyExtensionOptions

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add type export**

Add to `src/index.ts`:

```typescript
export type { PrismaTenancyExtensionOptions } from './prisma/prisma-tenancy.extension';
```

- [ ] **Step 2: Verify build**

Run: `npx tsc -p tsconfig.build.json --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: export PrismaTenancyExtensionOptions type"
```

---

## Task 10: E2E Tests for autoInjectTenantId and sharedModels

**Files:**
- Modify: `test/e2e/setup.sql`
- Modify: `test/e2e/prisma-extension.e2e-spec.ts`

These tests require Docker (`docker compose up -d`) and `npx prisma generate` to run. They use real PostgreSQL 16 with RLS.

- [ ] **Step 1: Add a shared table (no RLS) to setup.sql**

Append to `test/e2e/setup.sql`:

```sql
-- Shared table for sharedModels testing (no RLS)
DROP TABLE IF EXISTS countries CASCADE;
CREATE TABLE countries (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON countries TO app_user;
GRANT USAGE, SELECT ON SEQUENCE countries_id_seq TO app_user;

INSERT INTO countries (name, code) VALUES
  ('United States', 'US'),
  ('South Korea', 'KR');
```

- [ ] **Step 2: Add Country model to the E2E Prisma schema**

In `test/e2e/schema.prisma`, add:

```prisma
model Country {
  id   Int    @id @default(autoincrement())
  name String
  code String

  @@map("countries")
}
```

- [ ] **Step 3: Write E2E tests**

Append to `test/e2e/prisma-extension.e2e-spec.ts` a new `describe` block:

```typescript
describe('Prisma Extension v0.2.0 Features', () => {
  let adminClient: Client;
  let context: TenancyContext;
  let service: TenancyService;
  let prisma: any;

  beforeAll(async () => {
    adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();

    const setupSql = fs.readFileSync(path.join(__dirname, 'setup.sql'), 'utf-8');
    await adminClient.query(setupSql);

    const generatedPath = path.join(__dirname, 'generated');
    const prismaModule = require(generatedPath);
    const PrismaClient = prismaModule.PrismaClient;

    context = new TenancyContext();
    service = new TenancyService(context);

    const basePrisma = new PrismaClient({ datasourceUrl: APP_URL });
    prisma = basePrisma.$extends(
      createPrismaTenancyExtension(service, {
        autoInjectTenantId: true,
        tenantIdField: 'tenant_id',
        sharedModels: ['Country'],
      }),
    );

    await prisma.$connect();
  }, 30000);

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    await adminClient.query('DROP TABLE IF EXISTS countries CASCADE');
    await adminClient.end();
  });

  it('should auto-inject tenant_id on create', async () => {
    const user = await new Promise<any>((resolve, reject) => {
      context.run(TENANT_1, async () => {
        try {
          resolve(
            await prisma.user.create({
              data: { name: 'AutoInject', email: 'auto@test.com' },
            }),
          );
        } catch (e) {
          reject(e);
        }
      });
    });

    expect(user.tenant_id).toBe(TENANT_1);
    expect(user.name).toBe('AutoInject');

    // Cleanup
    await adminClient.query(`DELETE FROM users WHERE name = 'AutoInject'`);
  });

  it('should read shared table (Country) regardless of tenant context', async () => {
    const countries = await new Promise<any[]>((resolve, reject) => {
      context.run(TENANT_1, async () => {
        try {
          resolve(await prisma.country.findMany());
        } catch (e) {
          reject(e);
        }
      });
    });

    // sharedModels skips set_config, so all rows are returned
    expect(countries).toHaveLength(2);
    expect(countries.map((c: any) => c.code).sort()).toEqual(['KR', 'US']);
  });

  it('should read shared table without tenant context', async () => {
    // No context.run — sharedModels bypasses set_config so rows are still returned
    const countries = await prisma.country.findMany();
    expect(countries).toHaveLength(2);
  });
});
```

- [ ] **Step 4: Run E2E tests**

Run: `npm run test:e2e`
Expected: All E2E tests PASS (existing + new)

- [ ] **Step 5: Commit**

```bash
git add test/e2e/setup.sql test/e2e/prisma-extension.e2e-spec.ts
git commit -m "test: add E2E tests for autoInjectTenantId and sharedModels"
```

Note: If the E2E Prisma schema needs regeneration, run `npx prisma generate --schema=test/e2e/schema.prisma` before running the tests. The `npm run test:e2e` script already handles this.

---

## Task 11: Full Verification

- [ ] **Step 1: Run all unit tests with coverage**

Run: `npm test`
Expected: All tests PASS, coverage maintained or improved

- [ ] **Step 2: Build the package**

Run: `npm run build`
Expected: Clean build, no errors

- [ ] **Step 3: Verify lint (TypeScript strict check)**

Run: `npm run lint`
Expected: No type errors

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "chore: verification fixes for v0.2.0"
```
