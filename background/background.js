"use strict";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const LEVEL_DESCRIPTIONS = {
  light:  "Лёгкое упрощение: замени сложные термины и профессиональный жаргон простыми словами, сохрани структуру, смысл и все детали текста.",
  medium: "Среднее упрощение: перефразируй простым и понятным языком, убери профессиональный жаргон, разбей длинные предложения на короткие, сохрани ключевую информацию.",
  max:    "Максимальное упрощение: объясни как пятикласснику — используй самые простые слова, очень короткие предложения, избегай любых специальных терминов, сохрани только главную мысль."
};

const SYSTEM_PROMPT = `Ты помощник по адаптации текстов. Тебе дан список пронумерованных текстовых фрагментов.
Адаптируй каждый фрагмент согласно заданному уровню упрощения.
Правила:
- Отвечай на том же языке, что и исходный текст — не переводи
- Сохраняй нумерацию строго в формате [N]
- Не добавляй пояснений, вступлений или заключений — только адаптированные тексты
- Каждый фрагмент начинается с новой строки
- Не объединяй и не разбивай фрагменты`;

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "txa-open",
    title: "Адаптировать текст",
    contexts: ["page", "selection"]
  });
});

browser.contextMenus.onClicked.addListener((info, tab) => showPanel(tab.id));
browser.browserAction.onClicked.addListener((tab) => showPanel(tab.id));

async function showPanel(tabId) {
  await browser.tabs.executeScript(tabId, {file: "content/content.js"}).catch(() => {});
  await browser.tabs.insertCSS(tabId, {file: "content/content.css"}).catch(() => {});
  browser.tabs.sendMessage(tabId, {action: "showPanel"}).catch(() => {});
}

browser.runtime.onMessage.addListener((message) => {
  if (message.action === "groq") {
    return handleGroqRequest(message).catch(err => ({success: false, error: err.message}));
  }
  if (message.action === "openOptions") {
    browser.runtime.openOptionsPage();
    return Promise.resolve();
  }
});

async function handleGroqRequest({texts, level}) {
  const {apiKey} = await browser.storage.local.get("apiKey");
  if (!apiKey) throw new Error("API-ключ не настроен. Откройте настройки расширения (⚙).");

  const numbered = texts.map((t, i) => `[${i + 1}] ${t}`).join("\n");

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {"Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json"},
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [
        {role: "system", content: `${SYSTEM_PROMPT}\n\nУровень адаптации: ${LEVEL_DESCRIPTIONS[level] || LEVEL_DESCRIPTIONS.medium}`},
        {role: "user",   content: numbered}
      ],
      temperature: 0.3,
      max_tokens: 4096
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Groq API вернул ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  return {success: true, adapted: parseNumbered(data.choices[0].message.content.trim(), texts.length)};
}

function parseNumbered(text, count) {
  const result = new Array(count).fill("");
  let current  = -1;
  const buffer = [];

  const flush = () => {
    if (current >= 0 && current < count) result[current] = buffer.join("\n").trim();
    buffer.length = 0;
  };

  for (const line of text.split("\n")) {
    const match = line.match(/^\[(\d+)\]\s*(.*)/);
    if (match) {
      flush();
      current = parseInt(match[1], 10) - 1;
      buffer.push(match[2]);
    } else if (current >= 0) {
      buffer.push(line);
    }
  }
  flush();

  return result;
}
