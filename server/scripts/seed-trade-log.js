"use strict";

var path = require("path");

var mysql = require("mysql2/promise");

var tableCount = Math.max(parseInt(process.env.TABLE_COUNT || "5", 10) || 5, 1);
var rowsPerTable = Math.max(parseInt(process.env.ROWS_PER_TABLE || "5000", 10) || 5000, 1);
var parallel = Math.max(parseInt(process.env.PARALLEL || "1", 10) || 1, 1);
var batchRows = Math.max(parseInt(process.env.BATCH_ROWS || "2000", 10) || 2000, 100);
var reseed = String(process.env.RESEED || "0") === "1";
var startDaysAgo = Math.max(parseInt(process.env.START_DAYS_AGO || "0", 10) || 0, 0);
var confPath = path.resolve(__dirname, "..", "TradeLogQueryServer.conf");

var config;
try {
  config = require("../lib/config");
  var Q = require("q");
} catch (e) {
  console.error("无法找到 @taf 模块，请确保 node_modules 中已安装 @taf 相关依赖");
  console.error("或手动设置 NODE_PATH 环境变量指向包含 @taf 的 node_modules 目录");
  process.exit(1);
}

var DDL = "" +
  "CREATE TABLE IF NOT EXISTS `%TABLE%` (" +
  "  `id` int(11) NOT NULL AUTO_INCREMENT," +
  "  `application_name` varchar(64) DEFAULT NULL," +
  "  `log_lvl` varchar(32) DEFAULT NULL," +
  "  `log_date` datetime DEFAULT NULL," +
  "  `log_date_ms` int(11) DEFAULT NULL," +
  "  `process_id` varchar(32) DEFAULT NULL," +
  "  `thread_id` varchar(32) DEFAULT NULL," +
  "  `module_name` varchar(32) DEFAULT NULL," +
  "  `src_location` varchar(1024) DEFAULT NULL," +
  "  `processing_stage` varchar(32) DEFAULT NULL," +
  "  `session_id` varchar(64) DEFAULT NULL," +
  "  `time_consuming` int(11) DEFAULT NULL," +
  "  `user_id` varchar(32) DEFAULT NULL," +
  "  `req_uri` varchar(64) DEFAULT NULL," +
  "  `process_number` varchar(32) DEFAULT NULL," +
  "  `backend_id` varchar(32) DEFAULT NULL," +
  "  `backend_process_id` varchar(32) DEFAULT NULL," +
  "  `data_info` mediumtext," +
  "  `mobile_no` varchar(16) DEFAULT ''," +
  "  `imei` varchar(16) DEFAULT ''," +
  "  `version` varchar(32) DEFAULT ''," +
  "  `os_version` varchar(32) DEFAULT ''," +
  "  `imsi` varchar(16) DEFAULT ''," +
  "  `mac` varchar(32) DEFAULT ''," +
  "  `udid` varchar(64) DEFAULT ''," +
  "  `ip` varchar(64) DEFAULT ''," +
  "  `create_time` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP," +
  "  `mach_id` varchar(32) DEFAULT ''," +
  "  `name` varchar(50) DEFAULT NULL," +
  "  `succ` int(1) DEFAULT -1," +
  "  INDEX `user_id_index` (`user_id`)," +
  "  INDEX `mobile_no_index` (`mobile_no`)," +
  "  INDEX `processing_stage_index` (`processing_stage`)," +
  "  INDEX `modle_name_index` (`name`)," +
  "  PRIMARY KEY (`id`)" +
  ") ENGINE=MyISAM DEFAULT CHARSET=utf8";

var COLS = [
  "application_name", "log_lvl", "log_date", "log_date_ms",
  "process_id", "thread_id", "module_name", "src_location",
  "processing_stage", "session_id", "time_consuming", "user_id",
  "req_uri", "process_number", "backend_id", "backend_process_id",
  "data_info", "mobile_no", "imei", "version", "os_version",
  "imsi", "mac", "udid", "ip", "mach_id", "name", "succ"
];

function pad2(v) {
  return String(v).padStart(2, "0");
}

function dateSuffix(daysAgo, template) {
  var d = new Date(Date.now() - daysAgo * 86400000);
  return String(template || "YYYYMMDD")
    .replace(/YYYY/g, String(d.getFullYear()))
    .replace(/MM/g, pad2(d.getMonth() + 1))
    .replace(/DD/g, pad2(d.getDate()));
}

function randomString(len, chars) {
  var result = "";
  for (var i = 0; i < len; i += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function escapeId(name) {
  return "`" + name.replace(/`/g, "``") + "`";
}

// ---- deterministic generation (no per-row Math.random / Date.now) ----

var POOL_SIZE = 256;
function makePool(fn) {
  var a = [];
  for (var i = 0; i < POOL_SIZE; i += 1) a.push(fn(i));
  return a;
}
var sessionPool = makePool(function () { return randomString(16, "0123456789abcdef"); });
var mobilePool = makePool(function () { return "138" + randomString(8, "0123456789"); });
var imeiPool = makePool(function () { return randomString(15, "0123456789abcdef"); });
var imsiPool = makePool(function () { return randomString(15, "0123456789"); });
var udidPool = makePool(function () { return randomString(40, "0123456789abcdef"); });
var macPool = makePool(function () {
  var s = randomString(12, "0123456789abcdef");
  return s.replace(/(..)(?=.)/g, "$1:");
});

var userPool = [];
for (var u = 0; u < 500; u += 1) {
  userPool.push("user_" + pad2(u % 100));
}

var APPS = ["ATrade", "ATradeMoni", "AMNGame", "AlgoTrade"];
var LVLS = ["INFO", "WARN", "ERROR", "DEBUG"];
var MODS = ["Trade", "Order", "Quote", "Risk", "Account"];
var CLASSES = ["TradeServlet", "OrderHandler", "QuoteService", "RiskCheck", "AccountManager"];
var STAGES = ["CLIREQ", "CLIRES", "req", "rsp", "RECVBD", "RECVBD", "RECVBD", "SENDBD", "SENDBD", "SENDBD"];
var URIS = ["/api/trade/order", "/api/trade/quote", "/api/trade/cancel", "/api/account/balance", "/api/risk/check"];
var VERS = ["6.0.1", "6.0.2", "6.1.0", "6.1.1", "6.2.0"];
var OSVS = ["iOS 15.0", "iOS 16.0", "Android 12", "Android 13", "HarmonyOS 3.0"];
var NAMES = ["测试交易", "测试下单", "测试行情", "测试风控", "测试账户"];
var DATA_TS = "1750000000000";

function pushRow(flat, i, dateStr) {
  var hour = Math.floor(i / 420) % 24;
  var minute = Math.floor(i / 7) % 60;
  var second = i % 60;
  var succ = i % 11 === 0 ? 0 : (i % 23 === 0 ? -1 : 1);
  var time = (i * 7919) % 5000;
  var p = i % POOL_SIZE;
  flat.push(
    APPS[i % 4], LVLS[i % 4],
    dateStr + " " + pad2(hour) + ":" + pad2(minute) + ":" + pad2(second),
    i % 999,
    "PID-" + pad2(i % 64), "THR-" + pad2(i % 32),
    MODS[i % 5],
    "com.upchina.trade." + CLASSES[i % 5] + ".java:" + (100 + i % 900),
    STAGES[i % STAGES.length],
    "SESS" + sessionPool[p],
    time,
    userPool[i % userPool.length],
    URIS[i % 5],
    "P" + pad2(i % 16), "BE-" + pad2(i % 4), "BP-" + pad2(i % 8),
    '{"reqId":' + i + ',"ts":' + DATA_TS + '}',
    mobilePool[(p * 3) % POOL_SIZE],
    imeiPool[(p * 5) % POOL_SIZE],
    VERS[i % 5], OSVS[i % 5],
    imsiPool[(p * 7) % POOL_SIZE],
    macPool[(p * 11) % POOL_SIZE],
    udidPool[(p * 13) % POOL_SIZE],
    "10." + (i % 64) + "." + (Math.floor(i / 64) % 256) + "." + ((i % 253) + 1),
    "MACH-" + pad2(i % 32),
    NAMES[i % 5],
    succ
  );
}

function fmtTime(ms) {
  var s = Math.round(ms / 1000);
  if (s < 60) return s + "s";
  var m = Math.floor(s / 60);
  if (m < 60) return m + "m" + (s % 60) + "s";
  return Math.floor(m / 60) + "h" + (m % 60) + "m" + (s % 60) + "s";
}

async function seedOneTask(task, conn) {
  var tableName = task.tableName;
  await conn.query(DDL.replace(/%TABLE%/g, tableName));

  var [rows] = await conn.query("SELECT COUNT(*) AS c FROM " + escapeId(tableName));
  var cnt = rows[0].c;
  if (cnt >= rowsPerTable && !reseed) {
    return { skipped: true, existing: cnt };
  }
  if (cnt > 0) {
    await conn.query("DELETE FROM " + escapeId(tableName));
  }

  var dateStr = String(task.suffix).replace(/^(\d{4})\D?(\d{2})\D?(\d{2})$/, "$1-$2-$3");
  await conn.query("ALTER TABLE " + escapeId(tableName) + " DISABLE KEYS").catch(function () {});

  var colList = COLS.map(escapeId).join(", ");
  var ph1 = "(" + COLS.map(function () { return "?"; }).join(", ") + ")";
  var sqlHead = "INSERT INTO " + escapeId(tableName) + " (" + colList + ") VALUES ";

  for (var i = 0; i < rowsPerTable; i += batchRows) {
    var end = Math.min(i + batchRows, rowsPerTable);
    var n = end - i;
    var flat = [];
    for (var j = i; j < end; j += 1) {
      pushRow(flat, j, dateStr);
    }
    await conn.query(sqlHead + new Array(n).fill(ph1).join(", "), flat);
  }

  await conn.query("ALTER TABLE " + escapeId(tableName) + " ENABLE KEYS").catch(function () {});
  return { skipped: false };
}

async function runWorker(tasks, shared) {
  var conns = {};
  while (true) {
    var task = shared.nextTask();
    if (!task) break;
    try {
      if (!conns[task.dbName]) {
        conns[task.dbName] = await mysql.createConnection({
          host: shared.host, port: shared.port, user: shared.user,
          password: shared.pass, charset: "utf8", database: task.dbName
        });
      }
      var t0 = Date.now();
      var res = await seedOneTask(task, conns[task.dbName]);
      shared.done += 1;
      shared.rows += rowsPerTable;
      var elapsed = Date.now() - t0;
      var et = Date.now() - shared.start;
      var eta = (et / shared.done) * (shared.total - shared.done);
      var rate = shared.rows / (et / 1000);
      var line = "  [" + shared.done + "/" + shared.total + "] " + task.dbName + "." + task.tableName;
      if (res.skipped) {
        line += " skipped (exists " + res.existing + ")";
      } else {
        line += " " + rowsPerTable.toLocaleString() + " rows in " + (elapsed / 1000).toFixed(1) + "s";
      }
      line += " | total " + shared.rows.toLocaleString() + " rows (" +
        ((shared.done / shared.total) * 100).toFixed(1) + "%) rate " +
        (rate / 10000).toFixed(1) + "万/s ETA " + fmtTime(eta);
      console.log(line);
    } catch (e) {
      shared.errors += 1;
      console.error("  ERROR " + task.dbName + "." + task.tableName + ": " + ((e && e.message) || String(e)));
    }
  }
  for (var k in conns) {
    try { await conns[k].end(); } catch (e) {}
  }
}

config.loadConfig("TradeLogQueryServer.conf", "c").then(async function (ret) {
  var dbConfig = ret.db || {};
  var namesRaw = String(process.env.DB_NAMES || dbConfig.names || "").trim();
  var entries = namesRaw.split(",").map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });

  var tradeLogCfg = ret.tradeLog || {};
  var tablePrefix = String(tradeLogCfg.tablePrefix || "TBL_TRADE_LOG_");
  var tableSuffixTemplate = String(tradeLogCfg.tableDateSuffix || "YYYYMMDD");
  if (!/^[a-zA-Z0-9_]+$/.test(tableSuffixTemplate)) tableSuffixTemplate = "YYYYMMDD";

  if (entries.length === 0) {
    console.error("No databases configured in <db> names field (or DB_NAMES env)");
    process.exit(1);
  }

  var host = process.env.DB_HOST || dbConfig.host || "127.0.0.1";
  var port = parseInt(process.env.DB_PORT || dbConfig.port || "3306", 10);
  var user = process.env.DB_USER || dbConfig.user || "root";
  var pass = process.env.DB_PASS || dbConfig.pass || dbConfig.password || "";

  var totalTables = entries.length * tableCount;
  var totalRows = totalTables * rowsPerTable;

  console.log("=== trade log perf seed ===");
  console.log("DBs: " + entries.length + " (" + entries.join(", ") + ")");
  console.log("Tables per DB: " + tableCount + " -> total tables: " + totalTables);
  console.log("Rows per table: " + rowsPerTable.toLocaleString() + " -> total rows: " + totalRows.toLocaleString());
  console.log("Parallel workers: " + parallel + ", batch rows: " + batchRows + ", engine: MyISAM (DISABLE KEYS)");
  console.log("Host: " + host + ":" + port + ", user: " + user);
  console.log("");

  var adminConn = await mysql.createConnection({ host: host, port: port, user: user, password: pass, charset: "utf8" });
  for (var ei = 0; ei < entries.length; ei += 1) {
    await adminConn.query("CREATE DATABASE IF NOT EXISTS " + escapeId(entries[ei]) + " DEFAULT CHARSET utf8");
  }
  await adminConn.end();

  var tasks = [];
  entries.forEach(function (dbName) {
    for (var day = startDaysAgo; day < startDaysAgo + tableCount; day += 1) {
      var suffix = dateSuffix(day, tableSuffixTemplate);
      tasks.push({ dbName: dbName, tableName: tablePrefix + suffix, suffix: suffix });
    }
  });

  var shared = {
    host: host, port: port, user: user, pass: pass,
    idx: 0, done: 0, rows: 0, errors: 0, total: tasks.length, start: Date.now(),
    nextTask: function () {
      return shared.idx < tasks.length ? tasks[shared.idx++] : null;
    }
  };

  var workers = [];
  for (var w = 0; w < Math.min(parallel, tasks.length); w += 1) {
    workers.push(runWorker(tasks, shared));
  }
  await Promise.all(workers);

  var et2 = Date.now() - shared.start;
  console.log("");
  console.log("Done. Tables: " + shared.done + "/" + shared.total + ", errors: " + shared.errors +
    ", elapsed: " + fmtTime(et2) + ", avg rate: " + (shared.rows / (et2 / 1000) / 10000).toFixed(1) + "万 rows/s");
  process.exit(shared.errors ? 1 : 0);
}).catch(function (err) {
  console.error("Seed failed:", err.message || String(err));
  process.exit(1);
});
