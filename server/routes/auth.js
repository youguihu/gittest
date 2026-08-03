"use strict";

var express = require("express");
var auth = require("../lib/auth");
var userStore = require("../lib/userStore");

var router = express.Router();

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role
  };
}

router.get("/me", function(req, res) {
  res.json({ data: req.user ? publicUser(req.user) : null });
});

router.post("/login", function(req, res, next) {
  try {
    var username = String(req.body.username || "").trim();
    var password = String(req.body.password || "");

    if (!username || !password) {
      res.status(400).json({ error: "请输入用户名和密码" });
      return;
    }

    var user = userStore.findByUsername(username);

    if (!user || !userStore.verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: "用户名或密码错误" });
      return;
    }

    var session = auth.createSession(user.id);
    auth.setSessionCookie(res, session.token);
    res.json({ data: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", function(req, res) {
  auth.clearSession(req.sessionToken);
  auth.clearSessionCookie(res);
  res.json({ data: true });
});

module.exports = router;
