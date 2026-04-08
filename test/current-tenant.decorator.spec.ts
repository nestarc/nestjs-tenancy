import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentTenant } from '../src/decorators/current-tenant.decorator';
import { TenancyContext } from '../src/services/tenancy-context';

function getParamDecoratorFactory(decorator: Function) {
  class Test {
    handler(@decorator() _value: unknown) {}
  }
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, Test, 'handler');
  const key = Object.keys(metadata)[0];
  return metadata[key].factory;
}

describe('CurrentTenant', () => {
  it('should read tenant ID from static AsyncLocalStorage', (done) => {
    const setter = new TenancyContext();
    const reader = new TenancyContext();
    setter.run('tenant-xyz', () => {
      expect(reader.getTenantId()).toBe('tenant-xyz');
      done();
    });
  });

  it('should return null when no tenant context', () => {
    const ctx = new TenancyContext();
    expect(ctx.getTenantId()).toBeNull();
  });

  describe('decorator factory', () => {
    let factory: Function;

    beforeEach(() => {
      factory = getParamDecoratorFactory(CurrentTenant);
    });

    it('should return tenant ID inside tenant context', () => {
      const ctx = new TenancyContext();
      ctx.run('tenant-abc', () => {
        const result = factory(null, {});
        expect(result).toBe('tenant-abc');
      });
    });

    it('should return null outside tenant context', () => {
      const result = factory(null, {});
      expect(result).toBeNull();
    });
  });
});
