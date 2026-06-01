"use strict";

const apiKeyInput = document.getElementById("apiKey");
const btnSave     = document.getElementById("btnSave");
const btnTest     = document.getElementById("btnTest");
const toggleKey   = document.getElementById("toggleKey");
const statusEl    = document.getElementById("status");

let statusTimer = null;

browser.storage.local.get("apiKey").then(({apiKey}) => {
  if (apiKey) apiKeyInput.value = apiKey;
});

toggleKey.addEventListener("click", () => {
  apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
});

function showStatus(text, type) {
  statusEl.textContent  = text;
  statusEl.dataset.type = type;
  statusEl.hidden       = false;
  clearTimeout(statusTimer);
  if (type !== "loading") {
    statusTimer = setTimeout(() => { statusEl.hidden = true; }, 4000);
  }
}

btnSave.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) { showStatus("Введите API-ключ", "error"); return; }
  await browser.storage.local.set({apiKey});
  showStatus("Настройки сохранены ✓", "success");
});

btnTest.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) { showStatus("Введите API-ключ", "error"); return; }

  btnTest.disabled = true;
  showStatus("Проверяю...", "loading");

  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{role: "user", content: "Ответь одним словом: привет"}],
        max_tokens: 5
      })
    });

    if (resp.ok) {
      showStatus("Ключ действителен ✓", "success");
    } else {
      const data = await resp.json().catch(() => ({}));
      showStatus(`Ошибка ${resp.status}: ${data.error?.message || "неверный ключ"}`, "error");
    }
  } catch (e) {
    showStatus(`Ошибка соединения: ${e.message}`, "error");
  } finally {
    btnTest.disabled = false;
  }
});
