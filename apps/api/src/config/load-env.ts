import fs from 'node:fs';
import path from 'node:path';

import { config as loadDotenv } from 'dotenv';

/**
 * 应用与 Prisma CLI 必须读同一份配置。
 * 依次尝试：当前工作目录（apps/api）、仓库根目录、打包后的上层目录。
 * 已存在的环境变量不会被覆盖，容器和 CI 里注入的值优先。
 */
const CANDIDATES = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(__dirname, '../../../../.env'),
];

export function loadEnv(): void {
  for (const file of CANDIDATES) {
    if (fs.existsSync(file)) {
      loadDotenv({ path: file, quiet: true });
      return;
    }
  }
}
