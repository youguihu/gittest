# TAF.js 风格全栈数据库示例 — MySQL 多库分表查询

这个项目演示一个服务完成三件事：

- 托管前端页面：`public/index.html`
- 提供后端 API：`app.js` + `routes/loginRecords.js` + `routes/users.js`
- 按 TAF.js 风格启动：`bin/www`
- 读取 TAF 风格配置：`ATMngWebServer.conf`
- 查询 MySQL 多库分表数据：三个库 KDS_MONI / KDS_MONID / KDS_MONI_ZB，每个库中按日分表 `TBL_TRADE_LOG_YYYYMMDD`
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

日表前缀配置在 `<tradeLog>` 节：

```conf
<tradeLog>
  tablePrefix=TBL_TRADE_LOG_
  tableDateSuffix=YYYYMMDD
</tradeLog>
```

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