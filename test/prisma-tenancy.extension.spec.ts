import { TenancyContext } from '../src/services/tenancy-context';
import { TenancyService } from '../src/services/tenancy.service';
import {
  createPrismaTenancyExtension,
  PrismaTenancyExtensionOptions,
} from '../src/prisma/prisma-tenancy.extension';
import { TenancyContextRequiredError } from '../src/errors/tenancy-context-required.error';

/**
 * Unit tests for createPrismaTenancyExtension.
 *
 * Since Prisma.defineExtension returns an opaque descriptor,
 * we mock Prisma.defineExtension to capture the inner factory,
 * then invoke it with a mock PrismaClient to test the actual logic.
 */

// Mock Prisma.defineExtension to capture the factory function
let capturedFactory: ((prisma: any) => any) | null = null;

jest.mock('@prisma/client', () => ({
  Prisma: {
    defineExtension: (factory: (prisma: any) => any) => {
      capturedFactory = factory;
      return factory;
    },
  },
}));

describe('createPrismaTenancyExtension', () => {
  let context: TenancyContext;
  let service: TenancyService;

  beforeEach(() => {
    context = new TenancyContext();
    service = new TenancyService(context);
    capturedFactory = null;
  });

  function buildMockPrisma() {
    const mockTransaction = jest.fn();
    const mockExecuteRaw = jest.fn();

    const mockPrisma = {
      $transaction: mockTransaction,
      $executeRaw: mockExecuteRaw,
      $extends: jest.fn((config: any) => {
        // Store the $allOperations handler for direct invocation
        return config;
      }),
    };

    return { mockPrisma, mockTransaction, mockExecuteRaw };
  }

  function getHandler(mockPrisma: any) {
    createPrismaTenancyExtension(service);
    expect(capturedFactory).not.toBeNull();

    const extensionConfig = capturedFactory!(mockPrisma);
    return extensionConfig.query.$allModels.$allOperations;
  }

  function getHandlerWithAutoInject(
    mockPrisma: any,
    opts?: Partial<PrismaTenancyExtensionOptions>,
  ) {
    capturedFactory = null;
    createPrismaTenancyExtension(service, { autoInjectTenantId: true, ...opts });
    const extensionConfig = capturedFactory!(mockPrisma);
    return extensionConfig.query.$allModels.$allOperations;
  }

  it('should return a Prisma.defineExtension result', () => {
    const result = createPrismaTenancyExtension(service);
    expect(result).toBeDefined();
    expect(capturedFactory).not.toBeNull();
  });

  it('should pass through query when no tenant context', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const handler = getHandler(mockPrisma);

    const mockQuery = jest.fn().mockResolvedValue([{ id: 1 }]);
    const result = await handler({
      model: 'TestModel',
      operation: 'findMany',
      args: { where: { id: 1 } },
      query: mockQuery,
    });

    expect(mockQuery).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(result).toEqual([{ id: 1 }]);
  });

  it('should wrap in batch transaction when tenant exists', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const handler = getHandler(mockPrisma);

    const mockQuery = jest.fn().mockReturnValue(
      Promise.resolve([{ id: 1, tenant_id: 'tenant-1' }]),
    );

    // $transaction receives array of promises and returns their results
    mockTransaction.mockResolvedValue([1, [{ id: 1, tenant_id: 'tenant-1' }]]);

    await new Promise<void>((resolve, reject) => {
      context.run('550e8400-e29b-41d4-a716-446655440000', async () => {
        try {
          const result = await handler({
            model: 'TestModel',
            operation: 'findMany',
            args: { where: { id: 1 } },
            query: mockQuery,
          });

          expect(mockTransaction).toHaveBeenCalledTimes(1);

          // Verify $transaction was called with an array of two elements
          const txArgs = mockTransaction.mock.calls[0][0];
          expect(Array.isArray(txArgs)).toBe(true);
          expect(txArgs).toHaveLength(2);

          // Second element should be the query result promise
          expect(mockQuery).toHaveBeenCalledWith({ where: { id: 1 } });

          // Result should be the second element of the transaction result
          expect(result).toEqual([{ id: 1, tenant_id: 'tenant-1' }]);

          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it('should pass correct key and tenantId to set_config via $executeRaw', async () => {
    const { mockPrisma, mockTransaction, mockExecuteRaw } = buildMockPrisma();
    const handler = getHandler(mockPrisma);

    // Capture the $executeRaw tagged template call within $transaction
    const capturedSetConfigArgs: any[] = [];
    mockExecuteRaw.mockImplementation((...args: any[]) => {
      capturedSetConfigArgs.push(args);
      return Promise.resolve(1);
    });
    mockTransaction.mockImplementation(async (txArray: any[]) => {
      // Evaluate the promises so $executeRaw gets called
      const results = await Promise.all(txArray);
      return results;
    });

    await new Promise<void>((resolve, reject) => {
      context.run('550e8400-e29b-41d4-a716-446655440000', async () => {
        try {
          await handler({
            model: 'TestModel',
            operation: 'findMany',
            args: {},
            query: jest.fn().mockResolvedValue([]),
          });

          // $executeRaw is called as tagged template: $executeRaw`SELECT set_config(${key}, ${id}, TRUE)`
          // Tagged templates pass [strings[], ...values]
          expect(capturedSetConfigArgs.length).toBeGreaterThanOrEqual(1);
          const [strings, ...values] = capturedSetConfigArgs[0];
          expect(strings.join('')).toContain('set_config');
          expect(values).toContain('app.current_tenant');
          expect(values).toContain('550e8400-e29b-41d4-a716-446655440000');

          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('should use custom dbSettingKey', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();

    capturedFactory = null;
    createPrismaTenancyExtension(service, { dbSettingKey: 'custom.tenant' });
    const extensionConfig = capturedFactory!(mockPrisma);
    const handler = extensionConfig.query.$allModels.$allOperations;

    mockTransaction.mockResolvedValue([1, []]);

    await new Promise<void>((resolve, reject) => {
      context.run('550e8400-e29b-41d4-a716-446655440000', async () => {
        try {
          await handler({
            model: 'TestModel',
            operation: 'findMany',
            args: {},
            query: jest.fn().mockReturnValue(Promise.resolve([])),
          });

          // Verify $executeRaw was called via tagged template
          // The first arg to $transaction is the array, and the first element
          // is the $executeRaw call which would contain our custom key
          expect(mockTransaction).toHaveBeenCalled();
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it('should return second element of transaction result', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const handler = getHandler(mockPrisma);

    const expectedData = [{ id: 1 }, { id: 2 }, { id: 3 }];
    mockTransaction.mockResolvedValue([1, expectedData]);

    await new Promise<void>((resolve, reject) => {
      context.run('550e8400-e29b-41d4-a716-446655440000', async () => {
        try {
          const result = await handler({
            model: 'TestModel',
            operation: 'findMany',
            args: {},
            query: jest.fn().mockReturnValue(Promise.resolve(expectedData)),
          });

          expect(result).toEqual(expectedData);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  describe('sharedModels', () => {
    it('should skip set_config for shared models', async () => {
      const { mockPrisma, mockTransaction, mockExecuteRaw } = buildMockPrisma();

      capturedFactory = null;
      createPrismaTenancyExtension(service, { sharedModels: ['Country'] });
      const extensionConfig = capturedFactory!(mockPrisma);
      const handler = extensionConfig.query.$allModels.$allOperations;

      const mockQuery = jest.fn().mockResolvedValue([{ code: 'US' }]);

      await new Promise<void>((resolve, reject) => {
        context.run('tenant-id', async () => {
          try {
            const result = await handler({
              model: 'Country',
              operation: 'findMany',
              args: {},
              query: mockQuery,
            });

            expect(mockQuery).toHaveBeenCalledWith({});
            expect(mockTransaction).not.toHaveBeenCalled();
            expect(mockExecuteRaw).not.toHaveBeenCalled();
            expect(result).toEqual([{ code: 'US' }]);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should still apply set_config for non-shared models', async () => {
      const { mockPrisma, mockTransaction } = buildMockPrisma();

      capturedFactory = null;
      createPrismaTenancyExtension(service, { sharedModels: ['Country'] });
      const extensionConfig = capturedFactory!(mockPrisma);
      const handler = extensionConfig.query.$allModels.$allOperations;

      mockTransaction.mockResolvedValue([1, [{ id: 1 }]]);

      await new Promise<void>((resolve, reject) => {
        context.run('tenant-id', async () => {
          try {
            await handler({
              model: 'Order',
              operation: 'findMany',
              args: {},
              query: jest.fn().mockReturnValue(Promise.resolve([{ id: 1 }])),
            });

            expect(mockTransaction).toHaveBeenCalledTimes(1);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });
  });

  describe('autoInjectTenantId', () => {
    it('should inject tenant_id on create', async () => {
      const { mockPrisma, mockTransaction } = buildMockPrisma();
      mockTransaction.mockResolvedValue([1, { id: 1, tenant_id: 'tenant-id' }]);

      const handler = getHandlerWithAutoInject(mockPrisma);
      const mockQuery = jest.fn().mockReturnValue(
        Promise.resolve({ id: 1, tenant_id: 'tenant-id' }),
      );

      await new Promise<void>((resolve, reject) => {
        context.run('tenant-id', async () => {
          try {
            await handler({
              model: 'Order',
              operation: 'create',
              args: { data: { name: 'Test Order' } },
              query: mockQuery,
            });

            expect(mockQuery).toHaveBeenCalledWith({
              data: { name: 'Test Order', tenant_id: 'tenant-id' },
            });
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should inject tenant_id on createMany (array data)', async () => {
      const { mockPrisma, mockTransaction } = buildMockPrisma();
      mockTransaction.mockResolvedValue([1, { count: 2 }]);

      const handler = getHandlerWithAutoInject(mockPrisma);
      const mockQuery = jest.fn().mockReturnValue(Promise.resolve({ count: 2 }));

      await new Promise<void>((resolve, reject) => {
        context.run('tenant-id', async () => {
          try {
            await handler({
              model: 'Order',
              operation: 'createMany',
              args: { data: [{ name: 'A' }, { name: 'B' }] },
              query: mockQuery,
            });

            expect(mockQuery).toHaveBeenCalledWith({
              data: [
                { name: 'A', tenant_id: 'tenant-id' },
                { name: 'B', tenant_id: 'tenant-id' },
              ],
            });
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should inject tenant_id when createMany data is a single object', async () => {
      const { mockPrisma, mockTransaction } = buildMockPrisma();
      mockTransaction.mockResolvedValue([1, { count: 1 }]);

      const handler = getHandlerWithAutoInject(mockPrisma);
      const mockQuery = jest.fn().mockReturnValue(Promise.resolve({ count: 1 }));

      await new Promise<void>((resolve, reject) => {
        context.run('tenant-id', async () => {
          try {
            await handler({
              model: 'Order',
              operation: 'createMany',
              args: { data: { name: 'A' } }, // single object, not array
              query: mockQuery,
            });

            expect(mockQuery).toHaveBeenCalledWith({ data: { name: 'A', tenant_id: 'tenant-id' } });
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should inject tenant_id on createManyAndReturn', async () => {
      const { mockPrisma, mockTransaction } = buildMockPrisma();
      mockTransaction.mockResolvedValue([1, [{ id: 1 }, { id: 2 }]]);

      const handler = getHandlerWithAutoInject(mockPrisma);
      const mockQuery = jest.fn().mockReturnValue(
        Promise.resolve([{ id: 1 }, { id: 2 }]),
      );

      await new Promise<void>((resolve, reject) => {
        context.run('tenant-id', async () => {
          try {
            await handler({
              model: 'Order',
              operation: 'createManyAndReturn',
              args: { data: [{ name: 'A' }, { name: 'B' }] },
              query: mockQuery,
            });

            expect(mockQuery).toHaveBeenCalledWith({
              data: [
                { name: 'A', tenant_id: 'tenant-id' },
                { name: 'B', tenant_id: 'tenant-id' },
              ],
            });
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should inject into upsert create but not update', async () => {
      const { mockPrisma, mockTransaction } = buildMockPrisma();
      mockTransaction.mockResolvedValue([1, { id: 1 }]);

      const handler = getHandlerWithAutoInject(mockPrisma);
      const mockQuery = jest.fn().mockReturnValue(Promise.resolve({ id: 1 }));

      await new Promise<void>((resolve, reject) => {
        context.run('tenant-id', async () => {
          try {
            await handler({
              model: 'Order',
              operation: 'upsert',
              args: {
                where: { id: 1 },
                create: { name: 'New Order' },
                update: { name: 'Updated Order' },
              },
              query: mockQuery,
            });

            expect(mockQuery).toHaveBeenCalledWith({
              where: { id: 1 },
              create: { name: 'New Order', tenant_id: 'tenant-id' },
              update: { name: 'Updated Order' },
            });
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should NOT inject on update operations', async () => {
      const { mockPrisma, mockTransaction } = buildMockPrisma();
      mockTransaction.mockResolvedValue([1, { id: 1 }]);

      const handler = getHandlerWithAutoInject(mockPrisma);
      const mockQuery = jest.fn().mockReturnValue(Promise.resolve({ id: 1 }));

      await new Promise<void>((resolve, reject) => {
        context.run('tenant-id', async () => {
          try {
            await handler({
              model: 'Order',
              operation: 'update',
              args: { where: { id: 1 }, data: { name: 'Updated' } },
              query: mockQuery,
            });

            expect(mockQuery).toHaveBeenCalledWith({
              where: { id: 1 },
              data: { name: 'Updated' },
            });
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should use custom tenantIdField', async () => {
      const { mockPrisma, mockTransaction } = buildMockPrisma();
      mockTransaction.mockResolvedValue([1, { id: 1 }]);

      const handler = getHandlerWithAutoInject(mockPrisma, { tenantIdField: 'org_id' });
      const mockQuery = jest.fn().mockReturnValue(Promise.resolve({ id: 1 }));

      await new Promise<void>((resolve, reject) => {
        context.run('tenant-id', async () => {
          try {
            await handler({
              model: 'Order',
              operation: 'create',
              args: { data: { name: 'Test' } },
              query: mockQuery,
            });

            expect(mockQuery).toHaveBeenCalledWith({
              data: { name: 'Test', org_id: 'tenant-id' },
            });
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should skip injection for sharedModels', async () => {
      const { mockPrisma, mockTransaction } = buildMockPrisma();
      mockTransaction.mockResolvedValue([1, [{ code: 'US' }]]);

      const handler = getHandlerWithAutoInject(mockPrisma, { sharedModels: ['Country'] });
      const mockQuery = jest.fn().mockReturnValue(Promise.resolve([{ code: 'US' }]));

      await new Promise<void>((resolve, reject) => {
        context.run('tenant-id', async () => {
          try {
            await handler({
              model: 'Country',
              operation: 'create',
              args: { data: { code: 'US' } },
              query: mockQuery,
            });

            // Should pass through without injecting tenant_id
            expect(mockQuery).toHaveBeenCalledWith({ data: { code: 'US' } });
            expect(mockTransaction).not.toHaveBeenCalled();
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should NOT inject when autoInjectTenantId is false (default)', async () => {
      const { mockPrisma, mockTransaction } = buildMockPrisma();
      mockTransaction.mockResolvedValue([1, { id: 1 }]);

      // Use default handler (no autoInjectTenantId)
      const handler = getHandler(mockPrisma);
      const mockQuery = jest.fn().mockReturnValue(Promise.resolve({ id: 1 }));

      await new Promise<void>((resolve, reject) => {
        context.run('tenant-id', async () => {
          try {
            await handler({
              model: 'Order',
              operation: 'create',
              args: { data: { name: 'Test' } },
              query: mockQuery,
            });

            // args should NOT have tenant_id injected
            expect(mockQuery).toHaveBeenCalledWith({ data: { name: 'Test' } });
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });
  });

  describe('failClosed', () => {
    function getHandlerWithFailClosed(
      mockPrisma: any,
      opts?: Partial<PrismaTenancyExtensionOptions>,
    ) {
      capturedFactory = null;
      createPrismaTenancyExtension(service, { failClosed: true, ...opts });
      const extensionConfig = capturedFactory!(mockPrisma);
      return extensionConfig.query.$allModels.$allOperations;
    }

    it('should throw TenancyContextRequiredError when no tenant context', async () => {
      const { mockPrisma } = buildMockPrisma();
      const handler = getHandlerWithFailClosed(mockPrisma);

      await expect(
        handler({
          model: 'Order',
          operation: 'findMany',
          args: {},
          query: jest.fn(),
        }),
      ).rejects.toThrow(TenancyContextRequiredError);
    });

    it('should include model and operation in error', async () => {
      const { mockPrisma } = buildMockPrisma();
      const handler = getHandlerWithFailClosed(mockPrisma);

      try {
        await handler({
          model: 'Order',
          operation: 'findMany',
          args: {},
          query: jest.fn(),
        });
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(TenancyContextRequiredError);
        expect((e as TenancyContextRequiredError).model).toBe('Order');
        expect((e as TenancyContextRequiredError).operation).toBe('findMany');
        expect((e as TenancyContextRequiredError).message).toContain('Order');
      }
    });

    it('should allow queries inside withoutTenant()', async () => {
      const { mockPrisma } = buildMockPrisma();
      const handler = getHandlerWithFailClosed(mockPrisma);
      const mockQuery = jest.fn().mockResolvedValue([{ id: 1 }]);

      const result = await context.runWithoutTenant(async () => {
        return handler({
          model: 'Order',
          operation: 'findMany',
          args: {},
          query: mockQuery,
        });
      });

      expect(mockQuery).toHaveBeenCalledWith({});
      expect(result).toEqual([{ id: 1 }]);
    });

    it('should allow queries for sharedModels', async () => {
      const { mockPrisma } = buildMockPrisma();
      const handler = getHandlerWithFailClosed(mockPrisma, { sharedModels: ['Country'] });
      const mockQuery = jest.fn().mockResolvedValue([{ code: 'US' }]);

      const result = await handler({
        model: 'Country',
        operation: 'findMany',
        args: {},
        query: mockQuery,
      });

      expect(mockQuery).toHaveBeenCalledWith({});
      expect(result).toEqual([{ code: 'US' }]);
    });

    it('should work normally with tenant context', async () => {
      const { mockPrisma, mockTransaction } = buildMockPrisma();
      mockTransaction.mockResolvedValue([1, [{ id: 1 }]]);
      const handler = getHandlerWithFailClosed(mockPrisma);

      await new Promise<void>((resolve, reject) => {
        context.run('tenant-id', async () => {
          try {
            await handler({
              model: 'Order',
              operation: 'findMany',
              args: {},
              query: jest.fn().mockReturnValue(Promise.resolve([{ id: 1 }])),
            });
            expect(mockTransaction).toHaveBeenCalled();
            resolve();
          } catch (e) { reject(e); }
        });
      });
    });

    it('should NOT throw when failClosed is false (default)', async () => {
      const { mockPrisma } = buildMockPrisma();
      const handler = getHandler(mockPrisma);
      const mockQuery = jest.fn().mockResolvedValue([{ id: 1 }]);

      const result = await handler({
        model: 'Order',
        operation: 'findMany',
        args: {},
        query: mockQuery,
      });

      expect(mockQuery).toHaveBeenCalled();
      expect(result).toEqual([{ id: 1 }]);
    });
  });

  describe('interactiveTransactionSupport', () => {
    function buildMockPrismaWithItx() {
      const base = buildMockPrisma();
      const mockItxExecuteRaw = jest.fn().mockResolvedValue(1);
      (base.mockPrisma as any)._createItxClient = jest.fn().mockReturnValue({
        $executeRaw: mockItxExecuteRaw,
      });
      return { ...base, mockItxExecuteRaw };
    }

    function getHandlerWithItx(mockPrisma: any) {
      capturedFactory = null;
      createPrismaTenancyExtension(service, {
        interactiveTransactionSupport: true,
      });
      const extensionConfig = capturedFactory!(mockPrisma);
      return extensionConfig.query.$allModels.$allOperations;
    }

    it('should use itx client when inside interactive transaction', async () => {
      const { mockPrisma, mockTransaction, mockItxExecuteRaw } = buildMockPrismaWithItx();
      const handler = getHandlerWithItx(mockPrisma);

      const mockQuery = jest.fn().mockResolvedValue([{ id: 1 }]);

      await new Promise<void>((resolve, reject) => {
        context.run('tenant-id', async () => {
          try {
            await handler({
              model: 'User',
              operation: 'findMany',
              args: {},
              query: mockQuery,
              __internalParams: {
                transaction: { kind: 'itx', id: 'tx-123' },
              },
            });

            // Should use itx client, NOT batch transaction
            expect((mockPrisma as any)._createItxClient).toHaveBeenCalled();
            expect(mockItxExecuteRaw).toHaveBeenCalled();
            expect(mockTransaction).not.toHaveBeenCalled();
            expect(mockQuery).toHaveBeenCalled();
            resolve();
          } catch (e) { reject(e); }
        });
      });
    });

    it('should fall back to batch transaction when not in itx', async () => {
      const { mockPrisma, mockTransaction } = buildMockPrismaWithItx();
      const handler = getHandlerWithItx(mockPrisma);

      mockTransaction.mockResolvedValue([1, [{ id: 1 }]]);
      const mockQuery = jest.fn().mockReturnValue(Promise.resolve([{ id: 1 }]));

      await new Promise<void>((resolve, reject) => {
        context.run('tenant-id', async () => {
          try {
            await handler({
              model: 'User',
              operation: 'findMany',
              args: {},
              query: mockQuery,
            });

            expect(mockTransaction).toHaveBeenCalled();
            resolve();
          } catch (e) { reject(e); }
        });
      });
    });

    it('should throw at creation time if _createItxClient is not available', () => {
      const { mockPrisma } = buildMockPrisma();
      // mockPrisma does NOT have _createItxClient

      capturedFactory = null;
      createPrismaTenancyExtension(service, {
        interactiveTransactionSupport: true,
      });

      expect(() => capturedFactory!(mockPrisma)).toThrow(
        '_createItxClient',
      );
    });

    it('should not enable itx support by default', async () => {
      const { mockPrisma, mockTransaction } = buildMockPrismaWithItx();
      const handler = getHandler(mockPrisma);

      mockTransaction.mockResolvedValue([1, [{ id: 1 }]]);
      const mockQuery = jest.fn().mockReturnValue(Promise.resolve([{ id: 1 }]));

      await new Promise<void>((resolve, reject) => {
        context.run('tenant-id', async () => {
          try {
            await handler({
              model: 'User',
              operation: 'findMany',
              args: {},
              query: mockQuery,
              __internalParams: {
                transaction: { kind: 'itx', id: 'tx-123' },
              },
            });

            // Without itx flag, should still use batch transaction
            expect(mockTransaction).toHaveBeenCalled();
            expect((mockPrisma as any)._createItxClient).not.toHaveBeenCalled();
            resolve();
          } catch (e) { reject(e); }
        });
      });
    });

    it('should accept deprecated experimentalTransactionSupport flag', () => {
      const { mockPrisma } = buildMockPrismaWithItx();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      capturedFactory = null;
      createPrismaTenancyExtension(service, {
        experimentalTransactionSupport: true,
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('deprecated'),
      );

      // Should still work (itx supported since mockPrisma has _createItxClient)
      expect(() => capturedFactory!(mockPrisma)).not.toThrow();

      warnSpy.mockRestore();
    });

    it('should NOT throw for deprecated flag when _createItxClient is missing (fallback)', async () => {
      const { mockPrisma, mockTransaction } = buildMockPrisma();
      // mockPrisma does NOT have _createItxClient — deprecated flag should fallback
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      capturedFactory = null;
      createPrismaTenancyExtension(service, {
        experimentalTransactionSupport: true,
      });

      // Should NOT throw at creation time
      expect(() => capturedFactory!(mockPrisma)).not.toThrow();

      // At runtime with itx, should warn and fallback to batch
      const extensionConfig = capturedFactory!(mockPrisma);
      const handler = extensionConfig.query.$allModels.$allOperations;
      mockTransaction.mockResolvedValue([1, [{ id: 1 }]]);

      await new Promise<void>((resolve, reject) => {
        context.run('tenant-id', async () => {
          try {
            await handler({
              model: 'User',
              operation: 'findMany',
              args: {},
              query: jest.fn().mockReturnValue(Promise.resolve([{ id: 1 }])),
              __internalParams: {
                transaction: { kind: 'itx', id: 'tx-123' },
              },
            });

            // Should fallback to batch transaction
            expect(mockTransaction).toHaveBeenCalled();
            // Should have warned about fallback
            expect(warnSpy).toHaveBeenCalledWith(
              expect.stringContaining('Falling back to batch'),
            );
            resolve();
          } catch (e) { reject(e); }
        });
      });

      warnSpy.mockRestore();
    });

    it('should prefer interactiveTransactionSupport over deprecated flag', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      // interactiveTransactionSupport: false takes precedence — no itx validation
      // mockPrisma without _createItxClient would NOT throw
      const { mockPrisma: prismaNoItx } = buildMockPrisma();
      capturedFactory = null;
      createPrismaTenancyExtension(service, {
        interactiveTransactionSupport: false,
        experimentalTransactionSupport: true,
      });
      expect(() => capturedFactory!(prismaNoItx)).not.toThrow();

      warnSpy.mockRestore();
    });
  });
});
