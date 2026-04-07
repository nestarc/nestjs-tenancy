import { TenancyRequest } from '../interfaces/tenancy-request.interface';

export const TenancyEvents = {
  RESOLVED: 'tenant.resolved',
  NOT_FOUND: 'tenant.not_found',
  VALIDATION_FAILED: 'tenant.validation_failed',
  CONTEXT_BYPASSED: 'tenant.context_bypassed',
  CROSS_CHECK_FAILED: 'tenant.cross_check_failed',
} as const;

export interface TenantResolvedEvent {
  tenantId: string;
  request: TenancyRequest;
}

export interface TenantNotFoundEvent {
  request: TenancyRequest;
}

export interface TenantValidationFailedEvent {
  tenantId: string;
  request: TenancyRequest;
}

export interface TenantContextBypassedEvent {
  reason: 'decorator' | 'withoutTenant';
}

export interface TenantCrossCheckFailedEvent {
  extractedTenantId: string;
  crossCheckTenantId: string;
  request: TenancyRequest;
}

/**
 * Type-safe mapping from event name to payload type.
 * Used by `TenancyEventService.emit()` to enforce correct payloads at compile time.
 */
export interface TenancyEventMap {
  [TenancyEvents.RESOLVED]: TenantResolvedEvent;
  [TenancyEvents.NOT_FOUND]: TenantNotFoundEvent;
  [TenancyEvents.VALIDATION_FAILED]: TenantValidationFailedEvent;
  [TenancyEvents.CONTEXT_BYPASSED]: TenantContextBypassedEvent;
  [TenancyEvents.CROSS_CHECK_FAILED]: TenantCrossCheckFailedEvent;
}
