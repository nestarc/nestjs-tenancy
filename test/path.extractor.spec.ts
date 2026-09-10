import { PathTenantExtractor } from '../src/extractors/path.extractor';

describe('PathTenantExtractor', () => {
  it('should extract param from matching path', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { path: '/api/tenants/abc-123' } as any;
    expect(extractor.extract(req)).toBe('abc-123');
  });

  it('should support prefix match (trailing segments)', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { path: '/api/tenants/abc-123/users/profile' } as any;
    expect(extractor.extract(req)).toBe('abc-123');
  });

  it('should ignore query string and hash fragments', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { path: '/api/tenants/abc-123?include=users#section' } as any;
    expect(extractor.extract(req)).toBe('abc-123');
  });

  it('should extract from a raw Node-style URL when path is absent', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { headers: {}, url: '/api/tenants/abc-123?include=users#section' };
    expect(extractor.extract(req)).toBe('abc-123');
  });

  it('should use URL when the adapter path is empty', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { headers: {}, path: '', url: '/api/tenants/abc-123' };
    expect(extractor.extract(req)).toBe('abc-123');
  });

  it('should prefer the adapter path over URL', () => {
    const extractor = new PathTenantExtractor({ pattern: '/tenants/:tenantId', paramName: 'tenantId' });
    const req = { headers: {}, path: '/tenants/path-tenant', url: '/prefix/tenants/url-tenant' };
    expect(extractor.extract(req)).toBe('path-tenant');
  });

  it('should not retry a matching URL when the adapter path does not match', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { headers: {}, path: '/api/users/abc-123', url: '/api/tenants/abc-123' };
    expect(extractor.extract(req)).toBeNull();
  });

  it.each([
    '/api/users/abc-123',
    '/api/tenants',
    '/api/tenants?tenantId=abc-123',
    '/api/tenants#abc-123',
    '/prefix/api/tenants/abc-123',
    'https://example.com/api/tenants/abc-123',
  ])('should preserve route matching for URL %s', (url) => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    expect(extractor.extract({ headers: {}, url })).toBeNull();
  });

  it('should support trailing URL segments and decode only the tenant segment', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { headers: {}, url: '/api/tenants/acme%20corp/users?include=%invalid#section' };
    expect(extractor.extract(req)).toBe('acme corp');
  });

  it('should not turn an encoded path separator into a route segment', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { headers: {}, url: '/api%2Ftenants/abc-123' };
    expect(extractor.extract(req)).toBeNull();
  });

  it('should decode URL-encoded tenant segment', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { path: '/api/tenants/acme%20corp' } as any;
    expect(extractor.extract(req)).toBe('acme corp');
  });

  it.each(['path', 'url'])('should return null for malformed URL encoding in %s', (field) => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { headers: {}, [field]: '/api/tenants/%E0%A4%A' };
    expect(extractor.extract(req)).toBeNull();
  });

  it.each([
    { path: 123 },
    { path: ['/api/tenants/abc-123'] },
    { url: {} },
    { url: ['/api/tenants/abc-123'] },
  ])('should return null for a malformed request target: %j', (target) => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    expect(extractor.extract({ headers: {}, ...target } as any)).toBeNull();
  });

  it('should return null when path has fewer segments than pattern', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { path: '/api/tenants' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null when static segments do not match', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { path: '/api/users/abc-123' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should handle param in middle of path', () => {
    const extractor = new PathTenantExtractor({ pattern: '/orgs/:orgId/projects', paramName: 'orgId' });
    const req = { path: '/orgs/my-org/projects' } as any;
    expect(extractor.extract(req)).toBe('my-org');
  });

  it('should throw at construction when paramName not found in pattern', () => {
    expect(() => new PathTenantExtractor({ pattern: '/api/:id', paramName: 'tenantId' }))
      .toThrow('":tenantId" not found in pattern "/api/:id"');
  });

  it('should return null when both request.path and request.url are undefined', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { headers: {} } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null when request.path is empty string', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { path: '' } as any;
    expect(extractor.extract(req)).toBeNull();
  });
});
