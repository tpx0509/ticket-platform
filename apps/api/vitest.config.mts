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
 * 只测 src 下的 *.spec.ts。
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
    include: ['src/**/*.spec.ts'],
    // 一个用例卡住不该拖死整轮，超时就失败
    testTimeout: 10_000,
  },
});
