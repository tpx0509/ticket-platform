/**
 * 全局接口前缀，唯一来源。
 *
 * 为什么单独抽一个文件：
 *   「挂载前缀」的地方在 app.setup，判断前缀的地方在异常过滤器和响应拦截器。
 *   如果三处各写一遍字符串，改前缀时只要漏掉一处，症状是探针突然开始套统一响应信封、
 *   或者异常被包装成 500 之外的形状 —— 这类问题不会报错，只会让监控悄悄失效。
 *
 * 不带前导斜杠，因为 setGlobalPrefix 接受的形式就是 `api/v1`，
 * 需要拼路径时由调用方补 `/`。
 */
export const API_PREFIX = 'api/v1';

/** 探针的完整前缀，`/api/v1/health`。过滤器用它匹配 `live` / `ready` 两个接口。 */
export const HEALTH_PATH_PREFIX = `/${API_PREFIX}/health`;
