import { parseModels } from '../../src/cli/prisma-schema-parser';

describe('parseModels', () => {
  it('should extract model names', () => {
    const schema = `
model User {
  id    Int    @id @default(autoincrement())
  name  String
}

model Order {
  id    Int    @id @default(autoincrement())
}
`;
    const models = parseModels(schema);
    expect(models).toEqual([
      { modelName: 'User', tableName: 'User' },
      { modelName: 'Order', tableName: 'Order' },
    ]);
  });

  it('should handle @@map for custom table names', () => {
    const schema = `
model User {
  id    Int    @id

  @@map("users")
}

model OrderItem {
  id    Int    @id

  @@map("order_items")
}
`;
    const models = parseModels(schema);
    expect(models).toEqual([
      { modelName: 'User', tableName: 'users' },
      { modelName: 'OrderItem', tableName: 'order_items' },
    ]);
  });

  it('should ignore enums and types', () => {
    const schema = `
enum Role {
  ADMIN
  USER
}

type Address {
  street String
  city   String
}

model User {
  id   Int  @id
  role Role
}
`;
    const models = parseModels(schema);
    expect(models).toEqual([
      { modelName: 'User', tableName: 'User' },
    ]);
  });

  it('should parse @@schema directive', () => {
    const schema = `
model Tenant {
  id    Int    @id

  @@schema("auth")
  @@map("tenants")
}
`;
    const models = parseModels(schema);
    expect(models).toEqual([
      { modelName: 'Tenant', tableName: 'tenants', schemaName: 'auth' },
    ]);
  });

  it('should return undefined schemaName when @@schema is absent', () => {
    const schema = `
model User {
  id    Int    @id
}
`;
    const models = parseModels(schema);
    expect(models[0].schemaName).toBeUndefined();
  });

  it('should return empty array for empty schema', () => {
    expect(parseModels('')).toEqual([]);
  });
});
