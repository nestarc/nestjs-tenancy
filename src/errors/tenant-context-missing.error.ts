/**
 * Thrown when tenant context is required but not available.
 *
 * Base class for all tenancy context errors. Use `instanceof TenantContextMissingError`
 * to catch both this error and its subclass `TenancyContextRequiredError` (Prisma fail-closed).
 *
 * @example
 * ```typescript
 * try {
 *   const tenantId = tenancyService.getCurrentTenantOrThrow();
 * } catch (e) {
 *   if (e instanceof TenantContextMissingError) {
 *     // Handles both service-level and Prisma-level errors
 *   }
 * }
 * ```
 */
export class TenantContextMissingError extends Error {
  public override name = 'TenantContextMissingError';

  constructor(message?: string) {
    super(message ?? 'No tenant context available');
  }
}
