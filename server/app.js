"use strict";

var express = require("express");
var path = require("path");
var bodyParser = require("body-parser");
var cookieParser = require("cookie-parser");
var logger = require("./lib/logger");
var loginRecords = require("./routes/loginRecords");
var auth = require("./lib/auth");
var authRoutes = require("./routes/auth");
var users = require("./routes/users");
var dbQuery = require("./routes/dbQuery");

var app = express();

app.use(function(req, res, next) {
  var conf = global.CONFIG && global.CONFIG.server;
  var basePath = conf && conf.basePath ? conf.basePath : "";
  if (basePath === "" || basePath === "/") return next();
  var url = req.url;
  if (url === basePath || url.indexOf(basePath + "/") === 0 || url.indexOf(basePath + "?") === 0) {
    var rest = url.slice(basePath.length);
    if (rest === "" || rest.charAt(0) === "?") {
      return res.redirect(301, basePath + "/" + (rest.charAt(0) === "?" ? rest.slice(1) : ""));
    }
    req.url = rest;
  }
  next();
});

app.use(logger.morgan_taf_log());
app.use(bodyParser.json({ limit: "64kb" }));
app.use(bodyParser.urlencoded({ extended: false, limit: "64kb" }));
app.use(cookieParser());
app.use(auth.attachUser);

app.use("/api/auth", authRoutes);
app.use("/api/meta", function(req, res) {
  var systemName = "交易日志";
  var maxExportRows = 100000;

  if (global.CONFIG && global.CONFIG.server && global.CONFIG.server.systemName) {
    systemName = global.CONFIG.server.systemName;
  }
  if (global.CONFIG && global.CONFIG.tradeLog && global.CONFIG.tradeLog.maxExportRows) {
    var parsed = parseInt(global.CONFIG.tradeLog.maxExportRows, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      maxExportRows = parsed;
    }
  }

  res.json({
    systemName: systemName,
    dbQueryEnabled: dbQuery.dbQueryEnabled(),
    maxExportRows: maxExportRows
  });
});
app.use("/api", auth.requireLogin, loginRecords);
app.use("/api", auth.requireLogin, users);
app.use("/api", auth.requireLogin, dbQuery);
app.use(express.static(path.join(__dirname, "client", "public")));

app.get("*", function(req, res) {
  res.sendFile(path.join(__dirname, "client", "public", "index.html"));
});

app.use(function(err, req, res, next) {
  logger.error.error(err && err.stack ? err.stack : String(err));
  res.status(err.status || 500).json({ error: "系统异常，请稍后重试" });
});

module.exports = app;

if (require.main === module) {
  require("./bin/www");
}
