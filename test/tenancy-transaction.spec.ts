import { TenancyContext } from '../src/services/tenancy-context';
import { TenancyService } from '../src/services/tenancy.service';
import { tenancyTransaction } from '../src/prisma/tenancy-transaction';

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
});
