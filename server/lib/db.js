"use strict";

var mysql = require("mysql2/promise");

var pools = {};
var databaseNames = [];

function init(dbConfig) {
  var namesRaw = dbConfig && dbConfig.names ? String(dbConfig.names) : "";
  var entries = namesRaw.split(",").map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });

  if (entries.length === 0) {
    return;
  }

  var poolOpts = {
    host: process.env.DB_HOST || dbConfig.host || "127.0.0.1",
    port: parseInt(process.env.DB_PORT || dbConfig.port || "3306", 10),
    user: process.env.DB_USER || dbConfig.user || "root",
    password: process.env.DB_PASS || dbConfig.pass || dbConfig.password || "",
    charset: dbConfig.charset || "utf8",
    connectionLimit: parseInt(dbConfig.connectionLimit || "10", 10),
    dateStrings: true,
    supportBigNumbers: false
  };

  entries.forEach(function(dbName) {
    var poolOptsCopy = {};
    Object.keys(poolOpts).forEach(function(k) { poolOptsCopy[k] = poolOpts[k]; });
    poolOptsCopy.database = dbName;
    var pool = mysql.createPool(poolOptsCopy);
    pool.on("connection", function() {
      console.log("MySQL connection established: " + dbName + " @ " + poolOpts.host + ":" + poolOpts.port);
    });
    pools[dbName] = pool;
    databaseNames.push(dbName);
  });

  global.dbPool = pools;
}

function names() {
  return databaseNames.slice();
}

function query(dbName, sql, params) {
  var pool = pools[dbName];
  if (!pool) {
    return Promise.reject(new Error("no database pool for: " + dbName));
  }
  return pool.query(sql, params || []).then(function(result) {
    return result[0];
  });
}

function tableExists(dbName, tableName) {
  return query(dbName,
    "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [tableName]
  ).then(function(rows) {
    return (rows[0] && rows[0].c > 0);
  });
}

function verify() {
  return Promise.all(databaseNames.map(function(dbName) {
    return query(dbName, "SELECT 1 AS ok").then(function() {
      console.log("Database connected: " + dbName);
      return { db: dbName, ok: true };
    }).catch(function(err) {
      console.log("Database connect failed: " + dbName + " - " + (err.message || String(err)));
      return { db: dbName, ok: false, error: err.message };
    });
  }));
}

function end() {
  return Promise.all(databaseNames.map(function(dbName) {
    return pools[dbName].end();
  }));
}

module.exports = {
  init: init,
  names: names,
  query: query,
  tableExists: tableExists,
  verify: verify,
  end: end
};