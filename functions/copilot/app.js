"use strict";

const express = require("express");
const cors = require("cors");
const { createCopilotRouter } = require("./routes");

function createCopilotApp() {
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use("/copilot", createCopilotRouter());
  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true, service: "legal-copilot" });
  });
  return app;
}

module.exports = {
  createCopilotApp
};
