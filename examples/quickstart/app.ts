import 'reflect-metadata';
import {
  BadRequestException, Body, Controller, Get, Injectable, Module,
  Post, type OnModuleDestroy,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  createPrismaTenancyExtension, TenancyModule, TenancyService,
} from '@nestarc/tenancy';
import { PrismaClient } from './generated/client';
import { AuthorizedTenantExtractor, demoAuthentication } from './auth';
import { APP_DATABASE_URL } from './database';

@Injectable()
export class ProjectsService implements OnModuleDestroy {
  private readonly base: PrismaClient;
  private readonly scoped;

  constructor(private readonly tenancy: TenancyService) {
    this.base = new PrismaClient({
      adapter: new PrismaPg({ connectionString: APP_DATABASE_URL }),
    });
    this.scoped = this.base.$extends(createPrismaTenancyExtension(tenancy));
  }

  async list() {
    // No tenant WHERE clause: the database policy filters this query.
    return this.scoped.project.findMany({ orderBy: { name: 'asc' } });
  }

  create(name: string) {
    // Provide the required Prisma field explicitly from the trusted context.
    return this.scoped.project.create({
      data: { name, tenant_id: this.tenancy.getCurrentTenantOrThrow() },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.base.$disconnect();
  }
}

@Controller('projects')
class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list() {
    return this.projects.list();
  }

  @Post()
  create(@Body() body: unknown) {
    if (typeof body !== 'object' || body === null || !('name' in body)
      || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200) {
      throw new BadRequestException('name must be a nonempty string of at most 200 characters');
    }
    return this.projects.create(body.name.trim());
  }
}

@Module({
  imports: [TenancyModule.forRoot({ tenantExtractor: new AuthorizedTenantExtractor() })],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class AppModule {}

export async function createApp() {
  const app = await NestFactory.create(AppModule, { logger: false });
  // Application middleware is registered before Nest installs module middleware.
  // Module import order does not establish authentication order.
  app.use(demoAuthentication);
  await app.init();
  return app;
}
