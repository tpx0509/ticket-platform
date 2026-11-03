import { Injectable } from '@nestjs/common';

import { type AppConfig, envSchema } from './env.schema';
import { loadEnv } from './load-env';

@Injectable()
export class ConfigService {
  private readonly values: AppConfig;

  constructor() {
    // 先加载 .env 再校验；已经存在的环境变量优先，容器注入的值不会被覆盖
    loadEnv();
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const lines = parsed.error.issues.map(
        (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
      );
      throw new Error(`环境变量校验失败，进程拒绝启动：\n${lines.join('\n')}`);
    }
    this.values = parsed.data;
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.values[key];
  }

  get isProduction(): boolean {
    return this.values.NODE_ENV === 'production';
  }
}
