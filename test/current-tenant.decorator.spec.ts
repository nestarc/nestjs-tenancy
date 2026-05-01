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

  it('should expose tenant ID through static helper', () => {
    const ctx = new TenancyContext();
    ctx.run('tenant-static', () => {
      expect(TenancyContext.getCurrentTenantId()).toBe('tenant-static');
    });
  });

  it('should not instantiate TenancyContext when decorator module is loaded', () => {
    jest.isolateModules(() => {
      const getCurrentTenantId = jest.fn(() => 'tenant-from-static');
      const TenancyContextMock = jest.fn(() => {
        throw new Error('TenancyContext constructor should not be called');
      });
      Object.defineProperty(TenancyContextMock, 'getCurrentTenantId', {
        value: getCurrentTenantId,
      });

      jest.doMock('../src/services/tenancy-context', () => ({
        TenancyContext: TenancyContextMock,
      }));

      const {
        CurrentTenant: MockedCurrentTenant,
      } = require('../src/decorators/current-tenant.decorator');
      const factory = getParamDecoratorFactory(MockedCurrentTenant);

      expect(factory(null, {})).toBe('tenant-from-static');
      expect(TenancyContextMock).not.toHaveBeenCalled();
      expect(getCurrentTenantId).toHaveBeenCalledTimes(1);

      jest.dontMock('../src/services/tenancy-context');
    });
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
