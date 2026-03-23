import { Request } from 'express';

export interface TenantExtractor {
  extract(request: Request): string | null | Promise<string | null>;
}
