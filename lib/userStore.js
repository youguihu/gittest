"use strict";

var crypto = require("crypto");

var users = [];
var nextId = 1;

function hashPassword(password) {
  var salt = crypto.randomBytes(16).toString("hex");
  var derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return "scrypt$" + salt + "$" + derived;
}

function verifyPassword(password, passwordHash) {
  var parts = String(passwordHash || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }

  var expected = Buffer.from(parts[2], "hex");
  var actual = crypto.scryptSync(password, parts[1], 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    created_at: user.created_at
  };
}

function init(config) {
  var userConfig = config && config.users ? config.users : {};
  var configuredUsers = [];

  if (Array.isArray(userConfig.user)) {
    configuredUsers = userConfig.user;
  } else if (userConfig.user) {
    configuredUsers = [userConfig.user];
  }

  users = configuredUsers.map(function(item) {
    return {
      id: nextId++,
      username: String(item.username || "").trim(),
      password_hash: String(item.passwordHash || item.password_hash || "").trim(),
      display_name: String(item.displayName || item.display_name || item.username || "").trim(),
      role: String(item.role || "user").trim(),
      created_at: new Date().toISOString()
    };
  }).filter(function(user) {
    return user.username && user.password_hash && (user.role === "admin" || user.role === "user");
  });

  if (users.length === 0) {
    users.push({
      id: nextId++,
      username: "admin",
      password_hash: hashPassword("admin123"),
      display_name: "管理员",
      role: "admin",
      created_at: new Date().toISOString()
    });
  }
}

function findByUsername(username) {
  return users.find(function(user) {
    return user.username === username;
  }) || null;
}

function findById(id) {
  return users.find(function(user) {
    return user.id === id;
  }) || null;
}

function list() {
  return users.slice().sort(function(a, b) {
    return b.id - a.id;
  }).map(publicUser);
}

function add(input) {
  if (findByUsername(input.username)) {
    var error = new Error("用户名已存在");
    error.code = "USER_EXISTS";
    throw error;
  }

  var user = {
    id: nextId++,
    username: input.username,
    password_hash: hashPassword(input.password),
    display_name: input.displayName,
    role: input.role,
    created_at: new Date().toISOString()
  };
  users.push(user);
  return publicUser(user);
}

module.exports = {
  init: init,
  hashPassword: hashPassword,
  verifyPassword: verifyPassword,
  findByUsername: findByUsername,
  findById: findById,
  list: list,
  add: add,
  publicUser: publicUser
};
