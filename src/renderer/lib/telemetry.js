/**
 * Renderer-side telemetry helpers.
 * Collection is owned by the main-process Aptabase facade; this module only
 * gates UI sync and forwards events through `host.telemetry.track`.
 */

export function shouldCollectTelemetry({ enabled, aptabaseAppKey }) {
  return Boolean(enabled) && typeof aptabaseAppKey === "string" && aptabaseAppKey.length > 0;
}

/** @deprecated Alias kept for older call sites; use shouldCollectTelemetry. */
export function shouldLoadTelemetry({ enabled, measurementId, aptabaseAppKey }) {
  const key = aptabaseAppKey != null ? aptabaseAppKey : measurementId;
  return shouldCollectTelemetry({ enabled, aptabaseAppKey: key });
}

/**
 * Sync collector preference with main (no GA script injection).
 * Returns whether collection is currently allowed given config.
 */
export function applyTelemetry(_documentRef, config, host) {
  const enabled = config?.telemetryEnabled !== false;
  const aptabaseAppKey = config?.aptabaseAppKey || "";
  if (host?.telemetry && typeof host.telemetry.setEnabled === "function") {
    void host.telemetry.setEnabled(enabled);
  }
  return shouldCollectTelemetry({ enabled, aptabaseAppKey });
}

export function trackTelemetry(host, name, props) {
  if (!host?.telemetry || typeof host.telemetry.track !== "function") {
    return false;
  }
  void host.telemetry.track(name, props);
  return true;
}
