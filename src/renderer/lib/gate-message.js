let message = "The Studio API is not available.";

export function setGateMessage(value) {
  if (value) {
    message = value;
  }
}

export function gateMessage() {
  return message;
}
