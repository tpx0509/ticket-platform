# SQL 基础与查询规范

面向本项目的日常查询速查。所有示例都在 `ticket_dev` 库上实跑验证过，报错信息是从真实会话里抄的。

连接方式见 `docs/dev-setup.md`。库里的表结构见 `docs/erd.md`。

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
