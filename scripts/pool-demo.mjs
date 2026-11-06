import pg from 'pg';

const conn = { connectionString: process.env.DATABASE_URL };

// 实验 1：max 到底卡的是什么
// 发 10 个并发查询，每个查询在库里睡 100ms（模拟一条慢 SQL），
// 看连接池只给 max 个连接时，总耗时会被拉长成什么样。
async function testMax(max) {
  const pool = new pg.Pool({ ...conn, max });
  const t0 = performance.now();

  await Promise.all(
    Array.from({ length: 10 }, () => pool.query('select pg_sleep(0.1)'))
  );

  const ms = performance.now() - t0;
  console.log(
    `max=${String(max).padStart(2)}   10 个并发   总耗时 ${ms.toFixed(0).padStart(5)} ms` +
    `   池状态 total=${pool.totalCount} idle=${pool.idleCount}`
  );

  await pool.end();
}

try {
  console.log('10 个并发，每个查询在库里睡 100ms\n');
  for (const max of [1, 2, 5, 10, 20]) {
    await testMax(max);
  }
} catch (err) {
  console.error(`[${err.code ?? 'ERR'}] ${err.message}`);
  process.exitCode = 1;
}
