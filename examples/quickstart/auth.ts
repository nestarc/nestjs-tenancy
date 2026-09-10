import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { TenantExtractor, TenancyRequest } from '@nestarc/tenancy';

export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '22222222-2222-4222-8222-222222222222';

interface DemoPrincipal {
  subject: string;
  allowedTenantIds: readonly string[];
}

interface AuthenticatedRequest extends Request {
  user?: DemoPrincipal;
}

// Public, fixed credentials for this local demo ONLY. In production, use your
// authentication provider to verify credentials and load trusted memberships.
const DEMO_CREDENTIALS: Readonly<Record<string, DemoPrincipal>> = {
  'Bearer demo-alice': { subject: 'alice', allowedTenantIds: [TENANT_A] },
  'Bearer demo-bob': { subject: 'bob', allowedTenantIds: [TENANT_B] },
};

export function demoAuthentication(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): void {
  const authorization = request.headers.authorization;
  const principal = authorization
    && Object.prototype.hasOwnProperty.call(DEMO_CREDENTIALS, authorization)
    ? DEMO_CREDENTIALS[authorization]
    : undefined;

  if (!principal) {
    response.status(401).json({ message: 'Valid demo credentials are required' });
    return;
  }
  request.user = principal;
  next();
}

function principalFrom(request: TenancyRequest): DemoPrincipal {
  const value = request.user;
  if (typeof value !== 'object' || value === null
    || !('subject' in value) || typeof value.subject !== 'string'
    || !('allowedTenantIds' in value) || !Array.isArray(value.allowedTenantIds)
    || !value.allowedTenantIds.every((id: unknown) => typeof id === 'string')) {
    throw new UnauthorizedException('Authentication must run before tenant extraction');
  }
  return { subject: value.subject, allowedTenantIds: value.allowedTenantIds };
}

export class AuthorizedTenantExtractor implements TenantExtractor {
  extract(request: TenancyRequest): string | null {
    const principal = principalFrom(request);
    const tenantId = request.headers['x-tenant-id'];
    if (typeof tenantId !== 'string' || tenantId.length === 0) return null;
    if (!principal.allowedTenantIds.includes(tenantId)) {
      throw new ForbiddenException('This user cannot access the requested tenant');
    }
    return tenantId;
  }
}
