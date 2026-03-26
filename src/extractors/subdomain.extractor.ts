import { Request } from 'express';
import { TenantExtractor } from '../interfaces/tenant-extractor.interface';

export interface SubdomainExtractorOptions {
  excludeSubdomains?: string[];
}

let pslModule: typeof import('psl') | null = null;

function loadPsl(): typeof import('psl') {
  if (pslModule) return pslModule;
  try {
     
    pslModule = require('psl');
    return pslModule!;
  } catch {
    throw new Error(
      'SubdomainTenantExtractor requires the "psl" package. Install it: npm install psl',
    );
  }
}

export class SubdomainTenantExtractor implements TenantExtractor {
  private readonly excludes: Set<string>;
  private readonly psl: typeof import('psl');

  constructor(options?: SubdomainExtractorOptions) {
    this.excludes = new Set(
      (options?.excludeSubdomains ?? ['www']).map((s) => s.toLowerCase()),
    );
    this.psl = loadPsl();
  }

  extract(request: Request): string | null {
    const hostname = request.hostname;
    const parsed = this.psl.parse(hostname);

    if ('error' in parsed || !('subdomain' in parsed) || !parsed.subdomain || !parsed.listed) {
      return null;
    }

    const parts = parsed.subdomain.split('.');
    const subdomain = parts[0].toLowerCase();

    if (this.excludes.has(subdomain)) return null;
    return subdomain;
  }
}
