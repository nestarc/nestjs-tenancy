# HTTP extraction, authentication, and lifecycle hooks

[Package overview](../README.md) · [Documentation index](./README.md) · [Runnable example](../examples/quickstart/README.md)

The snippets below are configuration examples. The runnable Express example demonstrates authentication, membership authorization, and tenant middleware in an executable application.

## Tenant Extractors

Five built-in extractors cover common multi-tenancy patterns:

### Header (default)

```typescript
TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id', // shorthand for HeaderTenantExtractor
})
```

### Subdomain

```typescript
import { SubdomainTenantExtractor } from '@nestarc/tenancy';

TenancyModule.forRoot({
  tenantExtractor: new SubdomainTenantExtractor({
    excludeSubdomains: ['www', 'api'], // optional, defaults to ['www']
  }),
  validateTenantId: (id) => /^[a-z0-9-]+$/.test(id),
})
// tenant1.app.com → 'tenant1'
```

> **Note:** Uses the `psl` package for accurate ccTLD parsing (installed automatically as a dependency).

### JWT Claim

```typescript
import { JwtClaimTenantExtractor } from '@nestarc/tenancy';

TenancyModule.forRoot({
  tenantExtractor: new JwtClaimTenantExtractor({
    claimKey: 'org_id',       // JWT payload key
    headerName: 'authorization', // optional, defaults to 'authorization'
  }),
})
// Authorization: Bearer eyJ... → payload.org_id
```

`JwtClaimTenantExtractor` decodes claims and checks `exp` / `nbf`, but does **not** verify signatures, trusted issuer, audience, or tenant membership. Authenticate the token before extraction, then authorize the resolved tenant against the verified principal. See [authentication ordering](#authentication-before-tenant-resolution).

### Path Parameter

```typescript
import { PathTenantExtractor } from '@nestarc/tenancy';

TenancyModule.forRoot({
  tenantExtractor: new PathTenantExtractor({
    pattern: '/api/tenants/:tenantId/resources',
    paramName: 'tenantId',
  }),
  validateTenantId: (id) => /^[a-z0-9-]+$/.test(id),
})
// /api/tenants/acme/resources → 'acme'
```

Starting in **0.16.1**, the extractor accepts `request.path`, falling back to `request.url`, and removes query/hash suffixes before matching. Version `0.16.0` requires `request.path`: if your adapter supplies only a raw URL on that version, populate `path` before tenant middleware (for an origin-form URL, take the portion before `?` or `#`) or provide a custom extractor. Express normally supplies `path` already.

### Composite (Fallback Chain)

```typescript
import {
  CompositeTenantExtractor,
  HeaderTenantExtractor,
  SubdomainTenantExtractor,
  JwtClaimTenantExtractor,
} from '@nestarc/tenancy';

TenancyModule.forRoot({
  tenantExtractor: new CompositeTenantExtractor([
    new HeaderTenantExtractor('X-Tenant-Id'),
    new SubdomainTenantExtractor(),
    new JwtClaimTenantExtractor({ claimKey: 'org_id' }),
  ]),
  validateTenantId: (id) => /^[a-z0-9-]+$/.test(id),
})
// Returns the first non-null value, then HTTP middleware validates that value.
```

A composite extractor falls back only when an extractor returns `null`/`undefined`; an invalid non-null value fails validation and does not try the next source. Choose one validator that accepts your intended identifiers from every source (the example accepts lowercase slugs). Slug validation is not membership authorization. Authenticate and authorize all accepted sources.

### Custom Extractor

```typescript
import { TenantExtractor, TenancyRequest } from '@nestarc/tenancy';

export class CookieTenantExtractor implements TenantExtractor {
  extract(request: TenancyRequest): string | null {
    const cookies = request.cookies;
    if (typeof cookies !== 'object' || cookies === null || !('tenant_id' in cookies)) {
      return null;
    }
    return typeof cookies.tenant_id === 'string' ? cookies.tenant_id : null;
  }
}
```

Cookie extraction requires a parser to populate `request.cookies` before the tenant middleware; the package does not parse cookies. The public request type leaves platform-specific properties as `unknown`, so narrow them as above. A cookie remains caller-controlled unless your authentication system verifies it.

## Authentication before tenant resolution

`TenancyModule` installs global Nest middleware. Nest executes middleware before guards, so a Passport `AuthGuard` cannot populate the principal for `onTenantResolved`. Importing an auth module before `TenancyModule` does not establish the required order.

For the Express adapter, register authentication on the application before `app.init()` or `app.listen()`:

```typescript
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { authenticateRequest } from './authentication';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Verifies credentials and populates req.user; rejects invalid credentials.
  app.use(authenticateRequest);
  await app.init();
  await app.listen(3000);
}
void bootstrap();
```

`authenticateRequest` is application-owned authentication middleware, not a package export. It must complete signature/credential verification before calling `next()`. See the [executable demo authentication](../examples/quickstart/README.md) and replace its local demo tokens with your production authentication provider.

Check tenant membership in `onTenantResolved` using the verified principal:

```typescript
import { ForbiddenException } from '@nestjs/common';
import { TenancyModule } from '@nestarc/tenancy';

TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',
  onTenantResolved: (tenantId, req) => {
    const principal = req.user;
    if (typeof principal !== 'object' || principal === null ||
        !('tenantIds' in principal) || !Array.isArray(principal.tenantIds) ||
        !principal.tenantIds.every((id: unknown) => typeof id === 'string') ||
        !principal.tenantIds.includes(tenantId)) {
      throw new ForbiddenException('Tenant access denied');
    }
  },
});
```

If authentication stores a single tenant claim instead, narrow it before reading it: `typeof principal === 'object' && principal !== null && 'org_id' in principal && typeof principal.org_id === 'string'`. Never treat a decoded, unverified JWT as `req.user`. The resolved hook runs inside the tenant context; do membership verification before tenant-scoped database work in that hook.

## HTTP adapter prerequisites

The public `TenancyRequest`/`TenancyResponse` interfaces avoid an Express dependency. Structural type compatibility does not install a framework or provide its middleware hooks.

| Extractor or hook | Required request/response behavior |
| --- | --- |
| Header and JWT | `headers`; header names are normalized to lowercase by Node HTTP adapters |
| Subdomain | `hostname`; the extractor does not derive it from a raw `Host` header, so raw-request middleware must populate it using the application's trusted host/proxy rules |
| Path | Version `0.16.1` onward: `path`, falling back to `url`, with query/hash suffixes removed; `0.16.0` needs `path` populated as described [above](#path-parameter) |
| Cookie/custom principal | Upstream parser/authentication must populate the custom field on the same object seen by tenant middleware |
| Direct response in a hook | Use the response API actually supplied by the adapter; public response methods are optional |

For Nest Express, application middleware sees Express requests/responses. For Nest Fastify, middleware may receive raw Node request/response objects; a Fastify route hook or a `FastifyReply` type assertion does not guarantee that tenant middleware receives the populated field or reply API. Establish authentication in middleware registered before Nest initialization, copy verified state onto the request object seen by tenant middleware, and use Node `ServerResponse` when that is the actual response. Validate ordering and context on your exact adapter configuration. The package is a Nest module; a raw Node request satisfying the interface is not a standalone Node server integration.

The [example and documentation tests](../examples/quickstart/README.md#verification) exercise Express authentication order and path extraction from raw URLs. They do not claim a full Fastify application E2E matrix.

## Lifecycle Hooks

`onTenantResolved` runs after extraction, format validation, and cross-check, inside AsyncLocalStorage context. Use it for membership checks or application logging.

Choose one `onTenantNotFound` behavior for a module. These are separate alternatives.

Observation lets the request continue to the guard; protected routes still return 403:

```typescript
TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',
  onTenantNotFound: (req) => {
    console.warn('No tenant', req.path ?? req.url);
  },
});
```

To block at middleware, throw a Nest exception:

```typescript
import { ForbiddenException } from '@nestjs/common';

TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',
  onTenantNotFound: () => {
    throw new ForbiddenException('Tenant header required');
  },
});
```

To send a response yourself on **Express**, use the known adapter response type and return `'skip'` only after sending:

```typescript
import type { Response } from 'express';

TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',
  onTenantNotFound: (_req, res) => {
    (res as unknown as Response).status(401).json({ message: 'Tenant header required' });
    return 'skip';
  },
});
```

For middleware receiving a raw Node response, the corresponding response operation is:

```typescript
import type { ServerResponse } from 'node:http';

TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',
  onTenantNotFound: (_req, res) => {
    const response = res as unknown as ServerResponse;
    response.statusCode = 401;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ message: 'Tenant header required' }));
    return 'skip';
  },
});
```

A type assertion must match the configured adapter. Optional calls such as `res.status?.()` are not a substitute: returning `'skip'` without sending a response leaves the request unfinished.

| Hook | Signature | When |
| --- | --- | --- |
| `onTenantResolved` | `(tenantId: string, req: TenancyRequest) => void \| Promise<void>` | After extraction, validation, and cross-check |
| `onTenantNotFound` | `(req: TenancyRequest, res: TenancyResponse) => void \| 'skip' \| Promise<void \| 'skip'>` | When no tenant ID is extracted |

## Tenant ID Forgery Prevention

Compare the tenant ID with a trusted secondary source. For JWT claims, verify the token before extraction as described above:

```typescript
import { JwtClaimTenantExtractor } from '@nestarc/tenancy';

TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',
  crossCheck: {
    extractor: new JwtClaimTenantExtractor({ claimKey: 'tenantId' }),
    onFailed: 'reject',  // 'reject' (default) | 'log'
    required: true,       // reject when the trusted secondary source is missing
  },
})
```

If the cross-check extractor returns `null` (e.g., no JWT present), validation is skipped by default — unauthenticated endpoints work normally. Set `required: true` to reject requests when the cross-check source is missing, requiring a non-empty secondary value. Its authenticity still depends on upstream verification. On mismatch, `tenant.cross_check_failed` event is emitted.

> **HTTP-only contract:** `crossCheck` and `onTenantResolved` are executed by `TenantMiddleware`. `TenantContextInterceptor` does not apply them to RPC messages, and they do not replace RPC producer authentication or authorization.

See [earlier migration notes](./compatibility.md#earlier-migration-notes) if upgrading from removed flat cross-check options.
