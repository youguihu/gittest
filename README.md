# TAF.js 风格全栈数据库示例 — MySQL 多库分表查询

这个项目演示一个服务完成三件事：

- 托管前端页面：`public/index.html`
- 提供后端 API：`app.js` + `routes/loginRecords.js` + `routes/users.js`
- 按 TAF.js 风格启动：`bin/www`
- 读取 TAF 风格配置：`ATMngWebServer.conf`
- 查询 MySQL 多库分表数据：三个库 KDS_MONI / KDS_MONID / KDS_MONI_ZB，每个库中按日分表 `TBL_TRADE_LOG_YYYY_MM_DD`（如 `TBL_TRADE_LOG_2023_10_13`）
- 系统用户来自本地配置和进程内存缓存，不创建用户表

## 数据库配置

配置在 `ATMngWebServer.conf` 的 `<db>` 节，`names` 为逗号分隔的库名列表，其余参数所有库共享：

```conf
<db>
  names=KDS_MONI,KDS_MONID,KDS_MONI_ZB
  host=127.0.0.1
  port=3306
  user=root
  pass=
  charset=utf8
  connectionLimit=5
</db>
```

支持环境变量覆盖所有库的连接参数：`DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASS`。

日表前缀与日期后缀模板配置在 `<tradeLog>` 节，`tableDateSuffix` 使用 `YYYY` / `MM` / `DD` 占位符拼接出分表后缀：

```conf
<tradeLog>
  tablePrefix=TBL_TRADE_LOG_
  tableDateSuffix=YYYY_MM_DD
</tradeLog>
```

- `YYYYMMDD` → `TBL_TRADE_LOG_20231013`
- `YYYY_MM_DD` → `TBL_TRADE_LOG_2023_10_13`

请确保该模板与库中实际分表命名一致（恒生交易日志分表通常为 `YYYY_MM_DD` 风格）。

## 数据库查询入口（可选）

index 页面可开启一个“数据库查询”入口，按输入的 MySQL 连接参数连接并执行任意 SQL、打印结果。由 `<dbQuery>` 节控制开关：

```conf
<dbQuery>
  enabled=1    # 1=开启该入口，0=关闭（关闭后前端隐藏入口，API 直接返回 403）
  maxRows=500  # SELECT 最多返回行数，超出截断并提示
</dbQuery>
```

接口：

```bash
curl -X POST http://localhost:3000/api/db-query/execute \
  -b <session_cookie> -H "Content-Type: application/json" \
  -d '{"host":"127.0.0.1","port":3306,"user":"root","password":"","database":"KDS_MONI","sql":"SELECT * FROM TBL_TRADE_LOG_2023_10_13 LIMIT 50"}'
```

> 注意：该入口可在任意目标库执行任意 SQL，属于高权限操作，请仅在受控网络/管理场景下开启。连接参数仅用于本次请求，不保存密码。

## 运行

```bash
# 1. 准备数据库（需要可用的 MySQL）
npm run seed

# 2. 启动服务
npm start
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DB_HOST` | 数据库主机（覆盖所有库） | conf 中各个库的 host |
| `DB_PORT` | 数据库端口 | conf 中各个库的 port |
| `DB_USER` | 数据库用户 | conf 中各个库的 user |
| `DB_PASS` | 数据库密码 | conf 中各个库的 pass |
| `TABLE_COUNT` | 播种天数（仅 seed） | 5 |
| `ROWS_PER_TABLE` | 每表行数（仅 seed） | 5000 |

## API

查询交易日志：

```bash
curl "http://localhost:3000/api/login-records?startDate=2026-08-01&endDate=2026-08-03&page=1&pageSize=50"
```

按用户 ID、IP、结果过滤：

```bash
curl "http://localhost:3000/api/login-records?startDate=2026-08-01&endDate=2026-08-03&user_id=user_01&ip=10.8.1&succ=1"
```

支持的过滤参数：`user_id`、`ip`、`mobile`、`version`、`os_version`、`succ`（1=成功 / 0=失败 / -1=未知）、`processing_stage`、`module_name`、`req_uri`、`log_lvl`。

登录：

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

## 说明

- 查询时自动探测每个库中是否存在对应日期的分表，仅查询存在的表
- 结果跨库排序，按 `log_date DESC, log_date_ms DESC, id DESC`
- 前端显示来源库和来源表
- 如果某个库连接失败，继续查询其他库并在响应中报告 `failedDbs`