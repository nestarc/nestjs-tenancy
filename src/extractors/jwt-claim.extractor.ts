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
