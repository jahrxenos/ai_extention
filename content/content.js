"use strict";

if (!window.__textAdapterLoaded) {
  window.__textAdapterLoaded = true;

  const replacements = [];
  let panel = null;

  browser.runtime.onMessage.addListener((message) => {
    if (message.action === "showPanel") {
      togglePanel();
      return Promise.resolve({success: true});
    }
  });

  function togglePanel() {
    if (!panel) panel = buildPanel();
    panel.hidden = !panel.hidden;
  }

  function buildPanel() {
    const el = document.createElement("div");
    el.className = "txa-panel";
    el.innerHTML = `
      <div class="txa-ph">
        <span class="txa-ph-title">Адаптация текста</span>
        <div class="txa-ph-btns">
          <button class="txa-ph-btn" id="txa-opt-btn" title="Настройки">⚙</button>
          <button class="txa-ph-btn" id="txa-cls-btn" title="Закрыть">✕</button>
        </div>
      </div>
      <div class="txa-pb">
        <div class="txa-levels">
          <label class="txa-lvl"><input type="radio" name="txa-lvl" value="light"><span>Лёгкая</span></label>
          <label class="txa-lvl"><input type="radio" name="txa-lvl" value="medium" checked><span>Средняя</span></label>
          <label class="txa-lvl"><input type="radio" name="txa-lvl" value="max"><span>Максимальная</span></label>
        </div>
        <div class="txa-st" id="txa-st" hidden></div>
      </div>
      <div class="txa-pf">
        <button class="txa-btn txa-ghost" id="txa-revert">↩ Оригинал</button>
        <div class="txa-pf-right">
          <button class="txa-btn txa-sec" id="txa-page">Вся страница</button>
          <button class="txa-btn txa-pri" id="txa-sel">Выделенное</button>
        </div>
      </div>
    `;
    el.hidden = true;
    document.body.appendChild(el);

    el.querySelector("#txa-opt-btn").addEventListener("click", () => browser.runtime.sendMessage({action: "openOptions"}));
    el.querySelector("#txa-cls-btn").addEventListener("click", () => { revertAll(); el.hidden = true; });
    el.querySelector("#txa-sel").addEventListener("click",    () => runAdapt("selection"));
    el.querySelector("#txa-page").addEventListener("click",   () => runAdapt("page"));
    el.querySelector("#txa-revert").addEventListener("click", () => { revertAll(); showStatus("Оригинал восстановлен", "success"); });

    return el;
  }

  function getLevel() {
    return panel?.querySelector('input[name="txa-lvl"]:checked')?.value || "medium";
  }

  function setLoading(on) {
    panel?.querySelectorAll("button").forEach(b => { b.disabled = on; });
  }

  let stTimer = null;
  function showStatus(text, type) {
    const st = panel?.querySelector("#txa-st");
    if (!st) return;
    st.textContent  = text;
    st.dataset.type = type;
    st.hidden       = false;
    clearTimeout(stTimer);
    if (type !== "loading") stTimer = setTimeout(() => { st.hidden = true; }, 3000);
  }

  async function runAdapt(mode) {
    setLoading(true);
    showStatus("Адаптирую...", "loading");
    const result = await (mode === "selection" ? adaptSelection(getLevel()) : adaptPage(getLevel()))
      .catch(e => ({success: false, error: e.message}));
    showStatus(result.success ? "Готово!" : (result.error || "Ошибка"), result.success ? "success" : "error");
    setLoading(false);
  }

  async function adaptSelection(level) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0)
      return {success: false, error: "Нет выделенного текста."};

    const range        = selection.getRangeAt(0);
    const originalText = range.toString().trim();
    if (originalText.length < 10)
      return {success: false, error: "Слишком короткий текст для адаптации."};

    const result = await browser.runtime.sendMessage({action: "groq", texts: [originalText], level});
    if (!result.success) return result;

    const mark = document.createElement("mark");
    mark.className   = "txa-adapted";
    mark.textContent = result.adapted[0] || originalText;

    const entry = {revert: () => mark.replaceWith(document.createTextNode(originalText))};
    mark.appendChild(createRevertBtn(() => { entry.revert(); removeReplacement(entry); }));

    range.deleteContents();
    range.insertNode(mark);

    // Restore selection on adapted text so user can immediately try another level
    const textNode = mark.firstChild;
    if (textNode?.nodeType === Node.TEXT_NODE) {
      const r = document.createRange();
      r.setStart(textNode, 0);
      r.setEnd(textNode, textNode.textContent.length);
      selection.removeAllRanges();
      selection.addRange(r);
    }

    replacements.push(entry);
    return {success: true};
  }

  async function adaptPage(level) {
    const targets = Array.from(document.querySelectorAll("p, li, h2, h3, h4, blockquote, td"))
      .filter(el => {
        const text = (el.innerText || el.textContent).trim();
        return text.length >= 80 && isVisible(el) && !el.closest(".txa-adapted") && !el.closest(".txa-block-adapted");
      })
      .slice(0, 30);

    if (!targets.length) return {success: false, error: "Нет подходящего текста на странице."};

    showStatus(`Адаптирую ${targets.length} блоков...`, "loading");

    const result = await browser.runtime.sendMessage({
      action: "groq",
      texts: targets.map(el => (el.innerText || el.textContent).trim()),
      level
    });
    if (!result.success) return result;

    targets.forEach((el, i) => {
      if (!result.adapted[i]) return;
      const originalHTML = el.innerHTML;
      const wrapper = document.createElement("span");
      wrapper.className   = "txa-block-adapted";
      wrapper.textContent = result.adapted[i];
      const entry = {revert: () => { el.innerHTML = originalHTML; }};
      wrapper.appendChild(createRevertBtn(() => { entry.revert(); removeReplacement(entry); }));
      el.innerHTML = "";
      el.appendChild(wrapper);
      replacements.push(entry);
    });

    return {success: true};
  }

  function revertAll() {
    [...replacements].forEach(({revert}) => revert());
    replacements.length = 0;
  }

  function removeReplacement(entry) {
    const idx = replacements.indexOf(entry);
    if (idx > -1) replacements.splice(idx, 1);
  }

  function isVisible(el) {
    const s = window.getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && el.offsetParent !== null;
  }

  function createRevertBtn(onClick) {
    const btn = document.createElement("button");
    btn.className   = "txa-revert-btn";
    btn.textContent = "↩ оригинал";
    btn.title       = "Вернуть оригинал этого фрагмента";
    btn.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); onClick(); });
    return btn;
  }
}
