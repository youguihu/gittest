"use strict";

var db = require("./db");
var tradeLogTables = require("./tradeLogTables");

var cache = {
  databases: {},
  ready: false,
  tablePrefix: "",
  template: "YYYYMMDD"
};

function todayStr() {
  var now = new Date();
  var y = now.getUTCFullYear();
  var m = String(now.getUTCMonth() + 1).padStart(2, "0");
  var d = String(now.getUTCDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

function escapeId(name) {
  return "`" + name.replace(/`/g, "``") + "`";
}

async function scanDb(dbName) {
  var lowerPrefix = cache.tablePrefix.toLowerCase();
  var rows = await db.query(dbName,
    "SELECT table_name, table_rows FROM information_schema.tables " +
    "WHERE table_schema = ? AND LOWER(table_name) LIKE ?",
    [dbName, lowerPrefix + "%"]
  );

  var today = todayStr();
  var dbCache = {};
  rows.forEach(function(r) {
    var rawName = r.table_name || r.TABLE_NAME || "";
    var rowCount = parseInt(r.table_rows || r.TABLE_ROWS || "0", 10) || 0;
    dbCache[rawName.toLowerCase()] = {
      tableName: rawName,
      rowCount: rowCount,
      isToday: false
    };
  });

  var prefix = cache.tablePrefix;
  var template = cache.template;
  var todayTableName = (prefix + tradeLogTables.formatSuffix(template, today)).toLowerCase();
  if (dbCache[todayTableName]) {
    dbCache[todayTableName].isToday = true;
  }

  return { dbName: dbName, tables: dbCache };
}

async function init() {
  var dbNames = db.names();

  if (global.CONFIG && global.CONFIG.tradeLog) {
    cache.tablePrefix = String(global.CONFIG.tradeLog.tablePrefix || "TBL_TRADE_LOG_");
    cache.template = tradeLogTables.templateFromConfig(global.CONFIG.tradeLog);
  }

  var results = await Promise.all(dbNames.map(function(name) {
    return scanDb(name).catch(function(err) {
      global.logger && global.logger.error && global.logger.error.error(
        "[tableMetadataCache] scan failed: db=" + name + " err=" + (err.message || String(err))
      );
      return { dbName: name, tables: {} };
    });
  }));

  cache.databases = {};
  results.forEach(function(r) {
    cache.databases[r.dbName] = r.tables;
  });
  cache.ready = true;

  var totalTables = 0;
  results.forEach(function(r) {
    totalTables += Object.keys(r.tables).length;
  });
  global.logger && global.logger.data && global.logger.data.debug(
    "[tableMetadataCache] initialized: " + dbNames.length + " dbs, " + totalTables + " tables"
  );
}

async function refresh() {
  var dbNames = db.names();
  var results = await Promise.all(dbNames.map(function(name) {
    return scanDb(name).catch(function(err) {
      global.logger && global.logger.error && global.logger.error.error(
        "[tableMetadataCache] refresh scan failed: db=" + name + " err=" + (err.message || String(err))
      );
      return null;
    });
  }));

  results.forEach(function(r) {
    if (r) {
      cache.databases[r.dbName] = r.tables;
    }
  });

  global.logger && global.logger.data && global.logger.data.debug(
    "[tableMetadataCache] refreshed"
  );
}

function isReady() {
  return cache.ready;
}

function getTableCounts(dbNames, dateList) {
  var result = [];
  var today = todayStr();
  var prefix = cache.tablePrefix;
  var template = cache.template;

  dbNames.forEach(function(dbName) {
    var dbCache = cache.databases[dbName];
    if (!dbCache) return;
    dateList.forEach(function(date) {
      var tableName = prefix + tradeLogTables.formatSuffix(template, date);
      var info = dbCache[tableName.toLowerCase()];
      result.push({
        db: dbName,
        table: info ? info.tableName : tableName,
        date: date,
        rowCount: info ? info.rowCount : 0,
        isToday: date === today,
        exists: !!info
      });
    });
  });
  return result;
}

function getAllTables(dbNames) {
  var result = [];
  var template = cache.template;
  var prefix = cache.tablePrefix;
  var lowerPrefix = prefix.toLowerCase();

  dbNames.forEach(function(dbName) {
    var dbCache = cache.databases[dbName];
    if (!dbCache) return;
    Object.keys(dbCache).forEach(function(lowerKey) {
      var info = dbCache[lowerKey];
      var tableName = info.tableName;
      var lowerT = tableName.toLowerCase();
      var suffix = lowerT.indexOf(lowerPrefix) === 0 ? tableName.slice(prefix.length) : "";
      var date = tradeLogTables.parseSuffix(template, suffix);
      result.push({
        db: dbName,
        table: tableName,
        date: date,
        rowCount: info.rowCount,
        isToday: info.isToday,
        exists: true
      });
    });
  });
  return result;
}

module.exports = {
  init: init,
  refresh: refresh,
  isReady: isReady,
  getTableCounts: getTableCounts,
  getAllTables: getAllTables
};