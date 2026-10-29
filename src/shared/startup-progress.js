"use strict";

const SETUP_STEP = { id: "setup", label: "Setting up the bot" };

const STEPS = [
  { id: "docker", label: "Checking Docker" },
  { id: "image", label: "Preparing the Studio image" },
  { id: "container", label: "Starting the Studio API" },
  { id: "health", label: "Waiting for the Studio API" },
];

const BASE_PERCENT = {
  docker: 12,
  image: 36,
  container: 64,
  setup: 74,
  health: 82,
  ready: 100,
};

function stepList(flow) {
  if (flow !== "create") {
    return STEPS;
  }
  return [STEPS[0], STEPS[1], STEPS[2], SETUP_STEP, STEPS[3]];
}

function toBytes(value, unit) {
  const size = Number(value);
  const scale = { kb: 1e3, mb: 1e6, gb: 1e9 };
  return size * (scale[String(unit).toLowerCase()] || 1);
}

function formatAmount(value, unit) {
  const number = Number(value);
  const text = number >= 100 ? String(Math.round(number)) : String(Math.round(number * 10) / 10);
  return `${text} ${String(unit).toUpperCase()}`;
}

function scalePull(value) {
  const bounded = Math.min(100, Math.max(0, value));
  return Math.round(20 + (bounded / 100) * 40);
}

function imageProgress(detail) {
  const text = String(detail || "");
  const amounts = pullProgress(text);
  if (amounts && amounts.detail !== text) {
    return amounts;
  }
  if (/extracting/i.test(text)) {
    return { percent: 52, detail: "Extracting the Studio image." };
  }
  if (/verifying/i.test(text)) {
    return { percent: 48, detail: "Verifying the Studio image." };
  }
  if (/download complete|pull complete/i.test(text)) {
    return { percent: 56, detail: "Finishing the Studio image." };
  }
  if (/pulling fs layer|\bwaiting\b|pulling from|starting pull/i.test(text)) {
    return { percent: 24, detail: "Downloading the Studio image." };
  }
  if (/ready|downloaded newer image|^status:/i.test(text)) {
    return { percent: 60, detail: /ready/i.test(text) ? text : "Studio image is ready." };
  }
  if (amounts) {
    return { percent: amounts.percent, detail: "Downloading the Studio image." };
  }
  return null;
}

function pullProgress(detail) {
  const text = String(detail || "");
  const percent = /(\d+(?:\.\d+)?)%/.exec(text);
  if (percent) {
    return { percent: scalePull(Number(percent[1])), detail: text };
  }
  const amounts = /(\d+(?:\.\d+)?)\s*([kKmMgG]B)\s*\/\s*(\d+(?:\.\d+)?)\s*([kKmMgG]B)/.exec(text);
  if (!amounts) {
    return null;
  }
  const current = toBytes(amounts[1], amounts[2]);
  const total = toBytes(amounts[3], amounts[4]);
  if (!total) {
    return null;
  }
  return {
    percent: scalePull((current / total) * 100),
    detail: `${formatAmount(amounts[1], amounts[2])} of ${formatAmount(amounts[3], amounts[4])}`,
  };
}

function describeStartup({
  phase = "docker",
  detail = "",
  elapsedMs = 0,
  deadlineMs = 180000,
  flow = "startup",
} = {}) {
  const stepsSource = stepList(flow);
  const order = [...stepsSource.map((step) => step.id), "ready"];
  const known = order.includes(phase) ? phase : "docker";
  const phaseIndex = order.indexOf(known);
  let percent = BASE_PERCENT[known];
  let readable = detail;
  if (known === "image") {
    const parsed = imageProgress(detail);
    if (parsed) {
      percent = parsed.percent;
      readable = parsed.detail;
    }
  }
  if (known === "container" && flow === "create") {
    const ratio = deadlineMs > 0 ? Math.min(1, Math.max(0, elapsedMs / deadlineMs)) : 0;
    percent = Math.round(64 + ratio * 8);
  }
  if (known === "setup") {
    const ratio = deadlineMs > 0 ? Math.min(1, Math.max(0, elapsedMs / deadlineMs)) : 0;
    percent = Math.round(74 + ratio * 7);
  }
  if (known === "health") {
    const ratio = deadlineMs > 0 ? Math.min(1, Math.max(0, elapsedMs / deadlineMs)) : 0;
    percent = Math.round(82 + ratio * 12);
  }
  const steps = stepsSource.map((step) => {
    const stepIndex = order.indexOf(step.id);
    let state = "pending";
    if (known === "ready" || stepIndex < phaseIndex) {
      state = "done";
    } else if (stepIndex === phaseIndex) {
      state = "current";
    }
    return { id: step.id, label: step.label, state };
  });
  const current = stepsSource[phaseIndex];
  return {
    flow,
    phase: known,
    label: known === "ready" ? "Studio API is ready" : current.label,
    detail: readable,
    percent,
    steps,
  };
}

module.exports = { describeStartup };
