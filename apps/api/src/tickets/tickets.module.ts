import { Module } from "@nestjs/common";
import { AuthModule } from "src/auth/auth.module";
import { TicketsController } from "./tickets.controller";
import { TicketsRepository } from './tickets.repository';
import { TicketsService } from "./tickets.service";
@Module({
    // JwtAuthGuard 的构造函数要 JwtService，而它由 AuthModule 导出（AuthModule 里 re-export 了 JwtModule）。
    // 少了这行，启动会报 can't resolve dependencies of the JwtAuthGuard。
    imports: [AuthModule],
    controllers : [TicketsController],
    providers : [TicketsService,TicketsRepository]
})
export class TicketsModule {}