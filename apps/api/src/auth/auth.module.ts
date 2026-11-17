import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * PrismaModule 是 @Global 的，PrismaService 直接可注入，这里不用 imports。
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
