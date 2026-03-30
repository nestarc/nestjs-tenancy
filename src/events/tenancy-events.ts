import { Request } from 'express';

export const TenancyEvents = {
  RESOLVED: 'tenant.resolved',
  NOT_FOUND: 'tenant.not_found',
  VALIDATION_FAILED: 'tenant.validation_failed',
  CONTEXT_BYPASSED: 'tenant.context_bypassed',
} as const;

export interface TenantResolvedEvent {
  tenantId: string;
  request: Request;
}

export interface TenantNotFoundEvent {
  request: Request;
}

export interface TenantValidationFailedEvent {
  tenantId: string;
  request: Request;
}

export interface TenantContextBypassedEvent {
  reason: 'decorator' | 'withoutTenant';
}
