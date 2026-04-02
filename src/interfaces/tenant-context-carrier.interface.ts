/**
 * Transport-agnostic contract for propagating tenant context across service boundaries.
 *
 * Unlike `TenantPropagator` (HTTP-specific, returns `Record<string, string>`),
 * this interface supports any carrier type: Bull job data, Kafka messages,
 * gRPC metadata, or custom transports.
 *
 * Follows the OpenTelemetry inject/extract pattern:
 * - `inject`: attaches the current tenant ID to an outgoing carrier
 * - `extract`: reads a tenant ID from an incoming carrier
 *
 * @typeParam TCarrier The transport-specific data structure (e.g., job data object, Kafka message, gRPC Metadata)
 */
export interface TenantContextCarrier<TCarrier = unknown> {
  /**
   * Attaches the current tenant ID to the carrier for outbound propagation.
   * Returns the carrier with tenant context included.
   * If no tenant context is available, returns the carrier unchanged.
   */
  inject(carrier: TCarrier): TCarrier;

  /**
   * Extracts the tenant ID from an incoming carrier.
   * Returns the tenant ID string, or `null` if not present.
   */
  extract(carrier: TCarrier): string | null;
}
