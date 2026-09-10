import { defineConfig } from 'prisma/config';
import { ADMIN_DATABASE_URL } from './database';

export default defineConfig({
  schema: 'schema.prisma',
  datasource: { url: ADMIN_DATABASE_URL },
});
