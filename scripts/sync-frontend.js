#!/usr/bin/env node
"use strict";

var fs = require("fs");
var path = require("path");

var root = path.resolve(__dirname, "..");
var src = path.join(root, "frontend", "public");
var dst = path.join(root, "server", "client", "public");

function copyDir(from, to) {
  fs.mkdirSync(to);
  fs.readdirSync(from).forEach(function(name) {
    var s = path.join(from, name);
    var d = path.join(to, name);
    var stat = fs.statSync(s);
    if (stat.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.writeFileSync(d, fs.readFileSync(s));
    }
  });
}

function rmDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(function(name) {
    var p = path.join(dir, name);
    var stat = fs.statSync(p);
    if (stat.isDirectory()) {
      rmDir(p);
    } else {
      fs.unlinkSync(p);
    }
  });
  fs.rmdirSync(dir);
}

if (!fs.existsSync(src)) {
  console.error("缺少前端目录: " + src);
  process.exit(1);
}

rmDir(dst);
copyDir(src, dst);
console.log("frontend/public -> " + dst);