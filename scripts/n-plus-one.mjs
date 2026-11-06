import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// ── 查询计数器 ────────────────────────────────────────────
// 所有查询都走 q()，这样才能数清楚一次请求到底发了几条 SQL。
let sqlCount = 0;

async function q(text, params) {
  sqlCount++;
  return pool.query(text, params);
}

// 跑一个函数，打印 SQL 条数 + 耗时
async function bench(name, fn) {
  sqlCount = 0;
  const t0 = performance.now();
  const rows = await fn();
  const ms = performance.now() - t0;
  const sum = rows.reduce((a, r) => a + r.comment_count, 0);
  console.log(
    `${name.padEnd(12)} SQL ${String(sqlCount).padStart(3)} 条   ` +
    `${ms.toFixed(1).padStart(7)} ms   返回 ${rows.length} 行   评论合计 ${sum}`
  );
  return rows;
}

// ── 写法 1：N+1 ──────────────────────────────────────────
// 先查 20 张工单，再对每张工单单独查一次评论数。1 + 20 = 21 条。
async function withNPlusOne() {
  const { rows: list } = await q(
    `select id, subject from tickets
     where deleted_at is null
     order by created_at desc, id
     limit 20`
  );

  const out = [];
  for (const t of list) {
    const { rows } = await q(
      `select count(*)::int as cnt from ticket_comments where ticket_id = $1`,
      [t.id]
    );
    // ::int 不能省：count() 返回 bigint，pg 会把它转成字符串 '5'，
    // 直接相加会变成 '5' + '3' = '53'
    out.push({ id: t.id, subject: t.subject, comment_count: rows[0].cnt });
  }
  return out;
}

// ── 写法 2：批量 in（any 数组）─────────────────────────────
// 2 条 SQL：先查工单，再一次把 20 个 id 丢进去分组统计。
async function withBatchIn() {
  const { rows: list } = await q(
    `select id, subject from tickets
     where deleted_at is null
     order by created_at desc, id
     limit 20`
  );

  const ids = list.map((t) => t.id);
  const { rows: counts } = await q(
    `select ticket_id, count(*)::int as cnt
     from ticket_comments
     where ticket_id = any($1::uuid[])
     group by ticket_id`,
    [ids]
  );

  // 只有评论过的工单才会出现在结果里，没评论的要用 ?? 0 兜住
  const map = new Map(counts.map((r) => [r.ticket_id, r.cnt]));
  return list.map((t) => ({
    id: t.id,
    subject: t.subject,
    comment_count: map.get(t.id) ?? 0,
  }));
}

// ── 写法 3：JOIN + group by ──────────────────────────────
// 1 条 SQL。注意 order by / limit 是作用在分组结果上的。
async function withJoin() {
  const { rows } = await q(
    `select t.id, t.subject, count(c.id)::int as comment_count
     from tickets t
     left join ticket_comments c on c.ticket_id = t.id
     where t.deleted_at is null
     group by t.id, t.subject, t.created_at
     order by t.created_at desc, t.id
     limit 20`
  );
  return rows;
}

// ── 写法 4：标量子查询 ────────────────────────────────────
// 1 条 SQL。子查询写在 select 列表里，limit 只作用在外层 20 行。
async function withScalarSubquery() {
  const { rows } = await q(
    `select t.id, t.subject,
            (select count(*)::int
             from ticket_comments c
             where c.ticket_id = t.id) as comment_count
     from tickets t
     where t.deleted_at is null
     order by t.created_at desc, t.id
     limit 20`
  );
  return rows;
}

// ── 跑起来 ────────────────────────────────────────────────
try {
  console.log('工单列表页：20 张工单 + 每张的评论数\n');

  // 先空跑一次预热（第一次会有 TCP 握手、语句解析的额外开销）
  await withBatchIn();

  const a = await bench('N+1', withNPlusOne);
  const b = await bench('批量 in', withBatchIn);
  const c = await bench('JOIN', withJoin);
  const d = await bench('标量子查询', withScalarSubquery);

  // 四种写法结果必须一致，否则说明哪个写错了
  const same =
    a.map((r) => r.id).join() === b.map((r) => r.id).join() &&
    b.map((r) => r.id).join() === c.map((r) => r.id).join() &&
    c.map((r) => r.id).join() === d.map((r) => r.id).join();
  const sums = [a, b, c, d].map((rows) =>
    rows.reduce((x, r) => x + r.comment_count, 0)
  );
  console.log(`\n结果一致：${same}    评论合计：${sums.join(' / ')}`);
} catch (err) {
  console.error(`[${err.code ?? 'ERR'}] ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
