jest.mock('psl', () => null);

describe('SubdomainTenantExtractor — loadPsl edge cases', () => {
  it('should throw when psl module returns null', () => {
    const { SubdomainTenantExtractor } = require('../src/extractors/subdomain.extractor');
    expect(() => new SubdomainTenantExtractor()).toThrow(
      'SubdomainTenantExtractor requires the "psl" package',
    );
  });
});
