import pg from 'pg';

// 建立连接池
const pool = new pg.Pool({ connectionString : process.env.DATABASE_URL })

try {
    
    const { rows } = await pool.query(`select count(*) from pg_stat_activity where datname='ticket_dev'`);

    console.log('rows',rows)

    const affairs = await pool.connect()

    try{
        await affairs.query('begin')
        let { rows } = await affairs.query(`select balance from accounts_demo where id =1`)
        console.log('res',rows)
        await affairs.query(`update accounts_demo set balance = 500 where id = 1`)
        const tickedId = '5ff664e4-c8d0-48df-a5a2-1a11002e6d40'
        const actorId = 'f2ddd81e-2f9e-421b-941b-a268fd7966cc'
        const ins = await affairs.query(`insert into ticket_events (org_id, ticket_id, actor_id, type, from_value, to_value)
            select t.org_id,t.id,$2,'bad_type','open','resolved'
            from tickets t
            where t.id = $1`,
        [tickedId,actorId]) // bad_type类型不再type中，整个事务都不会成功(改成这个status_changed就好了)
        if(ins.rowCount === 0) throw new Error(`工单 ${tickedId} 不存在`)
        await affairs.query('commit')
    }
    catch(err){
        await affairs.query('rollback').catch(() => {}) // 连接可能已经断了，rollback本身也会出错
        throw err
    }
    finally {
        affairs.release() // 必须还，不然池子会被抽干
        console.log('pool',pool.totalCount,pool.idleCount,pool.waitingCount)
    }
    

} catch(err) {
    console.log('error => ', err)
    process.exitCode = 1
} finally {
    await pool.end();
}