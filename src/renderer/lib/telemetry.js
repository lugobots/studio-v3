export function shouldLoadTelemetry({ enabled, measurementId }) {
  return Boolean(enabled) && typeof measurementId === "string" && measurementId.length > 0;
}

export function applyTelemetry(documentRef, config) {
  const id = config.measurementId || "";
  const script = documentRef.getElementById("studio-ga4");
  if (!shouldLoadTelemetry({ enabled: config.telemetryEnabled, measurementId: id })) {
    if (id) {
      documentRef.defaultView[`ga-disable-${id}`] = true;
    }
    script?.remove();
    return false;
  }

  documentRef.defaultView[`ga-disable-${id}`] = false;
  if (script) {
    return true;
  }

  const tag = documentRef.createElement("script");
  tag.id = "studio-ga4";
  tag.async = true;
  tag.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  documentRef.head.append(tag);

  const view = documentRef.defaultView;
  view.dataLayer = view.dataLayer || [];
  view.gtag = function gtag() {
    view.dataLayer.push(arguments);
  };
  view.gtag("js", new Date());
  view.gtag("config", id);
  return true;
}
