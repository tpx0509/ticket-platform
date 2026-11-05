# SQL 基础与查询规范

面向本项目的日常查询与索引速查。所有示例都在 `ticket_dev` 库上实跑验证过，报错信息是从真实会话里抄的。

连接方式见 `docs/dev-setup.md`。库里的表结构见 `docs/erd.md`。

第十章的实验表（`perf_demo` / `hash_demo` / `wt_plain` / `wt_indexed`）只用于演示，可以随时删掉，不参与业务。

## 一、执行顺序

写的时候是这个顺序：

```sql
select ... from ... where ... group by ... having ... order by ... limit ...
```

数据库实际执行是这个顺序：

```
from → where → group by → having → select → order by → limit
```

理解这个顺序，很多"为什么这里不能写"就有答案了：

- `where` 里不能写 `select` 里定义的别名——`where` 执行时别名还不存在。
- `order by` 可以使用 `select` 里的别名——它执行在 `select` 之后。
- `where` 里不能写聚合函数——执行到 `where` 时还没分组。
- `where` 里不能写窗口函数——同理，那时还没有结果集可看。

## 二、NULL

`null` 不是"空字符串"，也不是 0，它是"未知"。所以任何跟它比较的结果也是未知：

```sql
select * from tickets where assignee_id = null;    -- 永远 0 行
select * from tickets where assignee_id != null;   -- 也永远 0 行
```

判断只能靠 `is null` / `is not null`：

```sql
select count(*) from tickets where assignee_id is null;   -- 未分派的工单
```

聚合函数对 null 的处理不一样，这点容易混：

| 写法 | 行为 |
|---|---|
| `count(*)` | 数行数，null 行也算 |
| `count(col)` | 只数 `col` 非 null 的行 |
| `count(distinct col)` | 只数非 null 的**不同**值 |
| `avg(col)` / `sum(col)` | 忽略 null，**不进分母** |

`avg(col)` 忽略 null 这一条最容易出错：`avg` 算的是"有值的那部分人的平均"，不是"所有人平均"。要按总人数算，得自己写：

```sql
-- 分母是全部行数，null 当 0 算
sum(score) / count(*)
```

## 三、排序与分页

**不写 `order by` 就没有顺序保证。** 返回顺序是执行计划的副产物，不是"顺手排的"。同一条语句连跑十次可能顺序都一样（计划被缓存），但只要数据量变了、加了索引、升级了版本，顺序就可能变。

最典型的翻车：分页。

```sql
select ... order by number limit 10 offset 10;   -- 危险
```

`number` 是按组织各自自增的，三个组织都有 1 号工单，排序键不唯一。第 11 行该从哪个"1"之后开始没有答案，两次翻页可能给你重叠的数据或漏掉数据。

**排序键必须能唯一确定每一行**。做法是补一个兜底键：

```sql
order by t.number, t.id
```

分组的排序同理，`order by count(*) desc` 时如果两个组数量相同，再加一列当第二排序键：

```sql
order by count(*) desc, o.name
```

## 四、聚合与分组

### 基本规则

`select` 里**每一个没有被聚合函数包起来的列**，都必须出现在 `group by` 里。反方向不要求——`group by` 可以比 `select` 多列。

```sql
-- 合法
select o.name, count(*) from organizations o group by o.name;

-- 报错：column "o.name" must appear in the GROUP BY clause or be used in an aggregate function
select o.name, count(*) from organizations o;
```

报错的含义不是"语法错"，是数据库在问："这一组几十行里，`o.name` 该保留哪一个？给我个依据。"

`group by` 多写列不报错，但会让分组变细、标签重复出现：

```sql
select t.subject, count(*) from tickets t group by t.subject, t.priority;
-- "导出 CSV 中文乱码" 会出现在两行，因为按 priority 拆开了
```

### 按什么分组

**按唯一标识实体的列分，通常就是主键。** `number` 看起来像 ID，其实不是——它按组织自增，跨组织重复。

```sql
-- 错：把不同组织的同号工单合并了，200 张工单只剩 193 组
select t.number, t.subject, count(*) from tickets t
join ticket_comments c on c.ticket_id = t.id
group by t.number, t.subject;

-- 对：按主键分组
select t.number, t.subject, count(*) from tickets t
join ticket_comments c on c.ticket_id = t.id
group by t.id, t.number, t.subject;
```

按主键分组时，`select` 里可以安全地写其他列——主键定了，其他列也就唯一确定（函数依赖）。PostgreSQL 支持这一点，SQL 标准不保证。

### 按时间分组

`created_at` 是带时分秒的 timestamp，直接 `group by created_at` 会得到几百组，一天里的每张工单各成一组。必须先截断到"天"：

```sql
select created_at::date as day, count(*)
from tickets
group by created_at::date
order by count(*) desc
limit 3;
```

`select` 和 `group by` 里要写同一个表达式，或者给别名后 `order by day`。

## 五、条件计数：filter

`count(*) filter (where ...)` 是给**单个聚合函数**加条件，不动其他聚合，也不动行。

```sql
select o.name,
       count(*) as 全部,
       count(*) filter (where t.status = 'open') as open数,
       count(*) filter (where t.priority = 'urgent') as 紧急
from organizations o join tickets t on t.org_id = o.id
group by o.name;
```

`where` 做不到这个——一个 `where` 只能选一种筛选条件，选了就把行筛没了。

`filter` 是聚合语法的一部分，所以跟着聚合函数走，可以出现在 `select`、`having`、`order by`，也能配窗口函数。它不能出现在 `where` 或 `group by` 里。条件里只能写行级列，不能含聚合。

MySQL 不支持 `filter`，那边要写 `sum(case when ... then 1 else 0 end)`。

### `where` 还是 `filter`：0 的问题

```sql
-- A：where
select o.name, count(*) from organizations o join tickets t on t.org_id = o.id
where t.status = 'open' group by o.name;

-- B：filter
select o.name, count(*) filter (where t.status = 'open')
from organizations o join tickets t on t.org_id = o.id group by o.name;
```

如果某个组织一张 open 工单都没有，**A 里这个组织整个消失**，B 里它会保留一行显示 0。

报表要的是 B——"这周 0 个问题"和"这个组织不存在"是两回事。

## 六、JOIN

### 本质

`join` = 先做笛卡尔积，再用 `on` 把不成立的组合踢掉。

```sql
-- 200 张工单 × 3 个组织 = 600 行
select count(*) from tickets, organizations;

-- 加上关联条件，回到 200 行
select t.number, t.subject, o.name
from tickets t join organizations o on o.id = t.org_id;
```

### 三条硬规矩

**一、`on` 里写的是真实关联关系。** 必须能在外键约束或 `docs/erd.md` 里找到依据。

```sql
-- 错误但不会报错：都是 uuid，类型能过，永远匹配不上，静默返回 0 行
join ticket_comments c on c.id = t.org_id

-- 正确
join ticket_comments c on c.ticket_id = t.id
```

这种错误最危险——不报错、不崩溃，只返回空结果或垃圾数据。跑在报表里你会以为"业务没问题"。

**二、两张表都有 `id`、`created_at`、`org_id`，必须用别名。** 不写前缀直接报 `column reference is ambiguous`。

**三、join 之后先数行数。** 行数变多说明一对多没处理好：

```sql
-- 两明细表同时 join 再 count 会翻倍
select count(*) from tickets t
join ticket_comments c on c.ticket_id = t.id
join attachments a on a.ticket_id = t.id;
```

一张工单 3 条评论、2 个附件，join 完变成 3×2 = 6 行。解决办法是 `count(distinct c.id)`，或者把两张明细表分别聚合了再 join。

### inner 与 left

`join` 是 `inner join` 的简写：**匹配不上就整行丢掉。**

`left join` 保证左表每行都留下，右表匹配不上就补 null。

```
left join   → 236 行（152 条匹配 + 84 条补 null）
inner join  → 152 行
```

差出来的 84 行就是"右表缺失"的部分。想单独查它们：

```sql
select t.number, t.subject
from tickets t
left join ticket_comments c on c.ticket_id = t.id and c.is_internal = true
where c.id is null;
```

判断"没有"只能用 `c.id is null`（主键永不为 null，出现 null 只能是没匹配上）。别用业务列，万一那列本身允许 null 就会误判。

**`left join` 之后想过滤，条件一定放 `where`；只有想限制"右表哪部分参与匹配"才放 `on`。**

```sql
-- 错：条件在 on，200 张工单全部返回
left join ticket_comments c on c.ticket_id = t.id and c.id is null

-- 对
left join ticket_comments c on c.ticket_id = t.id where c.id is null
```

因为 `left join` 的承诺是"左表每行都保留"，`on` 里写再严也只是让匹配更难，匹配不上之后照样补 null 保留。

另一种等价写法是 `not exists`，通常更快，也不容易踩 `on`/`where` 的坑：

```sql
select t.number, t.subject from tickets t
where not exists (select 1 from ticket_comments c where c.ticket_id = t.id);
```

## 七、三个过滤关键词的分工

| 关键词 | 作用对象 | 执行时机 | 写聚合函数 |
|---|---|---|---|
| `where` | 单个行 | 分组/聚合之前 | 不能 |
| `filter (where ...)` | 单个聚合内部的行 | 聚合计算中 | 不能 |
| `having` | 整个分组 | 聚合之后 | 只能写这里 |

`where` 管"哪些行进得来"，`filter` 管"这个统计函数只看哪些行"，`having` 管"哪些组留得下"。

写 `having` 时，**先拿一个能真正筛掉数据的阈值验证一遍**。阈值选宽松了、一条也没筛掉，等于没测：

```sql
-- 12 个用户全部超过 5 条，这行和没写 having 一模一样
having count(*) > 5

-- 换成 > 40 才能看出 having 在干活
having count(*) > 40
```

## 八、本项目的查询规则

这两条是代码评审的第一、第二检查项，写任何查询都先过一遍。

**一、必须带 `org_id`。** 多租户隔离的底线。跨组织查询只能是后台运维脚本，不能出现在业务代码里。

```sql
select * from tickets where org_id = $1 and status = 'open';
```

**二、`tickets` 必须排除软删。** 工单是软删除（`deleted_at`），不排除会把已删的查出来。

```sql
select * from tickets where org_id = $1 and deleted_at is null;
```

其余表是硬删除，不需要这个条件（见 `docs/erd.md`）。

## 九、踩过的坑

真实报错，按踩到的顺序。

| 报错 / 现象 | 原因 | 正确做法 |
|---|---|---|
| `select count(*) ... group by status` 出来四个数字不知道谁是谁 | 没把分组列放进 `select` | `select status, count(*) ...` |
| `syntax error at or near "gt"` | `gt` 是 Mongo/ORM 的写法 | SQL 用 `>` |
| `syntax error at or near "filter"` | `filter` 放在 `as 别名` 后面了 | `count(*) filter (where ...) as 别名` |
| `aggregate functions are not allowed in FILTER` | `filter` 条件里写了聚合 | 筛组用 `having` |
| `column "created_at" does not exist` | 漏了 `from`，不是列名拼错 | 先查 `from` |
| `column "o.name" must appear in the GROUP BY clause` | `select` 非聚合列没进 `group by` | 补进 `group by` |
| `column "t.number" must appear in ...` | 同上 | 同上 |
| `column "t.orgid" does not exist` | 列名漏了下划线 | `org_id`，报错的 HINT 里直接给了答案 |
| `column reference "id" is ambiguous` | 两张表都有 `id`，没用别名 | `t.id` / `o.id` |
| `count(status = 'open')` 返回的是全部行数 | `false` 不是 null，全被数进去了 | `count(*) filter (where status = 'open')` |
| 同一个查询两次跑，顺序不一样 | 没写 `order by`，哈希聚合的输出顺序取决于喂进去的行 | 显式 `order by` |
| `left join` 加 `is null` 查出 0 行 | 数据里刚好没有"缺失"的行，不是写错 | 换个有条件不匹配的列交叉验证 |
| `left join` 结果 200 行没筛出任何东西 | 条件写在 `on` 里了 | 条件挪到 `where` |
| 分组后"最多"变成了 6 而实际最多 3 | 按 `number` 分组，跨组织的同号工单被合并 | 按主键 `t.id` 分组 |
| `having count(*) > 5` 一条没筛掉 | 阈值比所有组都小 | 换个能筛掉数据的阈值验证 |

## 十、索引与执行计划

这一章的例子跑在实验表 `perf_demo`（10 万行）和真实的 `tickets` 上。实验表可以随便删，不影响项目。

### 索引是什么

索引是一份额外的、**排好序的目录**，每条记录只存两样东西：**键值** + **这一行在表里的物理位置（`ctid`）**。

它不存整行数据。所以查到位置之后，还得按 `ctid` 去表里把那行捞出来——这一步叫**回表**。

排好序才有意义：有序才能二分，一次排除一半。10 万行只需比较十几次。

**B+ 树**就是 PostgreSQL 默认的索引结构（`btree`）。三个特征：

- 每个节点大小对齐一个磁盘页（8KB），一个节点能装几百个键，所以树很矮——10 万行只有 3 层
- 内部节点只存「路标 + 子页号」，数据全在叶子层
- 叶子层之间用链表串起来，范围查询顺着走

层数就是**磁盘随机读的次数**。二叉树 17 层 = 17 次 I/O，B+ 树 3 层 = 3 次，这就是它存在的全部理由。

真实效果（`perf_demo`，10 万行）：

| 情况 | 计划 | 耗时 |
|---|---|---|
| 无索引 | Seq Scan，`Rows Removed by Filter: 99999` | 7.504ms |
| 有索引 | Index Scan | 0.091ms |

### 把索引页拆开看

PostgreSQL 带一个检查工具，可以直接读磁盘上的索引页：

```sql
create extension if not exists pageinspect;

-- 索引一共多少页
select pg_relation_size('perf_demo_email_idx')/8192;   -- 499

-- 找内部节点（btpo_level > 0 的）
select s.blkno as 页号, b.btpo_level as 层级, b.live_items as 条目数
from generate_series(1,498) s(blkno)
cross join lateral bt_page_stats('perf_demo_email_idx', s.blkno) b
where b.btpo_level > 0 order by 2 desc;
```

```
页号 | 层级 | 条目数
 164 |   2  |    4      ← 根
   3 |   1  |  159      ← 中间层
 163 |   1  |  159
 323 |   1  |  159
 482 |   1  |   19
```

根页只有 4 条，内容长这样：

| 序号 | 指向 | 键值 |
|---|---|---|
| 1 | 子页 3 | （空，负无穷） |
| 2 | 子页 163 | user38869@example.com |
| 3 | 子页 323 | user67735@example.com |
| 4 | 子页 482 | user96601@example.com |

**一条行数据都没有**，全是「边界值 + 子页号」。查 `user50000` 时比一下就知道该去第 323 页。

叶子页才是真货，`ctid` 变成表的物理地址：

```
序号 | 表里的位置 | 键值
  2  | (934,59)   | user100000@example.com
  3  | (93,46)    | user10000@example.com
  4  | (93,47)    | user10001@example.com
```

同一个叶子页里，行位置从第 934 页跳到第 93 页——**索引有序不代表表有序**。这就是回表必须随机 I/O 的原因。

`itemoffset = 1` 那条是 high key（本页所有键的上界），不是真实数据，查的时候跳过。

### 看执行计划

```sql
explain select ...          -- 只出计划，不执行
explain analyze select ...  -- 真跑一遍，带实际耗时
```

`delete` / `update` 别随手加 `analyze`，那是真执行。

两个概念要分清：

- `cost` 是**相对单位**，不是毫秒。读一个页记 1.0，随机页 4.0，处理一行记 0.01。用来看「优化器觉得哪个更划算」，别看绝对值。
- `Filter` 和 `Index Cond` 的区别就是快在哪的答案。`Index Cond` 里的条件用索引定位了，`Filter` 里的只是捞出来再筛。

`Rows Removed by Filter` 越大，说明白读的行越多。

三种扫描方式：

| 方式 | 什么时候选 | 特点 |
|---|---|---|
| `Seq Scan` | 要的行占比高、表小 | 从头读到尾 |
| `Index Scan` | 只要少量行 | 按索引顺序逐行，**能省掉 order by** |
| `Bitmap Index Scan` | 几千到几万行 | 先收集行位置按页排序，再顺序回表；省随机 I/O，但**顺序被打乱** |

实测 `where status = 'open'`（占 25%）：

```
Bitmap Heap Scan + Bitmap Index Scan   3.162ms
关掉 bitmapscan → Seq Scan             5.946ms
```

只快 1.9 倍，不是几十倍。因为表小、页都在内存里。索引的威力在「只要几行」时才炸开。

### 复合索引与最左前缀

索引 `(a, b)` **不是**「a 的索引 + b 的索引」，是一本「先按 a 排，a 相同的再按 b 排」的字典。跟电话簿一样：能按姓查，能按「姓 + 名」查，不能只按名查。

实测 `perf_demo_status_created_idx (status, created_at)`：

| 查询 | 计划 | 耗时 |
|---|---|---|
| `status=? and created_at>?` | Index Scan，两列都在 `Index Cond` | 0.114ms |
| `created_at>? and status=?`（反过来写） | 同一个索引，两列都在 `Index Cond` | 0.077ms |
| **只写 `created_at>?`** | **Seq Scan** | 5.449ms |

三条结论：

1. **`where` 里条件的书写顺序完全不影响**，优化器自己重排。决定的是索引定义时的列顺序。
2. 只给第二列，索引彻底用不上。
3. **范围条件会截断它右边的列**。`(a, b)` 遇上 `a > 1 and b = 2`，`b` 只能掉进 `Filter`。

所以列顺序的原则：**等值条件在前，范围/排序列在后，中间不能夹列**。

### 索引顺序与 order by

索引的物理顺序如果和 `order by` 一致，排序这一步直接消失。

`tickets` 上的实测（列表页：按组织 + 状态筛，时间倒序取 20 条）：

| 计划 | 耗时 |
|---|---|
| Seq Scan + `Sort` | 0.166ms |
| Bitmap Index Scan + `Sort` | 1.389ms |
| Index Scan，**没有 Sort** | 0.101ms |

第二种为什么还要排序？因为 bitmap 按物理页号回表，顺序被打乱了。**能省随机 I/O 的代价，就是丢掉索引顺序。**

`Index Scan` 顺着索引读，读到第 20 行就停，`order by ... limit 20` 变成「读前 20 个叶子项」。

另外，**升序索引也能服务 `desc`**：

```
Index Scan Backward using perf_demo_status_created_idx
```

所以 `(org_id, status, created_at)` 和 `(org_id, status, created_at desc)` 对 `order by created_at desc` 效果一样。`DESC` 只有在**混合排序**（一列升一列降）时才是必须的。

### 回表与覆盖索引

索引只有「索引列 + ctid」，查的列不全在索引里就得回表。

| 查询 | 计划 | cost |
|---|---|---|
| `select *` | Index Scan | 8.44 |
| `select email` | Index Only Scan，`Heap Fetches: 0` | 4.44 |
| `select email, status` | Index Scan | 8.44 |

回表让成本翻倍。要把列加进索引：

```sql
create index perf_demo_cover_idx on perf_demo (email) include (status);
```

`include` 的列存在叶子层，不参与排序，所以索引不会变高。这叫**覆盖索引**——不是一种索引类型，而是「索引覆盖了这条查询」的关系。同一个索引，对这条查询是覆盖索引，对那条不是。

判定方法：把 `select` 要的列和 `where` / `order by` / `group by` 用到的列凑一起，看是不是全在索引里。

**坑：`Index Only Scan` 不保证真的不回表。**

```sql
update perf_demo set status = status where email = 'user88888@example.com';
explain analyze select email from perf_demo where email = 'user88888@example.com';
-- Heap Fetches: 2
```

因为可见性映射脏了，PG 不敢直接信索引里的行位置。跑一次 `vacuum perf_demo`，回到 `0`。这也解释了为什么大批量导入后查询会突然变慢，autovacuum 还没跟上。

### 索引失效的场景

分三类，性质不同。

**一、结构上就用不了**（改写法能救）

- 列被函数包住：`where lower(email) = ?`。索引存的是原文，对不上。要用就建表达式索引 `create index on t (lower(email))`。
- 复合索引缺最左列。
- 前后都加通配：`like '%88888@example.com'`。

**二、优化器算完觉得不划算**（改写法救不了）

- `!=`、`not in`、`is not null`：要返回绝大多数行，走索引反而更贵。
- 表太小：`tickets` 200 行，全表扫 0.166ms，比索引还快。
- 统计信息过期：跑 `analyze 表名`。

**三、写法导致**

- `or` 只要有一边没索引，整体退化。

实测数据：

| 写法 | 计划 | 耗时 |
|---|---|---|
| `email != 'x'` | Seq Scan | 14.944ms |
| `a = 1 or b > x`（b 无索引） | Seq Scan | 7.040ms |
| `a = 1 or b = 2`（两边都有索引） | `BitmapOr` | 4.600ms |
| `like 'user88888%'` | **Index Scan** | 0.032ms |
| `like '%88888@example.com'` | Seq Scan | 7.706ms |

注意第四行：**前缀通配是能走索引的**，PG 把它改写成了范围条件：

```
Index Cond: (email >= 'user88888' AND email < 'user88889')
```

只有前面也带 `%` 才真的废——没法确定起点。

面试时说 **「优化器没选索引」** 比说「索引失效」准确。大部分情况不是不能用，是它算过觉得不划算。

### 索引的代价

空间：`perf_demo` 表本体 7.5 MB，5 个索引加起来 15 MB。索引比表大是常态。

写入：同样插 5 万行

| 情况 | 耗时 |
|---|---|
| 只有主键 | 124.9 ms |
| 加 4 个索引 | 468.2 ms |

慢 3.7 倍。每插一行，4 棵 B+ 树都要插一条、维护顺序、写 WAL。`update` 改了索引列的话更贵，旧条目标记删除、新条目插入。

三种不该建索引的情况：

- **小表**：几十万行以下，全表扫往往更快
- **低区分度**：`status` 只有 4 个值，单独建索引要扫 25% 的行再回表，不如全表扫。它只有在复合索引里当前缀才有价值
- **写多读少**：日志、事件、埋点表

判断一个索引该不该存在：**看它能不能让某条具体查询既不回表、又不排序。** 一堆列堆上去没用，得跟查询的形状对上。

### 本项目现有索引

`tickets` 七个索引，各有明确的服务对象：

```sql
tickets_org_id_status_created_at_idx  (org_id, status, created_at DESC)
tickets_org_id_created_at_idx         (org_id, created_at DESC)
tickets_org_id_assignee_id_status_idx (org_id, assignee_id, status)
tickets_org_id_number_key             (org_id, number)        -- 唯一约束
tickets_pkey                          (id)
tickets_fts_idx                       gin 全文（subject + description）
tickets_subject_trgm_idx              gin 三元组（模糊匹配 subject）
```

前两个看起来像，其实不能互相替代：第一个的 `status` 卡在中间，**不筛状态时它的排序用不上**，所以第二个必须留。

实测对比（`perf_demo`，只按时间倒序取 20 条）：

| 索引情况 | 计划 | 耗时 |
|---|---|---|
| 只有 `(status, created_at)` | Seq Scan + Sort（排 10 万行） | 15.795ms |
| 加上 `(created_at DESC)` | Index Scan，无 Sort | 0.137ms |

定义在 `apps/api/prisma/schema.prisma` 的 `@@index`，别手敲 SQL 建，否则下次生成迁移会对不上。

查哪些索引从来没被用过：

```sql
select indexrelname as 索引, idx_scan as 被用次数,
       pg_size_pretty(pg_relation_size(indexrelid)) as 大小
from pg_stat_user_indexes
where relname = 'tickets'
order by pg_relation_size(indexrelid) desc;
```

`idx_scan = 0` 且确认业务上也不需要的，可以删。注意统计重启会清零。

### 索引这一节的坑

| 现象 | 原因 | 正确做法 |
|---|---|---|
| 建了索引还是 Seq Scan | 要返回的行占比太高，优化器算过觉得不划算 | 看 `Rows Removed by Filter`，不是 bug |
| `created_at` 单独查走不了复合索引 | 它在 `(status, created_at)` 的第二位 | 单独建一个 `(created_at)`，或调整列顺序 |
| bitmap 扫描后还是出现 `Sort` | bitmap 按物理页序回表，顺序被打乱 | 要排序就让它走 `Index Scan` |
| `Index Only Scan` 仍显示 `Heap Fetches: 2` | 刚 update 过，可见性映射脏了 | `vacuum 表名` |
| `analyze` 前后估算差很多 | 统计信息过期 | 大批量写入后手动 `analyze` |
| 以为 `like 'x%'` 走不了索引 | 实际能，PG 改写成范围条件 | 只有前后都带 `%` 才真的废 |
| 加 `DESC` 以为性能更好 | 单列排序时 PG 会反向扫 | 只有混合排序才必须写 `DESC` |
| 五个索引把写入拖慢 3.7 倍 | 每行要维护五棵 B+ 树 | 只给真实高频查询建 |
