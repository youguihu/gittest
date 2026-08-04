const currentUser = document.querySelector("#current-user");
const logoutButton = document.querySelector("#logout-button");
const loginRecordsTab = document.querySelector("#login-records-tab");
const usersTab = document.querySelector("#users-tab");
const dbQueryTab = document.querySelector("#dbquery-tab");
const dbQueryBack = document.querySelector("#dbquery-back");
const loginRecordsView = document.querySelector("#login-records-view");
const usersView = document.querySelector("#users-view");
const dbQueryView = document.querySelector("#dbquery-view");
const recordForm = document.querySelector("#record-form");
const recordStartDate = document.querySelector("#record-start-date");
const recordEndDate = document.querySelector("#record-end-date");
const pageInput = document.querySelector("#page");
const pageSizeInput = document.querySelector("#page-size");
const prevPageButton = document.querySelector("#prev-page");
const nextPageButton = document.querySelector("#next-page");
const pageInfo = document.querySelector("#page-info");
const recordsTableBody = document.querySelector("#login-records");
const usersTableBody = document.querySelector("#users");
const userForm = document.querySelector("#user-form");
const recordMessage = document.querySelector("#record-message");
const userMessage = document.querySelector("#user-message");
const dbQueryForm = document.querySelector("#dbquery-form");
const dbQueryMessage = document.querySelector("#dbquery-message");
const dbQueryResult = document.querySelector("#dbquery-result");
const errorModal = document.querySelector("#error-modal");
const errorText = document.querySelector("#error-text");
const errorClose = document.querySelector("#error-close");
const backToTop = document.querySelector("#back-to-top");

let activeUser = null;
let dbQueryEnabled = false;
let currentPagination = {
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 1
};

function setMessage(target, text, type = "info") {
  target.textContent = text;
  target.dataset.type = type;
}

function showError(text) {
  errorText.textContent = text || "操作未完成，请稍后重试";
  errorModal.hidden = false;
  errorClose.focus();
}

function hideError() {
  errorModal.hidden = true;
}

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function appendCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value != null ? value : "";
  row.appendChild(cell);
  return cell;
}

function roleText(role) {
  if (role === "admin") return "管理员";
  if (role === "user") return "普通用户";
  return role || "";
}

function succText(value) {
  if (value === 1) return "成功";
  if (value === 0) return "失败";
  return "未知";
}

function succBadgeClass(value) {
  if (value === 1) return "badge-success";
  if (value === 0) return "badge-failed";
  return "badge-unknown";
}

function redirectToLogin() {
  location.replace("login.html");
}

async function loadSystemName() {
  try {
    const result = await fetch("api/meta", { credentials: "same-origin" });
    const meta = await result.json();
    if (meta && meta.systemName) {
      const title = document.querySelector("#system-name");
      if (title) title.textContent = meta.systemName;
      document.title = meta.systemName;
    }
    dbQueryEnabled = Boolean(meta && meta.dbQueryEnabled);
    if (dbQueryTab) dbQueryTab.hidden = !dbQueryEnabled;
  } catch (error) {
    // 加载失败时保留默认标题
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.headers || {})
    }
  });
  const result = await response.json();

  if (response.status === 401) {
    redirectToLogin();
  }

  if (!response.ok) {
    throw new Error(result.error || "请求失败，请稍后重试");
  }

  return result;
}

function setupUser(user) {
  activeUser = user;
  currentUser.textContent = `${user.display_name}（${user.username} / ${roleText(user.role)}）`;
  // 用户管理 UI 已隐藏，统一用 admin 用户
  if (usersTab) usersTab.hidden = user.role !== "admin";
}

function showLoginRecords() {
  loginRecordsView.hidden = false;
  if (usersView) usersView.hidden = true;
  if (dbQueryView) dbQueryView.hidden = true;
  if (loginRecordsTab) loginRecordsTab.classList.add("is-active");
  if (usersTab) usersTab.classList.remove("is-active");
  if (dbQueryTab) dbQueryTab.classList.remove("is-active");
}

function showDbQuery() {
  if (!dbQueryEnabled) return;
  loginRecordsView.hidden = true;
  if (usersView) usersView.hidden = true;
  dbQueryView.hidden = false;
  if (loginRecordsTab) loginRecordsTab.classList.remove("is-active");
  if (usersTab) usersTab.classList.remove("is-active");
  dbQueryTab.classList.add("is-active");
  if (!dbQueryHost.value) loadDbQueryPrefs();
  dbQuerySql.focus();
}

function updatePager(pagination) {
  currentPagination = pagination;
  pageInput.value = String(pagination.page);
  pageInfo.textContent = `第 ${pagination.page} / ${pagination.totalPages} 页，共 ${pagination.total} 条`;
  prevPageButton.disabled = pagination.page <= 1;
  nextPageButton.disabled = pagination.page >= pagination.totalPages;
}

async function showUsers() {
  loginRecordsView.hidden = true;
  if (usersView) usersView.hidden = false;
  if (loginRecordsTab) loginRecordsTab.classList.remove("is-active");
  if (usersTab) usersTab.classList.add("is-active");
  await loadUsers();
}

function renderLoginRecords(records, result) {
  recordsTableBody.innerHTML = "";
  const tableCount = result.tables.length;
  const missingCount = result.missingTables.length;
  const failedDbs = result.failedDbs || [];
  var failMsg = failedDbs.length > 0 ? `；失败库 ${failedDbs.length}（${failedDbs.join(", ")}）` : "";
  updatePager(result.pagination);
  var rangeText = result.range.startDate && result.range.endDate
    ? `查询 ${result.range.startDate} 至 ${result.range.endDate}`
    : "查询全部日期";
  setMessage(recordMessage,
    `${rangeText}，命中 ${tableCount} 张表，缺失 ${missingCount} 张${failMsg}`,
    "success"
  );

  if (records.length === 0) {
    recordsTableBody.innerHTML = '<tr><td colspan="10" class="empty">没有查询到交易日志</td></tr>';
    return;
  }

  records.forEach((record) => {
    const row = document.createElement("tr");
    appendCell(row, record.name).classList.add("col-primary");
    appendCell(row, record.user_id).classList.add("col-primary");
    appendCell(row, record.mobile_no).classList.add("col-primary");
    const resultCell = document.createElement("td");
    resultCell.classList.add("col-primary");
    const badge = document.createElement("span");
    badge.className = `badge ${succBadgeClass(record.succ)}`;
    badge.textContent = succText(record.succ);
    resultCell.appendChild(badge);
    row.appendChild(resultCell);
    appendCell(row, record.processing_stage).classList.add("col-primary");
    appendCell(row, record.log_date).classList.add("col-primary");
    appendCell(row, record.req_uri);
    appendCell(row, record.time_consuming != null ? record.time_consuming : "");
    appendCell(row, record.source_db).classList.add("col-secondary");
    // 详情按钮
    const actionCell = document.createElement("td");
    actionCell.classList.add("col-action");
    const detailBtn = document.createElement("button");
    detailBtn.type = "button";
    detailBtn.className = "link-btn";
    detailBtn.textContent = "详情";
    detailBtn.addEventListener("click", () => showRecordDetail(record));
    actionCell.appendChild(detailBtn);
    row.appendChild(actionCell);
    recordsTableBody.appendChild(row);
  });
}

function showRecordDetail(record) {
  const detailModal = document.querySelector("#detail-modal");
  const detailBody = document.querySelector("#detail-body");
  const fields = [
    ["姓名", record.name],
    ["用户 ID", record.user_id],
    ["手机号", record.mobile_no],
    ["结果", succText(record.succ)],
    ["处理阶段", record.processing_stage],
    ["日期", record.log_date],
    ["接口号", record.req_uri],
    ["耗时(ms)", record.time_consuming != null ? record.time_consuming : ""],
    ["数据来源库", record.source_db],
    ["数据来源表", record.source_table],
    ["应用名", record.application_name],
    ["日志级别", record.log_lvl],
    ["毫秒时间", record.log_date_ms],
    ["进程 ID", record.process_id],
    ["线程 ID", record.thread_id],
    ["模块名", record.module_name],
    ["源码位置", record.src_location],
    ["会话 ID", record.session_id],
    ["流水号", record.process_number],
    ["后端 ID", record.backend_id],
    ["后端进程 ID", record.backend_process_id],
    ["数据信息", record.data_info],
    ["IMEI", record.imei],
    ["版本", record.version],
    ["OS 版本", record.os_version],
    ["IMSI", record.imsi],
    ["MAC", record.mac],
    ["UDID", record.udid],
    ["IP", record.ip],
    ["设备 ID", record.mach_id],
    ["记录 ID", record.id]
  ];
  detailBody.innerHTML = "";
  fields.forEach(([label, value]) => {
    const rowDiv = document.createElement("div");
    rowDiv.className = "detail-row";
    const labelSpan = document.createElement("span");
    labelSpan.className = "detail-label";
    labelSpan.textContent = label;
    const valueSpan = document.createElement("span");
    valueSpan.className = "detail-value";
    valueSpan.textContent = value != null ? String(value) : "";
    rowDiv.appendChild(labelSpan);
    rowDiv.appendChild(valueSpan);
    detailBody.appendChild(rowDiv);
  });
  detailModal.hidden = false;
}

function renderUsers(users) {
  usersTableBody.innerHTML = "";

  if (users.length === 0) {
    usersTableBody.innerHTML = '<tr><td colspan="5" class="empty">没有用户数据</td></tr>';
    return;
  }

  users.forEach((user) => {
    const row = document.createElement("tr");
    appendCell(row, user.id);
    appendCell(row, user.username);
    appendCell(row, user.display_name);
    appendCell(row, roleText(user.role));
    appendCell(row, user.created_at);
    usersTableBody.appendChild(row);
  });
}

async function loadLoginRecords() {
  const params = new URLSearchParams(new FormData(recordForm));
  const result = await requestJson(`api/login-records?${params.toString()}`);
  renderLoginRecords(result.data, result);
}

async function loadUsers() {
  const result = await requestJson("api/users");
  renderUsers(result.data);
}

const dbQueryHost = document.querySelector("#dbq-host");
const dbQueryPort = document.querySelector("#dbq-port");
const dbQueryUser = document.querySelector("#dbq-user");
const dbQueryDatabase = document.querySelector("#dbq-database");
const dbQueryCharset = document.querySelector("#dbq-charset");

const DBQ_PREFS_KEY = "dbQueryPrefs";

function saveDbQueryPrefs() {
  try {
    localStorage.setItem(DBQ_PREFS_KEY, JSON.stringify({
      host: dbQueryHost.value,
      port: dbQueryPort.value,
      user: dbQueryUser.value,
      database: dbQueryDatabase.value,
      charset: dbQueryCharset.value
    }));
  } catch (error) {
    // 忽略持久化失败
  }
}

function loadDbQueryPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(DBQ_PREFS_KEY) || "{}");
    if (saved.host) dbQueryHost.value = saved.host;
    if (saved.port) dbQueryPort.value = saved.port;
    if (saved.user) dbQueryUser.value = saved.user;
    if (saved.database) dbQueryDatabase.value = saved.database;
    if (saved.charset) dbQueryCharset.value = saved.charset;
  } catch (error) {
    // 读取失败时使用默认值
  }
}

function renderDbQueryResult(result) {
  dbQueryResult.innerHTML = "";
  dbQueryResult.hidden = false;

  const info = document.createElement("p");
  info.className = "message";
  const ms = result.elapsedMs != null ? `，耗时 ${result.elapsedMs}ms` : "";
  if (result.error) {
    info.dataset.type = "error";
    info.textContent = `执行出错：${result.error}`;
    dbQueryResult.appendChild(info);
    return;
  }

  if (result.columns && result.columns.length > 0) {
    const rows = result.rows || [];
    const truncated = result.truncated ? `（仅显示前 ${result.rowCount} 行，共 ${result.total} 行）` : "";
    info.dataset.type = "success";
    info.textContent = `查询成功：${rows.length} 行${truncated}${ms}`;

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    result.columns.forEach((name) => {
      const th = document.createElement("th");
      th.textContent = name;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      result.columns.forEach((name) => {
        const value = row[name];
        appendCell(tr, value != null ? (typeof value === "object" ? JSON.stringify(value) : value) : "");
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    dbQueryResult.appendChild(table);
  } else {
    const parts = [];
    if (result.affectedRows != null) parts.push(`影响 ${result.affectedRows} 行`);
    if (result.insertId != null) parts.push(`自增 ID ${result.insertId}`);
    if (parts.length === 0) parts.push(`执行成功，影响 ${result.rowCount} 行`);
    info.dataset.type = "success";
    info.textContent = `执行成功：${parts.join("，")}${ms}`;
  }
  dbQueryResult.appendChild(info);
}

async function runDbQuery() {
  saveDbQueryPrefs();
  const formData = new FormData(dbQueryForm);
  const payload = Object.fromEntries(formData.entries());
  const result = await requestJson("api/db-query/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  renderDbQueryResult(result);
}

dbQueryTab.addEventListener("click", () => {
  if (dbQueryView.hidden) {
    showDbQuery();
  } else {
    showLoginRecords();
  }
});

dbQueryBack.addEventListener("click", showLoginRecords);

dbQueryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  dbQueryResult.hidden = true;
  setMessage(dbQueryMessage, "正在执行，请稍候…", "info");
  try {
    await runDbQuery();
    setMessage(dbQueryMessage, "", "info");
  } catch (error) {
    dbQueryResult.hidden = true;
    setMessage(dbQueryMessage, error.message || "执行失败，请稍后重试", "error");
  }
});

logoutButton.addEventListener("click", async () => {
  await requestJson("api/auth/logout", { method: "POST" }).catch(() => null);
  redirectToLogin();
});

// 登录记录按钮已隐藏，事件保留以便日后恢复
if (loginRecordsTab) {
  loginRecordsTab.addEventListener("click", async () => {
    showLoginRecords();
    await loadLoginRecords();
  });
}

// 用户管理 UI 已隐藏，事件保留以便日后恢复
if (usersTab) {
  usersTab.addEventListener("click", async () => {
    if (activeUser && activeUser.role === "admin") {
      await showUsers();
    }
  });
}

recordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    pageInput.value = "1";
    await loadLoginRecords();
  } catch (error) {
    showError(error.message || "查询失败，请稍后重试");
  }
});

prevPageButton.addEventListener("click", async () => {
  if (currentPagination.page <= 1) return;
  pageInput.value = String(currentPagination.page - 1);
  await loadLoginRecords().catch((error) => showError(error.message || "翻页失败，请稍后重试"));
});

nextPageButton.addEventListener("click", async () => {
  if (currentPagination.page >= currentPagination.totalPages) return;
  pageInput.value = String(currentPagination.page + 1);
  await loadLoginRecords().catch((error) => showError(error.message || "翻页失败，请稍后重试"));
});

// 用户管理表单事件保留以便日后恢复
if (userForm) {
  userForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(userForm).entries());

    try {
      const result = await requestJson("api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      userForm.reset();
      setMessage(userMessage, `已新增用户：${result.data.username}`, "success");
      await loadUsers();
    } catch (error) {
      showError(error.message || "新增用户失败，请稍后重试");
    }
  });
}

errorClose.addEventListener("click", hideError);
errorModal.addEventListener("click", (event) => {
  if (event.target === errorModal) hideError();
});

const detailClose = document.querySelector("#detail-close");
const detailModal = document.querySelector("#detail-modal");
function hideDetail() {
  detailModal.hidden = true;
}
if (detailClose) {
  detailClose.addEventListener("click", hideDetail);
  detailModal.addEventListener("click", (event) => {
    if (event.target === detailModal) hideDetail();
  });
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !errorModal.hidden) hideError();
});

window.addEventListener("scroll", () => {
  backToTop.classList.toggle("is-visible", window.scrollY > 260);
});

backToTop.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

async function init() {
  try {
    await loadSystemName();
    const result = await requestJson("api/auth/me");
    if (!result.data) {
      redirectToLogin();
      return;
    }
    setupUser(result.data);
    recordStartDate.value = today();
    recordEndDate.value = today();
    pageInput.value = "1";
    pageSizeInput.value = "10";
    showLoginRecords();
    try {
      await loadLoginRecords();
    } catch (error) {
      showError(error.message || "查询失败，请稍后重试");
    }
  } catch {
    redirectToLogin();
  }
}

init();