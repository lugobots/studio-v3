"use strict";

const COMPOSE_FILE_NAME = "docker-compose.yml";
const EMPTY_SELECTION_ERROR = "No folder was selected.";
const INVALID_BOT_ERROR = "This folder does not contain a Lugo bot.";
const PICKER_FAILED_ERROR = "Could not open the folder picker.";
const SAVE_FAILED_ERROR = "Could not save project settings.";
const DIALOG_PROPERTIES = ["openDirectory"];
const DIALOG_TITLE = "Open existing bot";

function invalidBotMessage(folder) {
  if (typeof folder === "string" && folder.trim()) {
    return `This folder does not contain a Lugo bot: "${folder}"`;
  }
  return INVALID_BOT_ERROR;
}

module.exports = {
  COMPOSE_FILE_NAME,
  DIALOG_PROPERTIES,
  DIALOG_TITLE,
  EMPTY_SELECTION_ERROR,
  INVALID_BOT_ERROR,
  PICKER_FAILED_ERROR,
  SAVE_FAILED_ERROR,
  invalidBotMessage,
};
