import { TenantContextMissingError } from '../src/errors/tenant-context-missing.error';
import { TenancyContextRequiredError } from '../src/errors/tenancy-context-required.error';

describe('TenantContextMissingError', () => {
  it('should have correct name', () => {
    const error = new TenantContextMissingError();
    expect(error.name).toBe('TenantContextMissingError');
  });

  it('should have default message', () => {
    const error = new TenantContextMissingError();
    expect(error.message).toBe('No tenant context available');
  });

  it('should accept custom message', () => {
    const error = new TenantContextMissingError('Custom message');
    expect(error.message).toBe('Custom message');
  });

  it('should be instanceof Error', () => {
    const error = new TenantContextMissingError();
    expect(error).toBeInstanceOf(Error);
  });

  it('should be parent of TenancyContextRequiredError', () => {
    const error = new TenancyContextRequiredError('User', 'findMany');
    expect(error).toBeInstanceOf(TenantContextMissingError);
  });

  it('should NOT be instanceof TenancyContextRequiredError', () => {
    const error = new TenantContextMissingError();
    expect(error).not.toBeInstanceOf(TenancyContextRequiredError);
  });
});
