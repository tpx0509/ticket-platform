import { Module } from '@nestjs/common';

import { AuthModule } from 'src/auth/auth.module';
import { OrgsController } from './orgs.controller';
import { OrgsRepository } from './orgs.repository';
import { OrgsService } from './orgs.service';

@Module({
    // JwtAuthGuard 需要 JwtService，它由 AuthModule 导出
    imports: [AuthModule],
    controllers: [OrgsController],
    providers: [OrgsService, OrgsRepository],
})
export class OrgsModule {}
