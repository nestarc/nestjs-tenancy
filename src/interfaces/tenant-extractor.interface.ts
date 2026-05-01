import { TenancyRequest } from './tenancy-request.interface';

/**
 * Contract for extracting a tenant ID from an inbound HTTP request.
 *
 * Return the tenant ID string when present, or `null` when the request does
 * not carry tenant information. A missing tenant is not an error condition;
 * `TenantMiddleware` will call `onTenantNotFound` and let the application
 * decide whether to continue, respond, or throw.
 *
 * Implementations may return synchronously or return a Promise for async
 * lookups. Throw only for malformed input or policy failures that should
 * reject the request immediately.
 */
export interface TenantExtractor {
  extract(request: TenancyRequest): string | null | Promise<string | null>;
}
