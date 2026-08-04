"use strict";

var express = require("express");
var mysql = require("mysql2/promise");

var router = express.Router();

function dbQueryEnabled() {
  var cfg = global.CONFIG && global.CONFIG.dbQuery ? global.CONFIG.dbQuery : {};
  var v = String(cfg.enabled == null ? "" : cfg.enabled).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function maxRows() {
  var cfg = global.CONFIG && global.CONFIG.dbQuery ? global.CONFIG.dbQuery : {};
  var v = parseInt(cfg.maxRows, 10);
  return v > 0 ? v : 500;
}

function validateConn(body) {
  var host = String(body.host || "").trim();
  var port = parseInt(body.port || "3306", 10);
  var user = String(body.user || "").trim();
  var database = String(body.database || "").trim();
  var charset = String(body.charset || "utf8").trim();
  var password = String(body.password || "");

  if (!host) {
    return { error: "请填写数据库主机" };
  }
  if (!user) {
    return { error: "请填写数据库用户名" };
  }
  if (!database) {
    return { error: "请填写数据库名" };
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { error: "端口不正确" };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(charset)) {
    return { error: "字符集不正确" };
  }

  return {
    conn: {
      host: host,
      port: port,
      user: user,
      password: password,
      database: database,
      charset: charset,
      connectTimeout: 5000
    }
  };
}

router.post("/db-query/execute", async function(req, res, next) {
  try {
    if (!dbQueryEnabled()) {
      res.status(403).json({ error: "数据库查询入口未在配置中启用" });
      return;
    }

    var sql = String(req.body.sql || "").trim();
    if (!sql) {
      res.status(400).json({ error: "请输入要执行的 SQL" });
      return;
    }
    if (sql.length > 10000) {
      res.status(400).json({ error: "SQL 过长（超过 10000 字符）" });
      return;
    }

    var checked = validateConn(req.body);
    if (checked.error) {
      res.status(400).json({ error: checked.error });
      return;
    }

    var max = maxRows();
    var started = Date.now();
    var conn = await mysql.createConnection(checked.conn);
    try {
      var result = await conn.query(sql);
      var rows = result[0];
      var fields = result[1];
      var elapsedMs = Date.now() - started;

      var payload = { elapsedMs: elapsedMs };

      if (fields && fields.length) {
        var truncated = rows.length > max;
        var shown = truncated ? rows.slice(0, max) : rows;
        payload.columns = fields.map(function(f) { return f.name; });
        payload.total = rows.length;
        payload.rowCount = shown.length;
        payload.rows = shown;
        payload.truncated = truncated;
      } else {
        if (Array.isArray(rows)) {
          payload.columns = [];
          payload.rowCount = rows.length;
          payload.rows = rows;
        } else {
          payload.columns = [];
          payload.rowCount = rows.affectedRows != null ? rows.affectedRows : 0;
          if (rows.affectedRows != null) payload.affectedRows = rows.affectedRows;
          if (rows.insertId != null) payload.insertId = rows.insertId;
        }
      }

      res.json(payload);
    } finally {
      conn.end().catch(function() {});
    }
  } catch (err) {
    res.status(400).json({ error: String(err && err.message ? err.message : err) });
  }
});

module.exports = router;
module.exports.dbQueryEnabled = dbQueryEnabled;