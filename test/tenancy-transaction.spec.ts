import { TenancyContext } from '../src/services/tenancy-context';
import { TenancyService } from '../src/services/tenancy.service';
import {
  tenancyTransaction,
  PrismaTransactionClient,
  PrismaTransactionContext,
} from '../src/prisma/tenancy-transaction';

describe('tenancyTransaction', () => {
  let context: TenancyContext;
  let service: TenancyService;

  beforeEach(() => {
    context = new TenancyContext();
    service = new TenancyService(context);
  });

  function buildMockPrisma() {
    const mockTransaction = jest.fn();
    return { mockPrisma: { $transaction: mockTransaction }, mockTransaction };
  }

  it('should call $transaction with set_config and callback', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();

    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = { $executeRaw: jest.fn().mockResolvedValue(1) };
      return cb(mockTx);
    });

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-123', async () => {
        try {
          const result = await tenancyTransaction(
            mockPrisma, service, async () => 'callback-result',
          );
          expect(result).toBe('callback-result');
          expect(mockTransaction).toHaveBeenCalledTimes(1);
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('should throw when no tenant context', async () => {
    const { mockPrisma } = buildMockPrisma();
    await expect(
      tenancyTransaction(mockPrisma, service, async () => 'result'),
    ).rejects.toThrow('No tenant context available');
  });

  it('should pass transaction options', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();

    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = { $executeRaw: jest.fn().mockResolvedValue(1) };
      return cb(mockTx);
    });

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-123', async () => {
        try {
          await tenancyTransaction(
            mockPrisma, service, async () => 'ok', { timeout: 5000 },
          );
          expect(mockTransaction).toHaveBeenCalledWith(
            expect.any(Function),
            { timeout: 5000 },
          );
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('should use custom dbSettingKey', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();

    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = { $executeRaw: jest.fn().mockResolvedValue(1) };
      const result = await cb(mockTx);
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
      return result;
    });

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-123', async () => {
        try {
          await tenancyTransaction(
            mockPrisma, service, async () => 'ok',
            { dbSettingKey: 'custom.tenant' },
          );
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('should pass isolationLevel option to $transaction', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();

    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = { $executeRaw: jest.fn().mockResolvedValue(1) };
      return cb(mockTx);
    });

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-123', async () => {
        try {
          await tenancyTransaction(
            mockPrisma, service, async () => 'ok',
            { isolationLevel: 'Serializable' },
          );
          expect(mockTransaction).toHaveBeenCalledWith(
            expect.any(Function),
            { isolationLevel: 'Serializable' },
          );
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('should pass both timeout and isolationLevel options', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();

    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = { $executeRaw: jest.fn().mockResolvedValue(1) };
      return cb(mockTx);
    });

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-123', async () => {
        try {
          await tenancyTransaction(
            mockPrisma, service, async () => 'ok',
            { timeout: 10000, isolationLevel: 'ReadCommitted' },
          );
          expect(mockTransaction).toHaveBeenCalledWith(
            expect.any(Function),
            { timeout: 10000, isolationLevel: 'ReadCommitted' },
          );
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('should propagate callback errors', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();

    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = { $executeRaw: jest.fn().mockResolvedValue(1) };
      return cb(mockTx);
    });

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-123', async () => {
        try {
          await expect(
            tenancyTransaction(mockPrisma, service, async () => {
              throw new Error('callback failed');
            }),
          ).rejects.toThrow('callback failed');
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('should preserve generic transaction client type in callback', async () => {
    interface MockTx extends PrismaTransactionContext {
      user: {
        findMany(): Promise<string[]>;
      };
    }

    const mockTx: MockTx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      user: {
        findMany: jest.fn().mockResolvedValue(['user-a']),
      },
    };
    const mockPrisma: PrismaTransactionClient<MockTx> = {
      $transaction: async (cb) => cb(mockTx),
    };

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-123', async () => {
        try {
          const result = await tenancyTransaction(
            mockPrisma,
            service,
            async (tx) => tx.user.findMany(),
          );

          expect(result).toEqual(['user-a']);
          expect(mockTx.user.findMany).toHaveBeenCalled();
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });
});
