"use strict";

var crypto = require("crypto");
var userStore = require("./userStore");

var sessionMaxAgeMs = 8 * 60 * 60 * 1000;
var cookieName = "demo_session";
var sessions = new Map();

function createSession(userId) {
  var token = crypto.randomBytes(32).toString("hex");
  var expiresAt = Date.now() + sessionMaxAgeMs;
  sessions.set(token, { userId: userId, expiresAt: expiresAt });
  return { token: token, expiresAt: expiresAt };
}

function clearSession(token) {
  if (!token) {
    return;
  }
  sessions.delete(token);
}

function getSessionUser(token) {
  if (!token) {
    return null;
  }

  var session = sessions.get(token);
  if (!session) {
    return null;
  }

  if (session.expiresAt < Date.now()) {
    clearSession(token);
    return null;
  }

  var user = userStore.findById(session.userId);
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
