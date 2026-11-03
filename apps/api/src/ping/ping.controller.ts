import { Controller, Get } from '@nestjs/common';



@Controller('ping')
export class PingController {

  /** 存活探针：只证明进程还在跑，不碰任何外部依赖。 */
  @Get()
  live(): { ping: true } {
    return { 
      ping:true
    };
  }
}
