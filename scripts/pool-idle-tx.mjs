import pg from 'pg';

const conn = { connectionString: process.env.DATABASE_URL };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pool = new pg.Pool({ ...conn, max: 1 });

try {
  const client = await pool.connect();

  // 连接被服务端掐断时，错误是从这里冒出来的，不是你 await 的那个 query。
  // 不接这个事件，Node 会直接因为 unhandled 'error' 崩掉。
  client.on('error', (err) => {
    console.log(`  [error 事件] [${err.code}] ${err.message}`);
  });

  // 只在这个连接上生效，事务里空闲 2 秒就踢
  await client.query(`set idle_in_transaction_session_timeout = '2s'`);

  await client.query('begin');
  await client.query(`update accounts_demo set balance = balance where id = 1`);
  console.log('事务开着，什么都不干，等 3 秒...');

  await sleep(3000);

  try {
    await client.query('select 1');
    console.log('  居然还能查');
  } catch (err) {
    console.log(`  下次再查 → [${err.code ?? '-'}] ${err.message}`);
  }

  // 连接已经废了，要标记销毁，不能干净地还回去
  client.release(true);
} catch (err) {
  console.error(`[${err.code ?? 'ERR'}] ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
