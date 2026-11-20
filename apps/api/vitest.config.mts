import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * 用 .mts 而不是 .ts：这个包是 CommonJS（Nest 编译目标），
 * .ts 配置文件会被当成 CJS 加载，里面写 import 会触发 Vite 的 ESM 警告，
 * 以后 Vite 换成原生 loader 就直接报错了。
 *
 * 代价是 .mts 里没有 __dirname，得自己从 import.meta.url 算。
 */
const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 两类测试共用一个配置：
 *   *.spec.ts      service 单测，不碰数据库，毫秒级
 *   *.e2e-spec.ts  接口测试，起完整应用，连 ticket_test 库
 *
 * alias 是必须的：源码里用的是 `src/common/...` 这种绝对路径，
 * tsc 靠 tsconfig 的 baseUrl 解析，vitest 不认识 tsconfig，得单独告诉它一遍。
 */
export default defineConfig({
  resolve: {
    alias: {
      src: path.resolve(dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.e2e-spec.ts'],
    // 切库、切 Redis 库、压日志都在这里做，必须早于测试文件 import AppModule
    setupFiles: ['src/test/setup.ts'],
    // 接口测试要起容器、连库、登录，默认 5 秒不够
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // 测试文件串行：多个文件同时连测试库会互相踩数据
    fileParallelism: false,
  },
});
