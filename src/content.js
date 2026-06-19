const SELECTOR =
  "p, li, h1, h2, h3, h4, h5, h6, button, label, summary, figcaption, td, th, [role='button'], [aria-label]";

const SKIP_SELECTOR =
  "script, style, noscript, code, pre, textarea, input, select, option, svg, canvas, math, .math-trans-translation";

let settings = null;
let observer = null;
let pendingTimer = null;

init();

async function init() {
  settings = await sendMessage({ type: "GET_SETTINGS" });
  installObserver();
  scheduleTranslate();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "MATH_TRANS_REFRESH") {
    return;
  }

  document.querySelectorAll(".math-trans-translation").forEach((node) => node.remove());
  document.querySelectorAll("[data-math-translated]").forEach((node) => {
    node.removeAttribute("data-math-translated");
    node.removeAttribute("data-math-trans-source");
  });
  init();
});

function installObserver() {
  if (observer) {
    observer.disconnect();
  }

  observer = new MutationObserver((mutations) => {
    if (mutations.some(hasRelevantMutation)) {
      scheduleTranslate();
    }
  });

  observer.observe(document.body, {
    childList: true,
    characterData: true,
    subtree: true
  });
}

function hasRelevantMutation(mutation) {
  if (mutation.target?.parentElement?.closest(".math-trans-translation")) {
    return false;
  }
  return true;
}

function scheduleTranslate() {
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(translateVisibleContent, 400);
}

async function translateVisibleContent() {
  if (!settings?.enabled) {
    return;
  }

  const candidates = collectCandidates();
  if (!candidates.length) {
    return;
  }

  const texts = candidates.map((node) => node.dataset.mathTransSource);
  const result = await sendMessage({ type: "TRANSLATE_TEXTS", texts }).catch((error) => ({
    ok: false,
    error: error.message
  }));

  if (!result?.ok) {
    resetCandidates(candidates);
    showStatus(result?.error || "Translation service is not configured.");
    return;
  }

  for (const node of candidates) {
    const source = node.dataset.mathTransSource;
    const translated = result.translations?.[source];
    if (translated) {
      renderTranslation(node, translated);
    } else {
      node.removeAttribute("data-math-translated");
      node.removeAttribute("data-math-trans-source");
    }
  }
}

function resetCandidates(candidates) {
  for (const node of candidates) {
    node.removeAttribute("data-math-translated");
    node.removeAttribute("data-math-trans-source");
  }
}

function collectCandidates() {
  return Array.from(document.querySelectorAll(SELECTOR)).filter((node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    if (node.closest(SKIP_SELECTOR) || node.dataset.mathTranslated === "true") {
      return false;
    }
    if (!isVisible(node) || hasTranslatedAncestor(node)) {
      return false;
    }

    const text = normalizeText(node.getAttribute("aria-label") || node.innerText);
    if (!isTranslatableText(text)) {
      return false;
    }

    node.dataset.mathTranslated = "true";
    node.dataset.mathTransSource = text;
    return true;
  });
}

function hasTranslatedAncestor(node) {
  const parent = node.parentElement?.closest("[data-math-translated='true']");
  if (!parent) {
    return false;
  }
  const parentText = normalizeText(parent.dataset.mathTransSource || parent.innerText);
  const nodeText = normalizeText(node.innerText);
  return parentText.includes(nodeText);
}

function isVisible(node) {
  const style = window.getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) !== 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function isTranslatableText(text) {
  if (text.length < 2 || text.length > 700) {
    return false;
  }
  if (/^[\d\s.,:;+\-*/=()[\]{}<>%$#|]+$/.test(text)) {
    return false;
  }
  if (/^[A-Z]\)?$/.test(text)) {
    return false;
  }
  return /[A-Za-z]/.test(text);
}

function renderTranslation(node, translated) {
  if (node.querySelector(":scope > .math-trans-translation")) {
    return;
  }

  const translation = document.createElement(settings.displayMode === "inline" ? "span" : "div");
  translation.className = `math-trans-translation math-trans-${settings.displayMode}`;
  translation.textContent = translated;
  translation.setAttribute("lang", settings.targetLang);
  node.appendChild(translation);
}

function showStatus(message) {
  let status = document.querySelector(".math-trans-status");
  if (!status) {
    status = document.createElement("div");
    status.className = "math-trans-status";
    document.documentElement.appendChild(status);
  }

  status.textContent = message;
  clearTimeout(showStatus.timer);
  showStatus.timer = setTimeout(() => status.remove(), 5000);
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}
