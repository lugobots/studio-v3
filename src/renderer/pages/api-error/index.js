import { gateMessage, setGateMessage } from "../../lib/gate-message.js";
import { getHost } from "../../lib/api.js";
import { navigate } from "../../lib/router.js";

const BACKGROUND = "rgb(144, 204, 199)";
const BROKEN_IMAGE = "./assets/error-robot.png";

export function renderApiError(outlet, doc = globalThis.document) {
  const page = doc.createElement("section");
  page.className = "api-gate";
  page.style.backgroundColor = BACKGROUND;
  const text = doc.createElement("p");
  text.className = "api-gate-text";
  text.textContent = gateMessage();
  const image = doc.createElement("img");
  image.alt = "Broken robot";
  image.src = BROKEN_IMAGE;
  const retry = doc.createElement("button");
  retry.type = "button";
  retry.className = "button api-gate-retry";
  retry.textContent = "Try again";
  retry.addEventListener("click", async () => {
    const next = await getHost().startup.retry();
    setGateMessage(next.message);
    navigate(next.route);
  });
  page.append(text, image, retry);
  outlet.append(page);
}
