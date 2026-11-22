import { Injectable, type LoggerService, type OnModuleDestroy } from '@nestjs/common';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';

import { requestContext } from '../common/request-context';

type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * 单行 JSON 输出。字段固定，便于日志系统按字段建索引与告警。
 * 不打印请求体与任何凭证 —— 日志一旦写了密钥，等于泄露。
 *
 * 输出双写：stdout + 可选文件（LOG_FILE）。
 *
 * 为什么还要写文件：
 *   stdout 那份被 Docker 收走，落在 /var/lib/docker/containers/<id>/*-json.log。
 *   那个文件被 Docker 持有句柄，没法用 logrotate 按天切 —— copytruncate 会把
 *   正在写的 JSON 行截断成坏行，create 模式又会让 Docker 继续往改名后的旧文件写。
 *   所以要做按天归档，得先让应用自己落一份到挂载出来的普通目录上。
 *
 * 为什么仍然保留 stdout：
 *   docker compose logs / -f 这些习惯不能坏，容器视角的日志也还得有。
 *
 * 一条硬约束：文件打不开（权限、目录不存在、磁盘满）只能降级，不能抛。
 * 日志是观测手段，不该成为服务起不来的原因。
 */
@Injectable()
export class JsonLogger implements LoggerService, OnModuleDestroy {
  private file?: WriteStream;
  /** 已经失败过就不再重试，避免每条日志都去碰一次磁盘 */
  private fileDisabled = false;

  private openFile(): WriteStream | undefined {
    if (this.file) return this.file;
    if (this.fileDisabled) return undefined;

    const path = process.env.LOG_FILE;
    if (!path) {
      // 本地开发、CI、一次性脚本不配 LOG_FILE，纯 stdout 就够，不必提示
      this.fileDisabled = true;
      return undefined;
    }

    try {
      mkdirSync(dirname(path), { recursive: true });
      // flags 'a' = O_APPEND：每次写都落到文件末尾。
      // 这是 logrotate 用 copytruncate 能安全工作的前提 —— 文件被截断成 0 之后，
      // 下一次写仍然从末尾（也就是 0）开始，不会在开头留一段空洞。
      const stream = createWriteStream(path, { flags: 'a', mode: 0o640 });
      // 打开失败是异步事件，不会同步 throw。不监听就是 unhandled 'error'，
      // 直接把进程带崩 —— 那正是这里最不能发生的事。
      stream.on('error', (err) => {
        this.fileDisabled = true;
        this.file = undefined;
        process.stderr.write(
          `${JSON.stringify({
            time: new Date().toISOString(),
            level: 'warn',
            msg: '日志文件不可写，降级为仅 stdout',
            path,
            error: err.message,
          })}\n`,
        );
      });
      this.file = stream;
      return stream;
    } catch (err) {
      this.fileDisabled = true;
      process.stderr.write(
        `${JSON.stringify({
          time: new Date().toISOString(),
          level: 'warn',
          msg: '日志目录创建失败，降级为仅 stdout',
          path,
          error: err instanceof Error ? err.message : String(err),
        })}\n`,
      );
      return undefined;
    }
  }

  private write(level: Level, message: unknown, context?: string, extra?: Record<string, unknown>) {
    const store = requestContext.getStore();
    const line: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      msg: typeof message === 'string' ? message : JSON.stringify(message),
    };
    if (context) line.context = context;
    if (store?.requestId) line.requestId = store.requestId;
    if (store?.orgId) line.orgId = store.orgId;
    if (store?.userId) line.userId = store.userId;
    if (extra) Object.assign(line, extra);

    const text = `${JSON.stringify(line)}\n`;
    process.stdout.write(text);
    this.openFile()?.write(text);
  }

  /**
   * 关容器时把缓冲刷出去。
   * 不 flush 的话最后几行会留在内存里 —— 而那些往往正是「收到 SIGTERM，正在关闭」
   * 这类最需要留下的信息。
   */
  onModuleDestroy(): void {
    this.file?.end();
    this.file = undefined;
    // 关闭之后不再重开：否则最后几条日志会新建一个流，而那个流没人 end，
    // 内容留在缓冲区里随进程一起消失。
    this.fileDisabled = true;
  }

  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.write('error', message, context, stack ? { stack } : undefined);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('trace', message, context);
  }

  fatal(message: unknown, context?: string): void {
    this.write('fatal', message, context);
  }
}
