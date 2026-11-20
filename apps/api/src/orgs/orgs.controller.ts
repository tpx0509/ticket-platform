import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from 'src/common/current-user.decorator';
import { JwtAuthGuard } from 'src/common/jwt-auth.guard';
import { OrgsService } from './orgs.service';

/**
 * 组织列表。
 *
 * 只有 JwtAuthGuard，没有 OrgMemberGuard —— 这个接口的路径里没有 :orgId，
 * 而且它要回答的正是「我有哪些 orgId」，再挂组织校验就成了鸡生蛋。
 * 但「只能看到自己的组织」这件事不能靠不挂 Guard 来保证，
 * 而是靠 RLS 的 user 分支：SQL 层面就已经把别人的行过滤掉了。
 */
@ApiTags('orgs')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('orgs')
export class OrgsController {
    constructor(private readonly service: OrgsService) {}

    @Get()
    @ApiOperation({
        summary: '我加入的组织',
        description: '只返回状态为 active 的成员关系，附带当前角色；按组织名排序',
    })
    @ApiResponse({ status: 200, description: '组织数组，可能为空' })
    @ApiResponse({ status: 401, description: '未登录' })
    mine(@CurrentUserId() userId: string) {
        return this.service.mine(userId);
    }
}
