import { TenancyContext } from '../services/tenancy-context';
import { TenantContextCarrier } from '../interfaces/tenant-context-carrier.interface';

export interface GrpcPropagationOptions {
  /** Metadata key for tenant ID. Defaults to 'x-tenant-id' (lowercase per gRPC convention). */
  metadataKey?: string;
}

const DEFAULT_GRPC_METADATA_KEY = 'x-tenant-id';

/**
 * Structural type for gRPC Metadata — no dependency on @grpc/grpc-js.
 *
 * Matches the subset of `@grpc/grpc-js` `Metadata` used for tenant propagation.
 */
export interface GrpcMetadataLike {
  set(key: string, value: string): void;
  get(key: string): (string | Buffer)[];
}

/**
 * gRPC tenant propagator.
 *
 * Injects tenant ID into gRPC call metadata on the client side,
 * and extracts it on the server side.
 *
 * Uses lowercase metadata keys per gRPC convention (keys are case-insensitive
 * but lowercase is standard).
 *
 * No runtime dependency on `@grpc/grpc-js` — uses structural types.
 *
 * @example
 * ```typescript
 * const propagator = new GrpcTenantPropagator(new TenancyContext());
 *
 * // Client: inject tenant into outgoing metadata
 * const metadata = new Metadata();
 * propagator.inject(metadata);
 *
 * // Server: extract tenant from incoming metadata
 * const tenantId = propagator.extract(call.metadata);
 * ```
 */
export class GrpcTenantPropagator
  implements TenantContextCarrier<GrpcMetadataLike>
{
  private readonly metadataKey: string;

  constructor(
    private readonly context: TenancyContext,
    options?: GrpcPropagationOptions,
  ) {
    this.metadataKey = options?.metadataKey ?? DEFAULT_GRPC_METADATA_KEY;
  }

  inject(metadata: GrpcMetadataLike): GrpcMetadataLike {
    const tenantId = this.context.getTenantId();
    if (!tenantId) return metadata;
    metadata.set(this.metadataKey, tenantId);
    return metadata;
  }

  extract(metadata: GrpcMetadataLike): string | null {
    const values = metadata.get(this.metadataKey);
    if (!values || values.length === 0) return null;
    const first = values[0];
    if (typeof first === 'string' && first.length > 0) return first;
    if (Buffer.isBuffer(first)) {
      const decoded = first.toString('utf-8');
      return decoded.length > 0 ? decoded : null;
    }
    return null;
  }
}
