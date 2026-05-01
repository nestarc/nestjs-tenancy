import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenancyContext } from '../services/tenancy-context';

export const CurrentTenant = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): string | null => {
    return TenancyContext.getCurrentTenantId();
  },
);
