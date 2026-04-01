/**
 * Contract for propagating tenant context to outgoing requests.
 *
 * Implementations transform the current tenant ID into transport-specific
 * headers or metadata. Used by `HttpTenantPropagator` for HTTP, with
 * Kafka/gRPC/Bull adapters planned for future versions.
 */
export interface TenantPropagator {
  /**
   * Returns headers to propagate tenant context.
   * Returns an empty object if no tenant context is available.
   */
  getHeaders(): Record<string, string>;
}
