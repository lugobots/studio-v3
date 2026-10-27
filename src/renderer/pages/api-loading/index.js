const BACKGROUND = "rgb(144, 204, 199)";
const WAITING_IMAGE = "./assets/waiting-robot.png";

export function renderApiLoading(outlet, doc = globalThis.document) {
  const page = doc.createElement("section");
  page.className = "api-gate";
  page.style.backgroundColor = BACKGROUND;
  const text = doc.createElement("p");
  text.className = "api-gate-text";
  text.textContent = "Please wait a few seconds.";
  const detail = doc.createElement("p");
  detail.className = "api-gate-text";
  detail.textContent = "The Studio API is not started yet.";
  const image = doc.createElement("img");
  image.alt = "Waiting robot";
  image.src = WAITING_IMAGE;
  page.append(text, detail, image);
  outlet.append(page);
}
