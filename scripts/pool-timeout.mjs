import pg from 'pg';

const conn = { connectionString: process.env.DATABASE_URL };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 实验 3：connectionTimeoutMillis —— 排队等连接，最多等多久
// max=1，5 个并发各要 500ms。第 1 个占住连接 500ms，后面 4 个只能排队。
async function testConnectTimeout(timeoutMs) {
  const pool = new pg.Pool({ ...conn, max: 1, connectionTimeoutMillis: timeoutMs });
  console.log(`\nmax=1, connectionTimeoutMillis=${timeoutMs}, 5 个并发各睡 500ms`);

  const t0 = performance.now();
  const results = await Promise.all(
    Array.from({ length: 5 }, async (_, i) => {
      try {
        await pool.query('select pg_sleep(0.5)');
        return { i, ok: true, ms: performance.now() - t0 };
      } catch (e) {
        return { i, ok: false, ms: performance.now() - t0, code: e.code, msg: e.message };
      }
    })
  );

  for (const r of results) {
    const tag = r.ok ? '成功' : `失败 [${r.code ?? '-'}] ${r.msg}`;
    console.log(`  #${r.i}  ${r.ms.toFixed(0).padStart(5)} ms  ${tag}`);
  }
  await pool.end();
}

// 实验 4：idleTimeoutMillis —— 空闲连接多久被回收
async function testIdleTimeout(idleMs) {
  const pool = new pg.Pool({ ...conn, max: 5, idleTimeoutMillis: idleMs });
  console.log(`\nidleTimeoutMillis=${idleMs}`);

  await Promise.all([1, 2, 3].map(() => pool.query('select 1')));
  console.log(`  刚跑完 3 个查询      total=${pool.totalCount} idle=${pool.idleCount}`);

  await sleep(idleMs + 400);
  console.log(`  再等 ${idleMs + 400} ms        total=${pool.totalCount} idle=${pool.idleCount}`);

  await pool.end();
}

try {
  await testConnectTimeout(300);
  await testIdleTimeout(500);
} catch (err) {
  console.error(`[${err.code ?? 'ERR'}] ${err.message}`);
  process.exitCode = 1;
}
