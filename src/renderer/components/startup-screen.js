import { getHost } from "../lib/api.js";

const BACKGROUND = "rgb(144, 204, 199)";
const WAITING_IMAGE = "./assets/waiting-robot.png";

const INITIAL = {
  phase: "docker",
  label: "Checking Docker",
  detail: "Checking Docker and your bot.",
  percent: 12,
  steps: [
    { id: "docker", label: "Checking Docker", state: "current" },
    { id: "image", label: "Preparing the Studio image", state: "pending" },
    { id: "container", label: "Starting the Studio API", state: "pending" },
    { id: "health", label: "Waiting for the Studio API", state: "pending" },
  ],
};

let latest = INITIAL;

export function noteStartupProgress(progress) {
  if (progress && progress.label && progress.phase !== "ready") {
    latest = progress;
  }
}

function renderStep(doc, step) {
  const item = doc.createElement("li");
  item.className = `api-gate-step is-${step.state}`;
  if (step.state === "current") {
    item.setAttribute("aria-current", "step");
  }
  const dot = doc.createElement("span");
  dot.className = "api-gate-dot";
  dot.setAttribute("aria-hidden", "true");
  const text = doc.createElement("span");
  text.textContent = step.label;
  item.append(dot, text);
  return item;
}

export function renderStartupScreen(outlet, doc = globalThis.document) {
  const page = doc.createElement("section");
  page.className = "api-gate";
  page.style.backgroundColor = BACKGROUND;

  const image = doc.createElement("img");
  image.className = "api-gate-hero";
  image.alt = "Waiting robot";
  image.src = WAITING_IMAGE;

  const kicker = doc.createElement("p");
  kicker.className = "api-gate-kicker";
  kicker.textContent = "Starting Studio";

  const status = doc.createElement("div");
  status.className = "api-gate-status";
  const spinner = doc.createElement("span");
  spinner.className = "api-gate-spinner";
  spinner.setAttribute("aria-hidden", "true");
  const title = doc.createElement("p");
  title.className = "api-gate-text";
  status.append(spinner, title);

  const detail = doc.createElement("p");
  detail.className = "api-gate-detail";

  const percent = doc.createElement("p");
  percent.className = "api-gate-percent";

  const track = doc.createElement("div");
  track.className = "api-gate-track";
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  const fill = doc.createElement("div");
  fill.className = "api-gate-fill";
  track.append(fill);

  const steps = doc.createElement("ol");
  steps.className = "api-gate-steps";

  const logs = doc.createElement("pre");
  logs.className = "api-gate-logs";
  logs.hidden = true;

  page.append(image, kicker, status, detail, percent, track, steps, logs);
  outlet.append(page);

  let disposed = false;

  function apply(progress) {
    if (disposed || !progress || !progress.label) {
      return;
    }
    if (progress.phase !== "ready") {
      latest = progress;
    }
    const value = Number(progress.percent) || 0;
    kicker.textContent = progress.flow === "create" ? "Creating your bot" : "Starting Studio";
    title.textContent = progress.label;
    detail.textContent = progress.detail || "";
    percent.textContent = `${value}%`;
    fill.style.width = `${value}%`;
    track.setAttribute("aria-valuenow", String(value));
    track.setAttribute("aria-valuetext", `${value}% ${progress.label}`);
    const busy = progress.phase !== "ready";
    spinner.hidden = !busy;
    track.classList.toggle("is-busy", busy);
    steps.replaceChildren(...(progress.steps || []).map((step) => renderStep(doc, step)));
    const logLines = Array.isArray(progress.logs) ? progress.logs : [];
    if (logLines.length > 0) {
      logs.hidden = false;
      logs.textContent = logLines.join("\n");
      logs.scrollTop = logs.scrollHeight;
    } else {
      logs.hidden = true;
      logs.textContent = "";
    }
  }

  apply(latest.phase === "ready" ? INITIAL : latest);
  const seen = latest;

  const host = getHost();
  const stops = [];
  if (host.startup.onProgress) {
    stops.push(host.startup.onProgress((progress) => apply(progress)));
  }
  if (host.startup.current) {
    Promise.resolve(host.startup.current())
      .then((snapshot) => {
        if (latest === seen) {
          apply(snapshot);
        }
      })
      .catch(() => {});
  }

  return () => {
    disposed = true;
    for (const stop of stops) {
      stop();
    }
  };
}
