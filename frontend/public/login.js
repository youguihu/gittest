const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const errorModal = document.querySelector("#error-modal");
const errorText = document.querySelector("#error-text");
const errorClose = document.querySelector("#error-close");

function setMessage(text, type = "info") {
  loginMessage.textContent = text;
  loginMessage.dataset.type = type;
}

function showError(text) {
  errorText.textContent = text || "登录失败，请检查用户名和密码";
  errorModal.hidden = false;
  errorClose.focus();
}

function hideError() {
  errorModal.hidden = true;
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

  if (!response.ok) {
    throw new Error(result.error || "请求失败，请稍后重试");
  }

  return result;
}

async function redirectIfLoggedIn() {
  try {
    const result = await requestJson("api/auth/me");
    if (result.data) {
      location.replace("index.html");
    }
  } catch {
    setMessage("", "info");
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(loginForm).entries());

  const submitButton = loginForm.querySelector('button[type="submit"]');
  const originalText = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "登 录 中 ..";

  try {
    await requestJson("api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    location.replace("index.html");
  } catch (error) {
    submitButton.disabled = false;
    submitButton.textContent = originalText;
    showError(error.message || "登录失败，请检查用户名和密码");
  }
});

errorClose.addEventListener("click", hideError);

errorModal.addEventListener("click", (event) => {
  if (event.target === errorModal) {
    hideError();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !errorModal.hidden) {
    hideError();
  }
});

redirectIfLoggedIn();
