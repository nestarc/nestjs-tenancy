import { withTenant } from './with-tenant';

export interface IsolationTestOptions {
  /** The field name that holds the tenant ID. @default 'tenant_id' */
  tenantIdField?: string;
}

/**
 * Asserts that a Prisma model enforces tenant isolation between two tenants.
 *
 * Executes `findMany()` concurrently as both tenants and verifies that
 * no rows from tenant A appear in tenant B's results, and vice versa.
 *
 * Usage in E2E tests:
 * ```typescript
 * await expectTenantIsolation(prisma.user, 'tenant-a-uuid', 'tenant-b-uuid');
 * ```
 *
 * @param prismaModel - A Prisma model delegate with a `findMany` method
 * @param tenantA - First tenant ID
 * @param tenantB - Second tenant ID
 * @param options - Optional configuration
 * @throws Error if tenant isolation is violated
 */
export async function expectTenantIsolation(
  prismaModel: { findMany: (args?: any) => Promise<any[]> },
  tenantA: string,
  tenantB: string,
  options?: IsolationTestOptions,
): Promise<void> {
  const field = options?.tenantIdField ?? 'tenant_id';

  const [rowsA, rowsB] = await Promise.all([
    withTenant(tenantA, () => prismaModel.findMany()),
    withTenant(tenantB, () => prismaModel.findMany()),
  ]);

  const leakAtoB = rowsA.filter((r: any) => r[field] === tenantB);
  const leakBtoA = rowsB.filter((r: any) => r[field] === tenantA);

  if (leakAtoB.length > 0) {
    throw new Error(
      `Tenant isolation violation: tenant ${tenantA} query returned ` +
      `${leakAtoB.length} row(s) belonging to tenant ${tenantB}`,
    );
  }
  if (leakBtoA.length > 0) {
    throw new Error(
      `Tenant isolation violation: tenant ${tenantB} query returned ` +
      `${leakBtoA.length} row(s) belonging to tenant ${tenantA}`,
    );
  }
}
