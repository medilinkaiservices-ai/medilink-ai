"use strict";

const axios = require("axios");
const {
  getGeminiKey,
  getOpenAIKey,
  getOpenAIModel
} = require("../configRuntime");

function getActiveProvider() {
  if (getOpenAIKey()) return "openai";
  if (getGeminiKey()) return "gemini";
  return "none";
}

async function executeWithOpenAI(prompt) {
  const response = await axios.post(
    "https://api.openai.com/v1/responses",
    {
      model: getOpenAIModel(),
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "You are a legal copilot. Generate the requested legal work product directly. Do not ask for confirmation."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt
            }
          ]
        }
      ],
      temperature: 0.2
    },
    {
      headers: {
        Authorization: `Bearer ${getOpenAIKey()}`,
        "Content-Type": "application/json"
      }
    }
  );

  return String(response.data?.output_text || "").trim();
}

async function executeWithGemini(prompt) {
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${getGeminiKey()}`,
    {
      contents: [
        {
          parts: [
            {
              text: [
                "You are a legal copilot.",
                "Generate the requested legal output immediately.",
                "Do not ask for confirmation.",
                "",
                prompt
              ].join("\n")
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2
      }
    },
    {
      headers: {
        "Content-Type": "application/json"
      }
    }
  );

  return String(response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
}

function createExecutor() {
  return async function execute(prompt) {
    if (getOpenAIKey()) {
      return executeWithOpenAI(prompt);
    }

    if (getGeminiKey()) {
      return executeWithGemini(prompt);
    }

    return [
      "No AI provider key is configured.",
      "The copilot prompt below is ready to send once OPENAI_API_KEY or GEMINI_KEY is set.",
      "",
      prompt.slice(0, 4000)
    ].join("\n");
  };
}

module.exports = {
  createExecutor,
  getActiveProvider
};
