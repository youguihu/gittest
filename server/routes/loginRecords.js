"use strict";

var express = require("express");
var db = require("../lib/db");
var logger = require("../lib/logger");
var tradeLogTables = require("../lib/tradeLogTables");

var router = express.Router();

var SELECT_COLS = [
  "id", "application_name", "log_lvl", "log_date", "log_date_ms",
  "process_id", "thread_id", "module_name", "src_location",
  "processing_stage", "session_id", "time_consuming", "user_id",
  "req_uri", "process_number", "backend_id", "backend_process_id",
  "data_info", "mobile_no", "imei", "version", "os_version",
  "imsi", "mac", "udid", "ip", "mach_id", "name", "succ"
];

var FILTER_MAP = {
  username: { col: "user_id", exact: true },
  user_id:  { col: "user_id", exact: true },
  mobile:   { col: "mobile_no", exact: true },
  mobile_no: { col: "mobile_no", exact: true },
  processing_stage: { col: "processing_stage", exact: false },
  name:     { col: "name",   exact: false },
  module_name: { col: "module_name", exact: false },
  req_uri:  { col: "req_uri",  exact: false },
  log_lvl:  { col: "log_lvl",  exact: false },
  succ:     { col: "succ",     exact: true  }
};

function normalizeDate(value) {
  var date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return date;
}

function parseDate(value) {
  var normalized = normalizeDate(value);
  if (!normalized) return null;
  var date = new Date(normalized + "T00:00:00Z");
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDate(date) {
  var year = date.getUTCFullYear();
  var month = String(date.getUTCMonth() + 1).padStart(2, "0");
  var day = String(date.getUTCDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function tableNameFromDate(date) {
  var config = global.CONFIG && global.CONFIG.tradeLog ? global.CONFIG.tradeLog : {};
  var prefix = String(config.tablePrefix || "TBL_TRADE_LOG_");
  if (!/^[a-zA-Z0-9_]+$/.test(prefix)) {
    prefix = "TBL_TRADE_LOG_";
  }
  var template = tradeLogTables.templateFromConfig(config);
  return prefix + tradeLogTables.formatSuffix(template, date);
}

// 这三个索引字段任一有值即可免除日期必填和 31 天上限
function hasIndexFilter(req) {
  var keys = ["username", "user_id", "mobile", "mobile_no", "name"];
  for (var i = 0; i < keys.length; i += 1) {
    if (String(req.query[keys[i]] || "").trim()) return true;
  }
  return false;
}

function buildWhere(req) {
  var where = [];
  var params = [];

  Object.keys(FILTER_MAP).forEach(function(key) {
    var value = String(req.query[key] || "").trim();
    if (!value) return;

    var mapping = FILTER_MAP[key];
    if (mapping.exact) {
      where.push("`" + mapping.col + "` = ?");
      params.push(mapping.col === "succ" ? parseInt(value, 10) : value);
    } else {
      where.push("`" + mapping.col + "` LIKE ?");
      params.push("%" + value + "%");
    }
  });

  return {
    sql: where.length ? "WHERE " + where.join(" AND ") : "",
    params: params
  };
}

function escapeId(name) {
  return "`" + name.replace(/`/g, "``") + "`";
}

function escapeStr(name) {
  return "'" + name.replace(/'/g, "''") + "'";
}

function rowSort(a, b) {
  if (a.log_date !== b.log_date) {
    return a.log_date < b.log_date ? 1 : -1;
  }
  var aMs = parseInt(a.log_date_ms || 0, 10);
  var bMs = parseInt(b.log_date_ms || 0, 10);
  if (aMs !== bMs) {
    return aMs < bMs ? 1 : -1;
  }
  return (b.id - a.id);
}

router.get("/login-records", async function(req, res, next) {
  try {
    var indexFilterPresent = hasIndexFilter(req);
    var startDate = parseDate(req.query.startDate || req.query.date);
    var endDate = parseDate(req.query.endDate || req.query.date);

    // 无索引筛选时，日期范围为必填
    if (!indexFilterPresent && (!startDate || !endDate)) {
      res.status(400).json({ error: "请选择正确的开始日期和结束日期（按天分表查询需明确日期范围；若不指定日期，请通过用户ID/手机号/名称等精确筛选）" });
      return;
    }
    if (startDate && endDate && startDate > endDate) {
      res.status(400).json({ error: "开始日期不能晚于结束日期" });
      return;
    }

    // 最大日期跨度仅在无索引筛选时生效，默认 7 天，可通过 conf 的 tradeLog.maxDaySpan 修改
    var maxDaySpan = 7;
    if (global.CONFIG && global.CONFIG.tradeLog && global.CONFIG.tradeLog.maxDaySpan) {
      var confSpan = parseInt(global.CONFIG.tradeLog.maxDaySpan, 10);
      if (!Number.isNaN(confSpan) && confSpan > 0) maxDaySpan = confSpan;
    }
    if (!indexFilterPresent && startDate && endDate) {
      var dayCount = Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
      if (dayCount > maxDaySpan) {
        res.status(400).json({ error: "日期区间不能超过 " + maxDaySpan + " 天（按天分表查询，跨度过大会扫描过多分表，影响性能；请缩小范围，或通过用户ID/手机号/名称等精确筛选以解除日期限制）" });
        return;
      }
    }

    var page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
    var pageSize = Math.min(
      Math.max(parseInt(req.query.pageSize || req.query.limit || "50", 10) || 50, 1), 200
    );
    var offset = (page - 1) * pageSize;

    var databaseNames = db.names();
    var dateList = [];
    if (startDate && endDate) {
      var current = new Date(startDate.getTime());
      while (current <= endDate) {
        dateList.push(formatDate(current));
        current = new Date(current.getTime() + 86400000);
      }
    }

    logger.query.debug(
      "[login-records] query req: range=" + (startDate ? formatDate(startDate) : "-") + "~" + (endDate ? formatDate(endDate) : "-") +
      " indexFilter=" + (indexFilterPresent ? "yes" : "no") +
      " filters=" + JSON.stringify(Object.keys(FILTER_MAP).filter(function(k) {
        return String(req.query[k] || "").trim();
      }).reduce(function(acc, k) {
        acc[k] = req.query[k];
        return acc;
      }, {})) +
      " page=" + page + " pageSize=" + pageSize +
      " dbs=" + databaseNames.join(",") +
      " dates=[" + dateList.join(",") + "]"
    );

    var tablePrefix = "";
    var tableSuffixTemplate = "YYYYMMDD";
    if (global.CONFIG && global.CONFIG.tradeLog) {
      tablePrefix = String(global.CONFIG.tradeLog.tablePrefix || "TBL_TRADE_LOG_");
      tableSuffixTemplate = tradeLogTables.templateFromConfig(global.CONFIG.tradeLog);
    }

    var found = [];
    var missing = [];
    var failedDbs = [];

    var tableNamesByDate = dateList.map(function(d) {
      return tableNameFromDate(d);
    });

    var dateToTable = {};
    dateList.forEach(function(d, i) {
      dateToTable[d] = tableNamesByDate[i];
    });

    var filter = buildWhere(req);

    // discovery：每个库 1 条 information_schema 查询，LOWER 兼容表名存储大小写差异
    // （部分实例按小写存储表名，如 tbl_trade_log_2023_10_13）
    var dbResults;
    if (dateList.length > 0) {
      var lowerNames = tableNamesByDate.map(function(n) { return n.toLowerCase(); });
      var placeholders = lowerNames.map(function() { return "?"; }).join(",");
      dbResults = await Promise.all(databaseNames.map(async function(dbName) {
        try {
          var rows = await db.query(dbName,
            "SELECT table_name AS t FROM information_schema.tables " +
            "WHERE table_schema = ? AND LOWER(table_name) IN (" + placeholders + ")",
            [dbName].concat(lowerNames)
          );
          var existing = {};
          rows.forEach(function(r) { existing[r.t.toLowerCase()] = r.t; });
          var dbFound = [];
          var dbMissing = [];
          dateList.forEach(function(d) {
            var t = dateToTable[d];
            var actual = existing[t.toLowerCase()];
            if (actual) {
              dbFound.push({ db: dbName, table: actual, date: d });
            } else {
              dbMissing.push({ db: dbName, table: t, date: d });
            }
          });
          return { dbName: dbName, found: dbFound, missing: dbMissing, error: null };
        } catch (err) {
          return { dbName: dbName, found: [], missing: [], error: String(err.message || err) };
        }
      }));
    } else {
      // 无日期（用户ID等筛选）：枚举所有匹配前缀的表
      var lowerPrefix = String(tablePrefix).toLowerCase();
      dbResults = await Promise.all(databaseNames.map(async function(dbName) {
        try {
          var rows = await db.query(dbName,
            "SELECT table_name AS t FROM information_schema.tables " +
            "WHERE table_schema = ? AND LOWER(table_name) LIKE ?",
            [dbName, lowerPrefix + "%"]
          );
          var dbFound = [];
          var dbMissing = [];
          rows.forEach(function(r) {
            var t = r.t;
            var lowerT = t.toLowerCase();
            var suffix = lowerT.indexOf(lowerPrefix) === 0 ? t.slice(lowerPrefix.length) : "";
            var formatted = tradeLogTables.parseSuffix(tableSuffixTemplate, suffix);
            dbFound.push({ db: dbName, table: t, date: formatted });
          });
          return { dbName: dbName, found: dbFound, missing: dbMissing, error: null };
        } catch (err) {
          return { dbName: dbName, found: [], missing: [], error: String(err.message || err) };
        }
      }));
    }

    dbResults.forEach(function(r) {
      if (r.error) {
        failedDbs.push(r.dbName);
      }
      found = found.concat(r.found);
      missing = missing.concat(r.missing);
    });

    dbResults.forEach(function(r) {
      if (r.error) {
        logger.error.error("[login-records] db=" + r.dbName + " discovery failed: " + r.error);
      } else {
        logger.query.debug(
          "[login-records] db=" + r.dbName +
          " found=[" + r.found.map(function(p) { return p.table; }).join(",") + "]" +
          " missing=[" + r.missing.map(function(p) { return p.table; }).join(",") + "]"
        );
      }
    });

    // 只对存在的表并行计数（连接池限速），表查询失败按 0 计
    var countResults = await Promise.all(found.map(function(pair) {
      return db.query(pair.db,
        "SELECT COUNT(*) AS c FROM " + escapeId(pair.table) + " " + filter.sql,
        filter.params
      ).then(function(rows) {
        return rows[0].c;
      }).catch(function(err) {
        logger.error.error("[login-records] count failed: db=" + pair.db + " table=" + pair.table + " err=" + (err && err.message ? err.message : err));
        return 0;
      });
    }));
    var total = 0;
    countResults.forEach(function(c) { total += c; });

    var rows = [];
    if (found.length > 0 && total > 0) {
      var dbGroup = {};
      found.forEach(function(pair) {
        if (!dbGroup[pair.db]) dbGroup[pair.db] = [];
        dbGroup[pair.db].push(pair);
      });

      var selectColsStr = SELECT_COLS.map(escapeId).join(",");

      var fetchPromises = Object.keys(dbGroup).map(function(dbName) {
        var pairs = dbGroup[dbName];
        var selects = pairs.map(function(pair) {
          return "SELECT " + selectColsStr + ", " + escapeStr(pair.table) + " AS source_table FROM " + escapeId(pair.table) + " " + filter.sql;
        });
        var sql = "SELECT * FROM (" + selects.join(" UNION ALL ") + ") __t";
        var repeatedParams = [];
        pairs.forEach(function() {
          repeatedParams = repeatedParams.concat(filter.params);
        });
        return db.query(dbName, sql, repeatedParams).then(function(resultRows) {
          resultRows.forEach(function(row) {
            row.source_db = dbName;
          });
          return resultRows;
        }).catch(function(err) {
          logger.error.error("[login-records] fetch failed: db=" + dbName + " tables=" + pairs.map(function(p) { return p.table; }).join(",") + " err=" + (err && err.message ? err.message : err));
          return [];
        });
      });

      var fetched = await Promise.all(fetchPromises);
      var allRows = [];
      fetched.forEach(function(batch) {
        allRows = allRows.concat(batch);
      });

      allRows.sort(rowSort);

      rows = allRows.slice(offset, offset + pageSize);
    }

    logger.query.debug(
      "[login-records] query done: range=" + (startDate ? formatDate(startDate) : "-") + "~" + (endDate ? formatDate(endDate) : "-") +
      " foundTables=" + found.length + " missingTables=" + missing.length +
      " failedDbs=[" + failedDbs.join(",") + "]" +
      " total=" + total + " returned=" + rows.length
    );

    res.json({
      data: rows,
      pagination: {
        page: page,
        pageSize: pageSize,
        total: total,
        totalPages: Math.max(Math.ceil(total / pageSize), 1)
      },
      tables: found.map(function(p) { return { db: p.db, table: p.table }; }),
      missingTables: missing.map(function(p) { return { db: p.db, table: p.table }; }),
      failedDbs: failedDbs,
      range: {
        startDate: startDate ? formatDate(startDate) : "",
        endDate: endDate ? formatDate(endDate) : ""
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;