"use strict";

var express = require("express");
var db = require("../lib/db");

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
  username: { col: "user_id", exact: false },
  user_id:  { col: "user_id", exact: false },
  ip:       { col: "ip",      exact: false },
  mobile:   { col: "mobile_no", exact: false },
  mobile_no: { col: "mobile_no", exact: false },
  version:  { col: "version", exact: false },
  os_version: { col: "os_version", exact: false },
  processing_stage: { col: "processing_stage", exact: false },
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
  return prefix + date.replace(/-/g, "");
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
    var startDate = parseDate(req.query.startDate || req.query.date);
    var endDate = parseDate(req.query.endDate || req.query.date);

    if (!startDate || !endDate) {
      res.status(400).json({ error: "请选择正确的开始日期和结束日期" });
      return;
    }
    if (startDate > endDate) {
      res.status(400).json({ error: "开始日期不能晚于结束日期" });
      return;
    }

    var dayCount = Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
    if (dayCount > 31) {
      res.status(400).json({ error: "日期区间不能超过 31 天" });
      return;
    }

    var page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
    var pageSize = Math.min(
      Math.max(parseInt(req.query.pageSize || req.query.limit || "50", 10) || 50, 1), 200
    );
    var offset = (page - 1) * pageSize;

    var databaseNames = db.names();
    var dateList = [];
    var current = new Date(startDate.getTime());
    while (current <= endDate) {
      dateList.push(formatDate(current));
      current = new Date(current.getTime() + 86400000);
    }

    var tablePrefix = "";
    if (global.CONFIG && global.CONFIG.tradeLog) {
      tablePrefix = String(global.CONFIG.tradeLog.tablePrefix || "TBL_TRADE_LOG_");
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

    var dbResults = await Promise.all(databaseNames.map(async function(dbName) {
      try {
        var placeholders = tableNamesByDate.map(function() { return "?"; }).join(",");
        var rows = await db.query(dbName,
          "SELECT table_name AS t FROM information_schema.tables " +
          "WHERE table_schema = DATABASE() AND table_name IN (" + placeholders + ")",
          tableNamesByDate
        );
        var existingSet = new Set(rows.map(function(r) { return r.t; }));
        var dbFound = [];
        var dbMissing = [];
        dateList.forEach(function(d) {
          var t = dateToTable[d];
          var item = { db: dbName, table: t, date: d };
          if (existingSet.has(t)) {
            dbFound.push(item);
          } else {
            dbMissing.push(item);
          }
        });
        return { dbName: dbName, found: dbFound, missing: dbMissing, error: null };
      } catch (err) {
        return { dbName: dbName, found: [], missing: [], error: String(err.message || err) };
      }
    }));

    dbResults.forEach(function(r) {
      if (r.error) {
        failedDbs.push(r.dbName);
      }
      found = found.concat(r.found);
      missing = missing.concat(r.missing);
    });

    var filter = buildWhere(req);

    var total = 0;
    var countResults = await Promise.all(found.map(function(pair) {
      return db.query(pair.db,
        "SELECT COUNT(*) AS c FROM " + escapeId(pair.table) + " " + filter.sql,
        filter.params
      ).then(function(rows) {
        return rows[0].c;
      }).catch(function() {
        return 0;
      });
    }));
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
        }).catch(function() {
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
        startDate: formatDate(startDate),
        endDate: formatDate(endDate)
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;