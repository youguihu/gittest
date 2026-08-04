"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var userStore = require("./userStore");

var sessionMaxAgeMs = 8 * 60 * 60 * 1000;
var cookieName = "demo_session";
var secretFile = path.join(__dirname, "..", "data", "session-secret");

function getSecret() {
  var conf = global.CONFIG && global.CONFIG.server;
  if (conf && conf.sessionSecret) {
    return String(conf.sessionSecret);
  }
  try {
    var saved = fs.readFileSync(secretFile, "utf8").trim();
    if (saved) {
      return saved;
    }
  } catch (err) {
    // 文件不存在则生成
  }
  var secret = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(path.dirname(secretFile), { recursive: true });
    fs.writeFileSync(secretFile, secret);
  } catch (err) {
    console.error("write session secret failed: " + (err && err.message));
  }
  return secret;
}

function encodeB64Url(data) {
  return Buffer.from(data, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeB64Url(str) {
  var base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64").toString("utf8");
}

function signToken(payload) {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
}

function createSession(userId) {
  var expiresAt = Date.now() + sessionMaxAgeMs;
  var payload = userId + "|" + expiresAt;
  var body = encodeB64Url(payload);
  var token = body + "." + signToken(body);
  return { token: token, expiresAt: expiresAt };
}

function clearSession(token) {
  // 无状态会话，无需服务端清理
  return token;
}

function getSessionUser(token) {
  if (!token) {
    return null;
  }

  var parts = String(token).split(".");
  if (parts.length !== 2) {
    return null;
  }

  var body = parts[0];
  var sig = parts[1];
  var expected = Buffer.from(signToken(body), "utf8");
  var actual = Buffer.from(sig, "utf8");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return null;
  }

  var payload = decodeB64Url(body);
  var sep = payload.lastIndexOf("|");
  if (sep <= 0) {
    return null;
  }

  var userId = parseInt(payload.slice(0, sep), 10);
  var expiresAt = parseInt(payload.slice(sep + 1), 10);
  if (!Number.isInteger(userId) || !Number.isInteger(expiresAt) || expiresAt < Date.now()) {
    return null;
  }

  var user = userStore.findById(userId);
  return user ? userStore.publicUser(user) : null;
}

function attachUser(req, res, next) {
  req.sessionToken = req.cookies[cookieName];
  req.user = getSessionUser(req.sessionToken);
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: "请先登录" });
    return;
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "需要管理员权限" });
    return;
  }
  next();
}

function setSessionCookie(res, token) {
  res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: sessionMaxAgeMs,
    path: "/"
  });
}

function clearSessionCookie(res) {
  res.clearCookie(cookieName, { path: "/" });
}

module.exports = {
  attachUser: attachUser,
  requireLogin: requireLogin,
  requireAdmin: requireAdmin,
  createSession: createSession,
  clearSession: clearSession,
  setSessionCookie: setSessionCookie,
  clearSessionCookie: clearSessionCookie
};
