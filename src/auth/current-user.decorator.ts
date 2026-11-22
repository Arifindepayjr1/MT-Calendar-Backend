import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { AuthUserDto } from './auth.models';

export const CurrentUser = createParamDecorator(
  (field: keyof AuthUserDto | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUserDto | undefined;
    return field && user ? user[field] : user;
  },
);
