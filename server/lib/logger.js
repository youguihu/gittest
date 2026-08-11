"use strict";

var morgan = require("morgan");
var tafLogs = require("@taf/taf-logs");

var logger = {};
var morganTaf = {};

logger.error = new tafLogs("TafDate", "error");
logger.data = new tafLogs("TafDate", "data");
logger.query = new tafLogs("TafDate", "query");
logger.export = new tafLogs("TafDate", "export");
logger.access_log = new tafLogs("TafDate", "access_log");

logger.error.setLevel("DEBUG");
logger.data.setLevel("DEBUG");
logger.query.setLevel("DEBUG");
logger.export.setLevel("DEBUG");

morganTaf.write = function(str) {
  logger.access_log.debug(str.replace("\n", ""));
};

morgan.token("pid", function() {
  return process.pid;
});

logger.morgan_taf_log = function() {
  return morgan(':remote-user ":method :url" :status :res[content-length] ":referrer" ":user-agent" :response-time :pid', {
    stream: morganTaf,
    skip: function(req, res) {
      return req.url === "/favicon.ico" || (res.statusCode < 400 && !process.env.TAF_CONFIG);
    }
  });
};

global.logger = logger;

module.exports = logger;
