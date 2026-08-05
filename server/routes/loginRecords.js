"use strict";

var express = require("express");
var db = require("../lib/db");
var logger = require("../lib/logger");
var tableCache = require("../lib/tableMetadataCache");

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
  succ:     { col: "succ",     exact: true  },
  imei:     { col: "imei", exact: true },
  imsi:     { col: "imsi", exact: true },
  ip:       { col: "ip",   exact: true },
  mac:      { col: "mac",  exact: true },
  udid:     { col: "udid", exact: true }
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

// 这些索引字段任一有值即可免除日期必填
function hasIndexFilter(req) {
  var keys = ["username", "user_id", "mobile", "mobile_no", "imei", "imsi", "ip", "mac", "udid"];
  for (var i = 0; i < keys.length; i += 1) {
    if (String(req.query[keys[i]] || "").trim()) return true;
  }
  return false;
}

// 仅查询请求/响应阶段的日志，可在 conf 的 tradeLog.queryStages 配置
var DEFAULT_STAGES = ["CLIREQ", "CLIRES", "req", "rsp"];
function getQueryStages() {
  try {
    var cfg = global.CONFIG && global.CONFIG.tradeLog;
    if (cfg && cfg.queryStages) {
      var arr = String(cfg.queryStages)
        .split(",")
        .map(function(s) { return s.trim(); })
        .filter(Boolean);
      if (arr.length) return arr;
    }
  } catch (e) {}
  return DEFAULT_STAGES;
}

function getStageFilter() {
  var stages = getQueryStages().map(function(s) {
    return "'" + s.replace(/'/g, "''") + "'";
  }).join(",");
  return "(`processing_stage` IN (" + stages + "))";
}

function buildWhere(req) {
  var where = [getStageFilter()];
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
    sql: "WHERE " + where.join(" AND "),
    params: params
  };
}

function escapeId(name) {
  return "`" + name.replace(/`/g, "``") + "`";
}

function escapeStr(name) {
  return "'" + name.replace(/'/g, "''") + "'";
}

function extractDate(datetime) {
  return String(datetime || "").substring(0, 10);
}

function getMaxDaySpan() {
  var span = 7;
  try {
    var cfg = global.CONFIG && global.CONFIG.tradeLog;
    if (cfg && cfg.maxDaySpan) {
      var n = parseInt(cfg.maxDaySpan, 10);
      if (n > 0) span = n;
    }
  } catch (e) {}
  return span;
}

// 与详情弹窗字段顺序保持一致，便于导出后核对
var CSV_HEADERS = [
  "接口名", "用户ID", "手机号", "结果", "处理阶段", "日期",
  "接口号", "耗时(ms)", "数据来源库", "数据来源表", "应用名", "日志级别",
  "毫秒时间", "进程ID", "线程ID", "模块名", "源码位置", "会话ID",
  "组号", "柜台标识", "柜台接口号", "数据信息", "IMEI", "版本",
  "OS版本", "IMSI", "MAC", "UDID", "IP", "设备ID", "记录ID"
];

var CSV_FIELDS = [
  "name", "user_id", "mobile_no", "succ", "processing_stage", "log_date",
  "req_uri", "time_consuming", "source_db", "source_table", "application_name", "log_lvl",
  "log_date_ms", "process_id", "thread_id", "module_name", "src_location", "session_id",
  "process_number", "backend_id", "backend_process_id", "data_info", "imei", "version",
  "os_version", "imsi", "mac", "udid", "ip", "mach_id", "id"
];

function succTextValue(value) {
  if (value === 1) return "成功";
  if (value === 0) return "失败";
  return "未知";
}

function csvCell(value) {
  if (value == null) return "";
  var s = String(value);
  // 日期时间字段用 ="... " 公式形式输出，避免 Excel 打开时按日期格式显示丢掉秒
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    return '"=""' + s + '"""';
  }
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function generateCSV(records) {
  var lines = [CSV_HEADERS.map(csvCell).join(",")];
  records.forEach(function(record) {
    lines.push(CSV_FIELDS.map(function(col) {
      return csvCell(col === "succ" ? succTextValue(record[col]) : record[col]);
    }).join(","));
  });
  return lines.join("\r\n");
}

// 导出全量匹配记录（不分页，带行数上限保护）
var MAX_EXPORT_ROWS = 100000;

router.get("/login-records/export", async function(req, res, next) {
  try {
    var indexFilterPresent = hasIndexFilter(req);
    var startDate = parseDate(req.query.startDate || req.query.date);
    var endDate = parseDate(req.query.endDate || req.query.date);

    if (!indexFilterPresent && (!startDate || !endDate)) {
      res.status(400).json({ error: "请选择正确的开始日期和结束日期（按天分表查询需明确日期范围；若不指定日期，请通过用户ID/手机号/IMEI/IMSI/IP/MAC/UDID等精确筛选）" });
      return;
    }
    if (startDate && endDate && startDate > endDate) {
      res.status(400).json({ error: "开始日期不能晚于结束日期" });
      return;
    }

    var isAsc = String(req.query.order || "").toLowerCase() === "asc";
    var databaseNames = db.names();
    var dateList = [];
    if (startDate && endDate) {
      var current = new Date(startDate.getTime());
      while (current <= endDate) {
        dateList.push(formatDate(current));
        current = new Date(current.getTime() + 86400000);
      }
    }

    var filter = buildWhere(req);

    var tableInfos;
    if (dateList.length > 0) {
      tableInfos = tableCache.getTableCounts(databaseNames, dateList);
    } else {
      tableInfos = tableCache.getAllTables(databaseNames);
    }
    var found = tableInfos.filter(function(t) { return t.exists; });

    logger.query.debug(
      "[login-records/export] start: range=" + (startDate ? formatDate(startDate) : "-") + "~" + (endDate ? formatDate(endDate) : "-") +
      " indexFilter=" + (indexFilterPresent ? "yes" : "no") +
      " foundTables=" + found.length + " order=" + (isAsc ? "asc" : "desc")
    );

    var selectColsStr = SELECT_COLS.map(escapeId).join(",");
    var allRows = [];

    if (found.length > 0) {
      var dateGroups = {};
      found.forEach(function(pair) {
        if (!dateGroups[pair.date]) dateGroups[pair.date] = [];
        dateGroups[pair.date].push(pair);
      });
      var sortedDates = Object.keys(dateGroups).sort();
      if (!isAsc) sortedDates.reverse();

      var dir = isAsc ? "ASC" : "DESC";

      for (var di = 0; di < sortedDates.length && allRows.length < MAX_EXPORT_ROWS; di++) {
        var date = sortedDates[di];
        var pairs = dateGroups[date];
        var limit = MAX_EXPORT_ROWS - allRows.length;

        var dbResults = await Promise.all(pairs.map(function(pair) {
          var sql = "SELECT " + selectColsStr + ", " + escapeStr(pair.table) + " AS source_table FROM " + escapeId(pair.table);
          var params = [];
          if (filter.sql) {
            sql += " WHERE " + filter.sql.substring(6);
            params = params.concat(filter.params);
          }
          sql += " ORDER BY log_date " + dir + ", log_date_ms " + dir + ", id " + dir + " LIMIT " + limit;

          return db.query(pair.db, sql, params).then(function(resultRows) {
            resultRows.forEach(function(row) {
              row.source_db = pair.db;
            });
            return resultRows;
          }).catch(function(err) {
            logger.error.error("[login-records/export] fetch failed: db=" + pair.db + " table=" + pair.table + " err=" + (err && err.message ? err.message : err));
            return [];
          });
        }));

        dbResults.forEach(function(b) { allRows = allRows.concat(b); });
      }
    }

    var truncated = allRows.length >= MAX_EXPORT_ROWS;
    if (truncated) allRows = allRows.slice(0, MAX_EXPORT_ROWS);

    var csv = generateCSV(allRows);
    var fileStamp = startDate ? (formatDate(startDate) + "_" + (endDate ? formatDate(endDate) : "")) : "all";
    var filename = "trade_log_" + fileStamp + ".csv";

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="' + filename + '"');
    res.setHeader("X-Export-Rows", String(allRows.length));
    if (truncated) res.setHeader("X-Export-Truncated", "1");
    // BOM 头，确保 Excel 正确识别 UTF-8 中文
    res.send("\ufeff" + csv);

    logger.query.debug("[login-records/export] done: rows=" + allRows.length + " truncated=" + truncated);
  } catch (err) {
    next(err);
  }
});

router.get("/login-records", async function(req, res, next) {
  try {
    var indexFilterPresent = hasIndexFilter(req);
    var startDate = parseDate(req.query.startDate || req.query.date);
    var endDate = parseDate(req.query.endDate || req.query.date);

    // 无索引筛选时，日期范围为必填
    if (!indexFilterPresent && (!startDate || !endDate)) {
      res.status(400).json({ error: "请选择正确的开始日期和结束日期（按天分表查询需明确日期范围；若不指定日期，请通过用户ID/手机号/IMEI/IMSI/IP/MAC/UDID等精确筛选）" });
      return;
    }
    if (startDate && endDate && startDate > endDate) {
      res.status(400).json({ error: "开始日期不能晚于结束日期" });
      return;
    }

    var pageSize = Math.min(
      Math.max(parseInt(req.query.pageSize || req.query.limit || "50", 10) || 50, 1), 200
    );
    var isAsc = String(req.query.order || "").toLowerCase() === "asc";

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
      " pageSize=" + pageSize + " order=" + (isAsc ? "asc" : "desc") +
      " dbs=" + databaseNames.join(",") +
      " dates=[" + dateList.join(",") + "]"
    );

    var filter = buildWhere(req);

    var afterCursor = null;
    if (req.query.afterDate) {
      afterCursor = {
        log_date: String(req.query.afterDate || ""),
        log_date_ms: parseInt(req.query.afterMs, 10) || 0,
        id: parseInt(req.query.afterId, 10) || 0,
        table: String(req.query.afterTable || "")
      };
    }

    var tableInfos;
    if (dateList.length > 0) {
      tableInfos = tableCache.getTableCounts(databaseNames, dateList);
    } else {
      tableInfos = tableCache.getAllTables(databaseNames);
    }

    var found = tableInfos.filter(function(t) { return t.exists; });
    var missing = tableInfos.filter(function(t) { return !t.exists && dateList.length > 0; });
    var failedDbs = [];

    logger.query.debug(
      "[login-records] cache: foundTables=" + found.length + " missingTables=" + missing.length +
      " failedDbs=[" + failedDbs.join(",") + "]" +
      " cursor=" + (afterCursor ? (afterCursor.log_date + "|" + afterCursor.log_date_ms + "|" + afterCursor.id + "|" + afterCursor.table) : "none")
    );

    var rows = [];
    var hasMore = false;
    var nextCursor = null;

    if (found.length > 0) {
      var selectColsStr = SELECT_COLS.map(escapeId).join(",");
      var cursorDate = afterCursor ? extractDate(afterCursor.log_date) : null;

      var dateGroups = {};
      found.forEach(function(pair) {
        if (!dateGroups[pair.date]) dateGroups[pair.date] = [];
        dateGroups[pair.date].push(pair);
      });
      var sortedDates = Object.keys(dateGroups).sort();
      if (!isAsc) sortedDates.reverse();

      var remaining = pageSize + 1;
      var allRows = [];

      for (var di = 0; di < sortedDates.length && remaining > 0; di++) {
        var date = sortedDates[di];

        if (cursorDate && (isAsc ? date < cursorDate : date > cursorDate)) continue;

        var isCursorDate = cursorDate && date === cursorDate;
        var pairs = dateGroups[date];
        var op = isAsc ? ">" : "<";
        var dir = isAsc ? "ASC" : "DESC";

        var dbResults = await Promise.all(pairs.map(function(pair) {
          var sql = "SELECT " + selectColsStr + ", " + escapeStr(pair.table) + " AS source_table FROM " + escapeId(pair.table);
          var parts = [];
          var params = [];
          if (filter.sql) {
            parts.push(filter.sql.substring(6));
            params = params.concat(filter.params);
          }
          if (isCursorDate && afterCursor) {
            parts.push("(log_date, log_date_ms, id, " + escapeStr(pair.table) + ") " + op + " (?, ?, ?, ?)");
            params.push(afterCursor.log_date, afterCursor.log_date_ms, afterCursor.id, afterCursor.table);
          }
          if (parts.length > 0) {
            sql += " WHERE " + parts.join(" AND ");
          }
          sql += " ORDER BY log_date " + dir + ", log_date_ms " + dir + ", id " + dir + " LIMIT " + remaining;

          return db.query(pair.db, sql, params).then(function(resultRows) {
            resultRows.forEach(function(row) {
              row.source_db = pair.db;
            });
            return resultRows;
          }).catch(function(err) {
            logger.error.error("[login-records] fetch failed: db=" + pair.db + " table=" + pair.table + " err=" + (err && err.message ? err.message : err));
            return [];
          });
        }));

        var dateRows = [];
        dbResults.forEach(function(b) { dateRows = dateRows.concat(b); });
        dateRows.sort(function(a, b) {
          if (a.log_date !== b.log_date) {
            return isAsc ? (a.log_date < b.log_date ? -1 : 1) : (a.log_date < b.log_date ? 1 : -1);
          }
          if (a.log_date_ms !== b.log_date_ms) return isAsc ? a.log_date_ms - b.log_date_ms : b.log_date_ms - a.log_date_ms;
          if (a.id !== b.id) return isAsc ? a.id - b.id : b.id - a.id;
          return isAsc
            ? (a.source_table || "").localeCompare(b.source_table || "")
            : (b.source_table || "").localeCompare(a.source_table || "");
        });
        allRows = allRows.concat(dateRows);
        remaining = pageSize + 1 - allRows.length;
      }

      hasMore = allRows.length > pageSize;
      rows = allRows.slice(0, pageSize);

      if (hasMore && rows.length > 0) {
        var last = rows[rows.length - 1];
        nextCursor = {
          db: last.source_db,
          table: last.source_table,
          log_date: last.log_date,
          log_date_ms: last.log_date_ms,
          id: last.id
        };
      }
    }

    logger.query.debug(
      "[login-records] query done: range=" + (startDate ? formatDate(startDate) : "-") + "~" + (endDate ? formatDate(endDate) : "-") +
      " foundTables=" + found.length + " missingTables=" + missing.length +
      " failedDbs=[" + failedDbs.join(",") + "]" +
      " returned=" + rows.length + " hasMore=" + hasMore
    );

    res.json({
      data: rows,
      pagination: {
        pageSize: pageSize,
        hasMore: hasMore,
        nextCursor: nextCursor
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