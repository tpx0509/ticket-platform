import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * PrismaModule 是 @Global 的，PrismaService 直接可注入，这里不用 imports。
 *
 * JwtModule 必须用 registerAsync：密钥来自 ConfigService，而 ConfigService
 * 要等容器创建时才存在，模块加载那一刻还拿不到 process.env 校验后的值。
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_ACCESS_SECRET'),
        signOptions: {
          // JWT_ACCESS_TTL 是秒数。数字单位就是秒，字符串才会被当成 ms 语法
          expiresIn: config.get('JWT_ACCESS_TTL'),
          algorithm: 'HS256',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  // 其他模块（TicketsModule 等）挂 Guard 时要用到 JwtService，必须导出
  exports: [JwtModule, AuthService],
})
export class AuthModule {}
