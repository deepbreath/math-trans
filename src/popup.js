const fields = [
  "enabled",
  "provider",
  "targetLang",
  "displayMode",
  "googleTranslateUrl",
  "geminiApiKey",
  "geminiModel",
  "openaiApiKey",
  "openaiModel"
];

document.addEventListener("DOMContentLoaded", async () => {
  const settings = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  fillForm(settings);
  document.querySelector("#provider").addEventListener("change", updateProviderFields);
  document.querySelector("#save").addEventListener("click", save);
  updateProviderFields();
});

function fillForm(settings) {
  for (const field of fields) {
    const element = document.querySelector(`#${field}`);
    if (!element) {
      continue;
    }
    if (element.type === "checkbox") {
      element.checked = Boolean(settings[field]);
    } else {
      element.value = settings[field] || "";
    }
  }
}

function updateProviderFields() {
  const provider = document.querySelector("#provider").value;
  for (const group of document.querySelectorAll("[data-provider-fields]")) {
    group.hidden = group.dataset.providerFields !== provider;
  }
}

async function save() {
  const settings = {};
  for (const field of fields) {
    const element = document.querySelector(`#${field}`);
    if (!element) {
      continue;
    }
    settings[field] = element.type === "checkbox" ? element.checked : element.value;
  }

  const result = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
  const status = document.querySelector("#status");
  status.textContent = result.ok ? "Saved" : "Save failed";
}
