"use strict";

var fs = require("fs");
var path = require("path");
var Q = require("q");
var ConfigParser = require("@taf/taf-utils").Config;

var config = {};

config.loadConfig = function(filename, configFormat) {
  var dfd = Q.defer();

  if (process.env.TAF_CONFIG) {
    var TafConfigHelper = require("@taf/taf-config-helper").Helper;
    TafConfigHelper.getConfig({
      fileName: filename,
      path: path.resolve(__dirname, "..", filename)
    }).then(function(ret) {
      dfd.resolve(parseConf(ret.config || ret.data || ret, configFormat));
    }, dfd.reject);
    return dfd.promise;
  }

  fs.readFile(path.resolve(__dirname, "..", filename), "utf8", function(err, content) {
    if (err) {
      dfd.reject(err);
      return;
    }
    dfd.resolve(parseConf(content, configFormat));
  });

  return dfd.promise;
};

function parseConf(content, configFormat) {
  if (configFormat === "c") {
    var parser = new ConfigParser();
    parser.parseText(content, "utf8");
    global.CONFIG = parser.data;
    return parser.data;
  }

  if (configFormat === "json") {
    global.CONFIG = JSON.parse(content);
    return global.CONFIG;
  }

  global.CONFIG = content;
  return content;
}

module.exports = config;
