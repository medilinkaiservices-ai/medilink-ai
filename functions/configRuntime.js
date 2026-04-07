"use strict";

const fs = require("fs");
const path = require("path");

function getConfigValue(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) || "";
}

let cachedEnvFileValues = null;
let cachedLocalFunctionParams = null;

function parseEnvFile(content) {
  const result = {};

  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    value = value.replace(/\\n/g, "\n");
    result[key] = value;
  }

  return result;
}

function loadEnvFileValues() {
  if (cachedEnvFileValues) {
    return cachedEnvFileValues;
  }

  const candidates = [
    path.join(__dirname, ".env"),
    path.join(__dirname, "..", ".env")
  ];

  cachedEnvFileValues = {};

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      cachedEnvFileValues = {
        ...cachedEnvFileValues,
        ...parseEnvFile(fs.readFileSync(candidate, "utf8"))
      };
    } catch (_error) {
      // Ignore malformed or unreadable optional env files and continue.
    }
  }

  return cachedEnvFileValues;
}

function loadLocalFunctionParams() {
  if (cachedLocalFunctionParams) {
    return cachedLocalFunctionParams;
  }

  try {
    const firebaseConfigPath = path.join(__dirname, "firebase.json");
    if (!fs.existsSync(firebaseConfigPath)) {
      cachedLocalFunctionParams = {};
      return cachedLocalFunctionParams;
    }

    const parsed = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf8"));
    cachedLocalFunctionParams = parsed?.functions?.params || {};
    return cachedLocalFunctionParams;
  } catch (_error) {
    cachedLocalFunctionParams = {};
    return cachedLocalFunctionParams;
  }
}

function getLocalParamValue(...keys) {
  const params = loadLocalFunctionParams();
  for (const key of keys) {
    const value = params?.[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

function getEnvValue(...keys) {
  const envFileValues = loadEnvFileValues();

  for (const key of keys) {
    const direct = getConfigValue(process.env[key], process.env[key?.toLowerCase?.()]);
    if (direct) return direct;

    const fileValue = envFileValues?.[key] || envFileValues?.[String(key || "").toLowerCase()];
    if (typeof fileValue === "string" && fileValue.trim()) {
      return fileValue;
    }
  }

  return "";
}

function getGeminiKey() {
  const configured = getEnvValue(
    "GEMINI_KEY",
    "gemini_key",
    "GOOGLE_API_KEY",
    "google_api_key",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "google_generative_ai_api_key"
  );

  if (configured && !/YOUR_ACTUAL_GEMINI_API_KEY_HERE/i.test(configured)) {
    return configured;
  }

  return getLocalParamValue(
    "GEMINI_KEY",
    "gemini_key",
    "GOOGLE_API_KEY",
    "google_api_key"
  );
}

function getWebAppUrl() {
  return getEnvValue(
    "WEB_APP_URL",
    "web_app_url",
    "WEB_APP_DOMAIN",
    "web_app_domain",
    "APP_URL",
    "app_url"
  );
}

function getOpenAIKey() {
  return getEnvValue(
    "OPENAI_API_KEY",
    "openai_api_key"
  );
}

function getOpenAIModel() {
  return getEnvValue(
    "OPENAI_MODEL",
    "openai_model"
  ) || "gpt-4.1-mini";
}

function getRazorpayKeyId() {
  return getEnvValue(
    "RAZORPAY_KEY_ID",
    "razorpay_key_id"
  );
}

function getRazorpayKeySecret() {
  return getEnvValue(
    "RAZORPAY_KEY_SECRET",
    "razorpay_key_secret"
  );
}

function getWhatsappToken() {
  const configured = getEnvValue(
    "WHATSAPP_TOKEN",
    "whatsapp_token"
  );

  if (configured && !/YOUR_WHATSAPP_TOKEN/i.test(configured)) {
    return configured;
  }

  return "";
}

function getWhatsappPhoneNumberId() {
  const configured = getEnvValue(
    "WHATSAPP_PHONE_NUMBER_ID",
    "whatsapp_phone_id"
  );

  if (configured && !/YOUR_PHONE_ID/i.test(configured)) {
    return configured;
  }

  return "";
}

function getLegalLiveRetrievalEnabled() {
  const rawValue = String(getEnvValue(
    "LEGAL_LIVE_RETRIEVAL",
    "legal_live_retrieval"
  )).trim().toLowerCase();

  if (!rawValue) return true;
  return ["1", "true", "yes", "on"].includes(rawValue);
}

module.exports = {
  getConfigValue,
  getLocalParamValue,
  getGeminiKey,
  getOpenAIKey,
  getOpenAIModel,
  getRazorpayKeyId,
  getRazorpayKeySecret,
  getWebAppUrl,
  getWhatsappToken,
  getWhatsappPhoneNumberId,
  getLegalLiveRetrievalEnabled
};
