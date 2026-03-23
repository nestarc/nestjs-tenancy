import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenancyGuard } from '../src/guards/tenancy.guard';
import { TenancyContext } from '../src/services/tenancy-context';

function createMockContext(type: string = 'http', handler: Function = () => {}, classRef: Function = class {}): ExecutionContext {
  return {
    getType: () => type,
    getHandler: () => handler,
    getClass: () => classRef,
    switchToHttp: () => ({ getRequest: () => ({}) }),
  } as any;
}

describe('TenancyGuard', () => {
  let context: TenancyContext;
  let reflector: Reflector;
  let guard: TenancyGuard;

  beforeEach(() => {
    context = new TenancyContext();
    reflector = new Reflector();
    guard = new TenancyGuard(context, reflector);
  });

  it('should allow when tenant is present', (done) => {
    context.run('tenant-123', () => {
      expect(guard.canActivate(createMockContext())).toBe(true);
      done();
    });
  });

  it('should throw ForbiddenException when tenant is missing', () => {
    expect(() => guard.canActivate(createMockContext())).toThrow(ForbiddenException);
  });

  it('should skip non-HTTP contexts (ws)', () => {
    expect(guard.canActivate(createMockContext('ws'))).toBe(true);
  });

  it('should skip non-HTTP contexts (rpc)', () => {
    expect(guard.canActivate(createMockContext('rpc'))).toBe(true);
  });

  it('should skip when @BypassTenancy is set', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    expect(guard.canActivate(createMockContext())).toBe(true);
  });
});
