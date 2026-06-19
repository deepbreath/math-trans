const SELECTOR =
  "p, li, h1, h2, h3, h4, h5, h6, button, label, summary, figcaption, [role='button'], [aria-label]";

const SKIP_SELECTOR =
  "script, style, noscript, code, pre, textarea, input, select, option, svg, canvas, math, table, .math-trans-translation";

const EMBEDDED_TEXT_SELECTOR = "object, img, svg, math, [aria-label], [alt], [title]";

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
      renderTranslation(node, normalizeMathText(translated));
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
    if (isLikelyVisualOnlyNode(node)) {
      return false;
    }
    if (!isVisible(node) || hasTranslatedAncestor(node)) {
      return false;
    }

    if (!hasHumanReadableEnglishText(node)) {
      return false;
    }

    const text = getNodeReadableText(node);
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
  const parentText = normalizeText(parent.dataset.mathTransSource || getNodeReadableText(parent));
  const nodeText = getNodeReadableText(node);
  return parentText.includes(nodeText);
}

function getNodeReadableText(node) {
  const directLabel = getElementLabel(node);
  if (directLabel && isMostlyNonTextContainer(node)) {
    return directLabel;
  }

  const parts = [];
  collectReadableParts(node, parts);
  return normalizeText(parts.join(" "));
}

function collectReadableParts(node, parts) {
  if (node.nodeType === Node.TEXT_NODE) {
    parts.push(node.textContent || "");
    return;
  }

  if (!(node instanceof HTMLElement || node instanceof SVGElement || isMathElement(node))) {
    return;
  }

  if (node.matches?.(".math-trans-translation, script, style, noscript")) {
    return;
  }

  if (node.matches?.(EMBEDDED_TEXT_SELECTOR)) {
    const embeddedText = getEmbeddedText(node);
    if (embeddedText) {
      parts.push(embeddedText);
      return;
    }
  }

  for (const child of node.childNodes) {
    collectReadableParts(child, parts);
  }
}

function getEmbeddedText(node) {
  const text = normalizeMathText(
    [
      getElementLabel(node),
      getMathAnnotationText(node),
      getObjectDocumentText(node),
      getSvgTitleText(node)
    ]
      .filter(Boolean)
      .join(" ")
  );

  return shouldKeepEmbeddedMathText(text) ? text : "";
}

function getElementLabel(node) {
  if (!(node instanceof Element)) {
    return "";
  }

  return normalizeMathText(
    node.getAttribute("aria-label") ||
      node.getAttribute("alt") ||
      node.getAttribute("title") ||
      node.getAttribute("data-value") ||
      node.getAttribute("data-text") ||
      node.getAttribute("data-latex") ||
      node.getAttribute("data-tex") ||
      ""
  );
}

function getMathAnnotationText(node) {
  if (!(node instanceof Element)) {
    return "";
  }

  const annotation = node.querySelector?.("annotation, annotation-xml");
  return normalizeMathText(annotation?.textContent || "");
}

function getObjectDocumentText(node) {
  if (!(node instanceof HTMLObjectElement)) {
    return "";
  }

  try {
    const doc = node.contentDocument;
    return normalizeMathText(doc?.body?.innerText || doc?.documentElement?.textContent || "");
  } catch {
    return "";
  }
}

function getSvgTitleText(node) {
  if (!(node instanceof SVGElement)) {
    return "";
  }

  return normalizeMathText(
    Array.from(node.querySelectorAll("title, desc"))
      .map((item) => item.textContent || "")
      .join(" ")
  );
}

function isMostlyNonTextContainer(node) {
  return node.matches?.("object, img, svg, math") || false;
}

function isMathElement(node) {
  return typeof MathMLElement !== "undefined" && node instanceof MathMLElement;
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

function hasHumanReadableEnglishText(node) {
  const textParts = [];
  collectDirectHumanText(node, textParts);
  return /[A-Za-z]/.test(normalizeText(textParts.join(" ")));
}

function collectDirectHumanText(node, parts) {
  if (node.nodeType === Node.TEXT_NODE) {
    parts.push(node.textContent || "");
    return;
  }

  if (!(node instanceof Element)) {
    return;
  }

  if (node.matches(".math-trans-translation, script, style, noscript, object, img, svg, math")) {
    return;
  }

  for (const child of node.childNodes) {
    collectDirectHumanText(child, parts);
  }
}

function isLikelyVisualOnlyNode(node) {
  if (!node.matches?.("[aria-label], [role='button']")) {
    return false;
  }

  if (node.matches("p, li, h1, h2, h3, h4, h5, h6, button, label, summary, figcaption")) {
    return false;
  }

  const text = getNodeReadableText(node);
  return isMathOnlyText(text) || text.length < 12;
}

function isMathOnlyText(text) {
  return /^[\d\s.,:;+\-*/=()[\]{}<>%$#|√·×÷≤≥≠≈±^_]+$/.test(normalizeText(text));
}

function shouldKeepEmbeddedMathText(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }
  if (!isMathOnlyText(normalized)) {
    return true;
  }

  const numbers = normalized.match(/\d+(?:\.\d+)?/g) || [];
  return normalized.length <= 24 && numbers.length <= 4;
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

function normalizeMathText(text) {
  let value = normalizeText(text);
  if (!value) {
    return "";
  }

  for (let index = 0; index < 4; index += 1) {
    value = value
      .replace(/\\phantom\{[^{}]*\}/g, "")
      .replace(/\\color\{[^{}]*\}\{([^{}]*)\}/g, "$1")
      .replace(/\\color\{[^{}]*\}/g, "")
      .replace(/\\mathbin\{([^{}]*)\}/g, "$1")
      .replace(/\\mathbf\{([^{}]*)\}/g, "$1")
      .replace(/\\mathrm\{([^{}]*)\}/g, "$1")
      .replace(/\\text\{([^{}]*)\}/g, "$1")
      .replace(/\\sqrt\{([^{}]*)\}/g, "√$1")
      .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2");
  }

  value = value
    .replace(/\\(?:quad|qquad|,|;|:|!)/g, " ")
    .replace(/\\\\/g, " ")
    .replace(/\\cdot/g, "·")
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/\\approx/g, "≈")
    .replace(/\\pm/g, "±")
    .replace(/\\left|\\right/g, "")
    .replace(/\^\{([^{}]*)\}/g, "^$1")
    .replace(/_\{([^{}]*)\}/g, "_$1")
    .replace(/[{}]/g, "")
    .replace(/\bcolor(?:blue|red|green|purple|orange|yellow|black|white|gray|grey)?(?=[\d√])/gi, "")
    .replace(/\b(?:blue|red|green|purple|orange|yellow|black|white|gray|grey)color(?=[\d√])/gi, "")
    .replace(/(?:颜色)?(?:蓝色|红色|绿色|紫色|橙色|黄色|黑色|白色|灰色)(?=[\d√])/g, "")
    .replace(/(?<=[\d√])(?:颜色)?(?:蓝色|红色|绿色|紫色|橙色|黄色|黑色|白色|灰色)/g, "")
    .replace(/\\([a-zA-Z]+)/g, "$1")
    .replace(/\\([^\s])/g, "$1")
    .replace(/\b(?:quad|qquad|thinspace|enspace|hspace|vspace)\b/gi, " ")
    .replace(/\s+([,.;:])/g, "$1");

  return normalizeText(value);
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}
