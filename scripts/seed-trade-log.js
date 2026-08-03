"use strict";

var path = require("path");
var fs = require("fs");
var Module = require("module");

// 运行时解析 NODE_PATH 以定位 @taf 模块
if (!process.env.NODE_PATH) {
  var projectRoot = path.join(__dirname, "..");
  var resolved = "";
  // 1. 向上查找
  var dir = projectRoot;
  while (true) {
    var candidate = path.join(dir, "node_modules");
    if (fs.existsSync(path.join(candidate, "@taf"))) {
      resolved = candidate;
      break;
    }
    var parent = path.dirname(dir);
    if (parent === dir) { break; }
    dir = parent;
  }
  // 2. 在兄弟目录中查找
  if (!resolved) {
    var parentDir = path.dirname(projectRoot);
    try {
      var siblings = fs.readdirSync(parentDir);
      for (var i = 0; i < siblings.length; i += 1) {
        var siblingNM = path.join(parentDir, siblings[i], "node_modules");
        if (fs.existsSync(path.join(siblingNM, "@taf"))) {
          resolved = siblingNM;
          break;
        }
      }
    } catch (e) { /* ignore */ }
  }
  // 3. 回退到项目自身的 node_modules
  if (!resolved) {
    resolved = path.join(projectRoot, "node_modules");
  }
  process.env.NODE_PATH = resolved;
  Module._initPaths();
}

var mysql = require("mysql2/promise");

var tableCount = Math.max(parseInt(process.env.TABLE_COUNT || "5", 10) || 5, 1);
var rowsPerTable = Math.max(parseInt(process.env.ROWS_PER_TABLE || "5000", 10) || 5000, 1000);
var confPath = path.resolve(__dirname, "..", "ATMngWebServer.conf");

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

function pad2(v) {
  return String(v).padStart(2, "0");
}

function dateSuffix(daysAgo) {
  var d = new Date(Date.now() - daysAgo * 86400000);
  return String(d.getFullYear()) + pad2(d.getMonth() + 1) + pad2(d.getDate());
}

function randomString(len, chars) {
  var result = "";
  for (var i = 0; i < len; i += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

var userPool = [];
for (var u = 0; u < 500; u += 1) {
  userPool.push("user_" + pad2(u % 100));
}

function rowFor(index, suffix) {
  var userIdx = index % userPool.length;
  var hour = Math.floor(index / 420) % 24;
  var minute = Math.floor(index / 7) % 60;
  var second = index % 60;
  var ms = index % 999;
  var succVal = index % 11 === 0 ? 0 : (index % 23 === 0 ? -1 : 1);

  return {
    application_name: ["ATrade", "ATradeMoni", "AMNGame", "AlgoTrade"][index % 4],
    log_lvl: ["INFO", "WARN", "ERROR", "DEBUG"][index % 4],
    log_date: suffix.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3") + " " + pad2(hour) + ":" + pad2(minute) + ":" + pad2(second),
    log_date_ms: ms,
    process_id: "PID-" + pad2(index % 64),
    thread_id: "THR-" + pad2(index % 32),
    module_name: ["Trade", "Order", "Quote", "Risk", "Account"][index % 5],
    src_location: "com.upchina.trade." + ["TradeServlet", "OrderHandler", "QuoteService", "RiskCheck", "AccountManager"][index % 5] + ".java:" + (100 + index % 900),
    processing_stage: ["下单", "风控", "成交", "清算", "推送"][index % 5],
    session_id: "SESS" + randomString(16, "0123456789abcdef"),
    time_consuming: Math.floor(Math.random() * 5000),
    user_id: userPool[userIdx],
    req_uri: ["/api/trade/order", "/api/trade/quote", "/api/trade/cancel", "/api/account/balance", "/api/risk/check"][index % 5],
    process_number: "P" + pad2(index % 16),
    backend_id: "BE-" + pad2(index % 4),
    backend_process_id: "BP-" + pad2(index % 8),
    data_info: JSON.stringify({ reqId: index, timestamp: Date.now() }),
    mobile_no: "138" + randomString(8, "0123456789"),
    imei: randomString(15, "0123456789abcdef"),
    version: ["6.0.1", "6.0.2", "6.1.0", "6.1.1", "6.2.0"][index % 5],
    os_version: ["iOS 15.0", "iOS 16.0", "Android 12", "Android 13", "HarmonyOS 3.0"][index % 5],
    imsi: randomString(15, "0123456789"),
    mac: randomString(2, "0123456789abcdef") + ":" + randomString(2, "0123456789abcdef") + ":" + randomString(2, "0123456789abcdef") + ":" + randomString(2, "0123456789abcdef") + ":" + randomString(2, "0123456789abcdef") + ":" + randomString(2, "0123456789abcdef"),
    udid: randomString(40, "0123456789abcdef"),
    ip: "10." + (index % 64) + "." + (Math.floor(index / 64) % 256) + "." + ((index % 253) + 1),
    mach_id: "MACH-" + pad2(index % 32),
    name: "测试" + ["交易", "下单", "行情", "风控", "账户"][index % 5],
    succ: succVal
  };
}

async function seedTable(conn, tableName, suffix) {
  var [existRows] = await conn.query("SELECT COUNT(*) AS c FROM " + escapeId(tableName));
  if (existRows[0].c >= rowsPerTable) {
    console.log("  " + tableName + " already has " + existRows[0].c + " rows, skipped");
    return;
  }

  await conn.query("DELETE FROM " + escapeId(tableName));

  var cols = [
    "application_name", "log_lvl", "log_date", "log_date_ms",
    "process_id", "thread_id", "module_name", "src_location",
    "processing_stage", "session_id", "time_consuming", "user_id",
    "req_uri", "process_number", "backend_id", "backend_process_id",
    "data_info", "mobile_no", "imei", "version", "os_version",
    "imsi", "mac", "udid", "ip", "mach_id", "name", "succ"
  ];

  var colList = cols.map(escapeId).join(", ");
  var batchSize = 200;
  var inserted = 0;
  for (var i = 0; i < rowsPerTable; i += batchSize) {
    var end = Math.min(i + batchSize, rowsPerTable);
    var valRows = [];
    for (var j = i; j < end; j += 1) {
      var row = rowFor(j, suffix);
      valRows.push([
        row.application_name, row.log_lvl, row.log_date, row.log_date_ms,
        row.process_id, row.thread_id, row.module_name, row.src_location,
        row.processing_stage, row.session_id, row.time_consuming, row.user_id,
        row.req_uri, row.process_number, row.backend_id, row.backend_process_id,
        row.data_info, row.mobile_no, row.imei, row.version, row.os_version,
        row.imsi, row.mac, row.udid, row.ip, row.mach_id, row.name, row.succ
      ]);
    }
    var placeholders = valRows.map(function() {
      return "(" + cols.map(function() { return "?"; }).join(", ") + ")";
    }).join(", ");
    var sql = "INSERT INTO " + escapeId(tableName) + " (" + colList + ") VALUES " + placeholders;
    var flat = [];
    valRows.forEach(function(v) { flat = flat.concat(v); });
    await conn.query(sql, flat);
    inserted += valRows.length;
    process.stdout.write("\r  " + tableName + ": " + inserted + "/" + rowsPerTable);
  }
  process.stdout.write("\n");
  console.log("  " + tableName + " seeded: " + inserted + " rows");
}

function escapeId(name) {
  return "`" + name.replace(/`/g, "``") + "`";
}

config.loadConfig("ATMngWebServer.conf", "c").then(async function(ret) {
  var dbConfig = ret.db || {};
  var namesRaw = String(dbConfig.names || "").trim();
  var entries = namesRaw.split(",").map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });

  var tradeLogCfg = ret.tradeLog || {};
  var tablePrefix = String(tradeLogCfg.tablePrefix || "TBL_TRADE_LOG_");

  if (entries.length === 0) {
    console.error("No databases configured in <db> names field");
    process.exit(1);
  }

  var host = process.env.DB_HOST || dbConfig.host || "127.0.0.1";
  var port = parseInt(process.env.DB_PORT || dbConfig.port || "3306", 10);
  var user = process.env.DB_USER || dbConfig.user || "root";
  var pass = process.env.DB_PASS || dbConfig.pass || dbConfig.password || "";

  console.log("Table prefix: " + tablePrefix);
  console.log("Tables per DB: " + tableCount + ", rows per table: " + rowsPerTable);
  console.log("Host: " + host + ":" + port + ", user: " + user);
  console.log("");

  for (var ei = 0; ei < entries.length; ei += 1) {
    var dbName = entries[ei];

    console.log("=== " + dbName + " ===");

    var conn = await mysql.createConnection({ host: host, port: port, user: user, password: pass, charset: "utf8" });

    await conn.query("CREATE DATABASE IF NOT EXISTS " + escapeId(dbName) + " DEFAULT CHARSET utf8");
    await conn.query("USE " + escapeId(dbName));
    console.log("  Database ready: " + dbName);

    for (var day = 0; day < tableCount; day += 1) {
      var suffix = dateSuffix(day);
      var tableName = tablePrefix + suffix;
      var ddl = DDL.replace(/%TABLE%/g, tableName);
      await conn.query(ddl);
      console.log("  Table exists: " + tableName);
      await seedTable(conn, tableName, suffix);
    }

    await conn.end();
    console.log("");
  }

  console.log("Done. All databases seeded.");
  process.exit(0);
}).catch(function(err) {
  console.error("Seed failed:", err.message || String(err));
  process.exit(1);
});