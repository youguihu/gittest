"use strict";

var express = require("express");
var auth = require("../lib/auth");
var userStore = require("../lib/userStore");

var router = express.Router();

router.get("/users", auth.requireAdmin, function(req, res, next) {
  try {
    res.json({ data: userStore.list() });
  } catch (err) {
    next(err);
  }
});

router.post("/users", auth.requireAdmin, function(req, res, next) {
  try {
    var username = String(req.body.username || "").trim();
    var password = String(req.body.password || "");
    var displayName = String(req.body.display_name || "").trim();
    var role = String(req.body.role || "user").trim();

    if (!username || !password || !displayName) {
      res.status(400).json({ error: "请填写用户名、显示名和密码" });
      return;
    }

    if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
      res.status(400).json({ error: "用户名需为 3-32 位字母、数字或下划线" });
      return;
    }

    if (password.length < 8 || password.length > 72) {
      res.status(400).json({ error: "密码长度需为 8-72 位" });
      return;
    }

    if (role !== "admin" && role !== "user") {
      res.status(400).json({ error: "用户角色不正确" });
      return;
    }

    var user = userStore.add({
      username: username,
      password: password,
      displayName: displayName,
      role: role
    });

    res.status(201).json({ data: user });
  } catch (err) {
    if (err.code === "USER_EXISTS") {
      res.status(409).json({ error: "用户名已存在" });
      return;
    }
    next(err);
  }
});

module.exports = router;
