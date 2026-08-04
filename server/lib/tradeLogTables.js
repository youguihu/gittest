"use strict";

var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function templateFromConfig(config) {
  var template = config && config.tableDateSuffix ? String(config.tableDateSuffix) : "";
  if (!/^[a-zA-Z0-9_]+$/.test(template)) return "YYYYMMDD";
  return template;
}

// 将 YYYY-MM-DD 日期按 tableDateSuffix 模板格式化为分表后缀
// 例如 YYYYMMDD -> 20260804，YYYY_MM_DD -> 2026_08_04
function formatSuffix(template, dateStr) {
  var m = DATE_RE.exec(dateStr);
  if (!m) return dateStr;
  return template
    .replace(/YYYY/g, m[1])
    .replace(/MM/g, m[2])
    .replace(/DD/g, m[3]);
}

// 按模板将表名后缀解析回 YYYY-MM-DD，解析失败返回 ""
function parseSuffix(template, suffix) {
  var re = new RegExp("^" + escapeRegex(template)
    .replace(/YYYY/g, "(\\d{4})")
    .replace(/MM/g, "(\\d{2})")
    .replace(/DD/g, "(\\d{2})") + "$");
  var m = re.exec(suffix);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  if (/^\d{8}$/.test(suffix)) {
    return suffix.slice(0, 4) + "-" + suffix.slice(4, 6) + "-" + suffix.slice(6, 8);
  }
  return "";
}

module.exports = {
  templateFromConfig: templateFromConfig,
  formatSuffix: formatSuffix,
  parseSuffix: parseSuffix
};
