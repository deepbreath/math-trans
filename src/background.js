const DEFAULT_SETTINGS = {
  enabled: true,
  provider: "google-web",
  sourceLang: "auto",
  targetLang: "zh",
  displayMode: "below",
  googleTranslateUrl: "https://translate.google.com",
  geminiApiKey: "",
  geminiModel: "gemini-3.5-flash",
  openaiApiKey: "",
  openaiModel: "gpt-5.4-mini",
  batchSize: 12
};

const translationCache = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  await chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...stored });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_SETTINGS") {
    getSettings().then(sendResponse);
    return true;
  }

  if (message?.type === "SAVE_SETTINGS") {
    saveSettings(message.settings).then(sendResponse);
    return true;
  }

  if (message?.type === "TRANSLATE_TEXTS") {
    translateTexts(message.texts || []).then(sendResponse);
    return true;
  }

  if (message?.type === "REFRESH_ACTIVE_TAB") {
    refreshActiveTab().then(sendResponse);
    return true;
  }

  return false;
});

async function getSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function saveSettings(settings) {
  const current = await getSettings();
  const next = sanitizeSettings({ ...current, ...settings });
  await chrome.storage.sync.set(next);
  await refreshActiveTab();
  return { ok: true, settings: next };
}

function sanitizeSettings(settings = {}) {
  return {
    enabled: Boolean(settings.enabled),
    provider: ["google-web", "gemini", "openai"].includes(settings.provider)
      ? settings.provider
      : DEFAULT_SETTINGS.provider,
    sourceLang: stringOr(settings.sourceLang, DEFAULT_SETTINGS.sourceLang),
    targetLang: stringOr(settings.targetLang, DEFAULT_SETTINGS.targetLang),
    displayMode: ["below", "inline"].includes(settings.displayMode)
      ? settings.displayMode
      : DEFAULT_SETTINGS.displayMode,
    googleTranslateUrl: normalizeGoogleTranslateUrl(settings.googleTranslateUrl),
    geminiApiKey: stringOr(settings.geminiApiKey, "").trim(),
    geminiModel: normalizeGeminiModel(settings.geminiModel),
    openaiApiKey: stringOr(settings.openaiApiKey, "").trim(),
    openaiModel: stringOr(settings.openaiModel, DEFAULT_SETTINGS.openaiModel).trim(),
    batchSize: clampNumber(settings.batchSize, 1, 30, DEFAULT_SETTINGS.batchSize)
  };
}

function stringOr(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeGoogleTranslateUrl(value) {
  const raw = stringOr(value, DEFAULT_SETTINGS.googleTranslateUrl).trim();
  if (!raw) {
    return DEFAULT_SETTINGS.googleTranslateUrl;
  }
  return raw.startsWith("http") ? raw.replace(/\/$/, "") : `https://${raw.replace(/\/$/, "")}`;
}

function normalizeGeminiModel(value) {
  const raw = stringOr(value, DEFAULT_SETTINGS.geminiModel).trim();
  const model = raw.replace(/^models\//, "");
  return model || DEFAULT_SETTINGS.geminiModel;
}

async function translateTexts(texts) {
  const settings = await getSettings();
  const cleanTexts = [...new Set(texts.map(normalizeText).filter(Boolean))];

  if (!settings.enabled) {
    return { ok: true, translations: {}, skipped: "disabled" };
  }

  const readinessError = getProviderReadinessError(settings);
  if (readinessError) {
    return { ok: false, translations: {}, error: readinessError };
  }

  const translations = {};
  const missing = [];

  for (const text of cleanTexts) {
    const key = cacheKey(settings, text);
    if (translationCache.has(key)) {
      translations[text] = translationCache.get(key);
    } else {
      missing.push(text);
    }
  }

  for (const batch of chunk(missing, settings.batchSize)) {
    let batchTranslations = {};
    try {
      batchTranslations = await requestProviderTranslations(settings, batch);
    } catch (error) {
      return {
        ok: false,
        translations,
        error: error instanceof Error ? error.message : "Translation request failed."
      };
    }

    for (const [source, translated] of Object.entries(batchTranslations)) {
      if (!translated || translated === source) {
        continue;
      }
      translationCache.set(cacheKey(settings, source), translated);
      translations[source] = translated;
    }
  }

  return { ok: true, translations };
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function cacheKey(settings, text) {
  return [
    settings.provider,
    getProviderCacheScope(settings),
    settings.sourceLang,
    settings.targetLang,
    text
  ].join("\n");
}

function getProviderCacheScope(settings) {
  if (settings.provider === "gemini") {
    return settings.geminiModel;
  }
  if (settings.provider === "openai") {
    return settings.openaiModel;
  }
  return settings.googleTranslateUrl;
}

function getProviderReadinessError(settings) {
  if (settings.provider === "gemini" && !settings.geminiApiKey) {
    return "Please configure a Gemini API key first.";
  }
  if (settings.provider === "openai" && !settings.openaiApiKey) {
    return "Please configure an OpenAI API key first.";
  }
  return "";
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function requestProviderTranslations(settings, texts) {
  if (settings.provider === "gemini") {
    return requestGeminiTranslate(settings, texts);
  }
  if (settings.provider === "openai") {
    return requestOpenAiTranslate(settings, texts);
  }
  return requestGoogleWebTranslate(settings, texts);
}

async function requestGoogleWebTranslate(settings, texts) {
  const translations = {};

  for (const text of texts) {
    const url = new URL(`${settings.googleTranslateUrl}/translate_a/single`);
    for (const [key, value] of buildGoogleWebQuery(settings, text)) {
      url.searchParams.append(key, value);
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        accept: "application/json, text/plain, */*"
      }
    });

    if (!response.ok) {
      throw new Error(`Google web translate returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    translations[text] = normalizeText(parseGoogleWebTranslation(payload));
  }

  return translations;
}

function buildGoogleWebQuery(settings, text) {
  return [
    ["dt", "at"],
    ["dt", "bd"],
    ["dt", "ex"],
    ["dt", "ld"],
    ["dt", "md"],
    ["dt", "qca"],
    ["dt", "rw"],
    ["dt", "rm"],
    ["dt", "ss"],
    ["dt", "t"],
    ["client", "gtx"],
    ["sl", settings.sourceLang || "auto"],
    ["tl", settings.targetLang],
    ["hl", settings.targetLang],
    ["ie", "UTF-8"],
    ["oe", "UTF-8"],
    ["otf", "1"],
    ["ssel", "0"],
    ["tsel", "0"],
    ["kc", "7"],
    ["q", text]
  ];
}

function parseGoogleWebTranslation(payload) {
  const translationRows = Array.isArray(payload?.[0]) ? payload[0] : [];
  return translationRows
    .map((row) => (Array.isArray(row) && typeof row[0] === "string" ? row[0] : ""))
    .join("");
}

async function requestGeminiTranslate(settings, texts) {
  const url = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${settings.geminiModel}:generateContent`
  );

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": settings.geminiApiKey
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildTranslationPrompt(settings, texts) }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, "Gemini API"));
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  return mapBatchTranslations(texts, parseJsonArray(text));
}

async function requestOpenAiTranslate(settings, texts) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.openaiApiKey}`
    },
    body: JSON.stringify({
      model: settings.openaiModel,
      input: buildTranslationPrompt(settings, texts),
      temperature: 0,
      store: false
    })
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, "OpenAI API"));
  }

  const payload = await response.json();
  return mapBatchTranslations(texts, parseJsonArray(readOpenAiOutputText(payload)));
}

function buildTranslationPrompt(settings, texts) {
  const source = settings.sourceLang && settings.sourceLang !== "auto" ? settings.sourceLang : "auto";
  return [
    `Translate the following JSON array from ${source} to ${settings.targetLang}.`,
    "Preserve math notation, variable names, formulas, numbers, units, and code-like tokens.",
    "Return only a valid JSON array of translated strings in the same order and length.",
    JSON.stringify(texts)
  ].join("\n");
}

function readOpenAiOutputText(payload) {
  if (typeof payload?.output_text === "string") {
    return payload.output_text;
  }

  return (payload?.output || [])
    .flatMap((item) => item?.content || [])
    .map((content) => content?.text || "")
    .join("");
}

function parseJsonArray(text) {
  const raw = normalizeText(text);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) {
      return [];
    }
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

function mapBatchTranslations(texts, translatedItems) {
  return texts.reduce((result, source, index) => {
    result[source] = normalizeText(String(translatedItems[index] || ""));
    return result;
  }, {});
}

async function readApiError(response, providerName) {
  try {
    const payload = await response.json();
    const message =
      payload?.error?.message ||
      payload?.error?.details?.[0]?.reason ||
      payload?.message ||
      "";
    return message || `${providerName} returned HTTP ${response.status}`;
  } catch {
    return `${providerName} returned HTTP ${response.status}`;
  }
}

function decodeHtmlEntities(value) {
  const namedEntities = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    "#39": "'"
  };

  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const key = entity.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(namedEntities, key)) {
      return namedEntities[key];
    }
    if (key.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    }
    if (key.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    }
    return match;
  });
}

async function refreshActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.includes("mathacademy.com")) {
    return { ok: true, refreshed: false };
  }

  await chrome.tabs.sendMessage(tab.id, { type: "MATH_TRANS_REFRESH" }).catch(() => {});
  return { ok: true, refreshed: true };
}
