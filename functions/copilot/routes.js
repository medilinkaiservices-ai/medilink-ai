"use strict";

const express = require("express");
const controller = require("./controller");

function createCopilotRouter() {
  const router = express.Router();

  router.post("/session/start", controller.startSession);
  router.get("/session/:id", controller.getSession);
  router.post("/session/:id/intake", controller.intake);
  router.post("/session/:id/context", controller.context);
  router.post("/session/:id/actions", controller.actions);
  router.post("/session/:id/chat", controller.chat);
  router.post("/session/:id/draft", controller.draft);
  router.post("/session/:id/validate", controller.validate);
  router.post("/session/:id/autofix", controller.autofix);
  router.post("/session/:id/filing", controller.filing);

  return router;
}

module.exports = {
  createCopilotRouter
};
