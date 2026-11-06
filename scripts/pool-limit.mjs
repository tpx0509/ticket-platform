import pg from 'pg';

// 实验 2：连接不是无限的
// PG 侧 max_connections=100，容器里就这么多名额，谁来都一样。
// 这里一个一个硬连，看第几个连不上、报什么错。
const clients = [];
let i = 0;

try {
  for (i = 0; i < 110; i++) {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    c.on('error', () => {});
    await c.connect();
    clients.push(c);
  }
  console.log(`居然开到 ${clients.length} 个`);
} catch (err) {
  console.log(`开到第 ${i + 1} 个失败 → [${err.code}] ${err.message}`);
  console.log(`已经成功占住 ${clients.length} 个连接`);
} finally {
  await Promise.all(clients.map((c) => c.end().catch(() => {})));
  console.log('全部释放');
}
