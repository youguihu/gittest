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

var app = express();

app.use(logger.morgan_taf_log());
app.use(bodyParser.json({ limit: "64kb" }));
app.use(bodyParser.urlencoded({ extended: false, limit: "64kb" }));
app.use(cookieParser());
app.use(auth.attachUser);

app.use("/api/auth", authRoutes);
app.use("/api/meta", function(req, res) {
  var systemName = "交易日志";
  if (global.CONFIG && global.CONFIG.server && global.CONFIG.server.systemName) {
    systemName = global.CONFIG.server.systemName;
  }
  res.json({ systemName: systemName });
});
app.use("/api", auth.requireLogin, loginRecords);
app.use("/api", auth.requireLogin, users);
app.use(express.static(path.join(__dirname, "public")));

app.get("*", function(req, res) {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use(function(err, req, res, next) {
  logger.error.error(err && err.stack ? err.stack : String(err));
  res.status(err.status || 500).json({ error: "系统异常，请稍后重试" });
});

module.exports = app;
