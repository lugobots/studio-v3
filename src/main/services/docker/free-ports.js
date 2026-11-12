"use strict";

const net = require("node:net");

/**
 * Listen on `port` (or an ephemeral port when `port` is 0).
 * Resolves with the server on success, or `null` if the bind fails.
 */
function listen(port, host = "0.0.0.0") {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(null));
    server.listen(port, host, () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

/**
 * Resolve preferred host ports to free ones.
 * Keeps a preferred port when it is bindable; otherwise allocates an ephemeral free port.
 * Holds all successful binds until the full set is resolved so chosen ports stay unique.
 *
 * @param {Record<string, string|number>} preferred map of name → preferred host port
 * @returns {Promise<Record<string, string>>} same keys → resolved host port strings
 */
async function resolveHostPorts(preferred) {
  const entries = Object.entries(preferred || {});
  const servers = [];
  const resolved = {};

  try {
    for (const [key, value] of entries) {
      const preferredNum = Number(value);
      let server = null;
      if (Number.isInteger(preferredNum) && preferredNum > 0) {
        server = await listen(preferredNum);
      }
      if (!server) {
        server = await listen(0);
      }
      if (!server) {
        throw new Error(`Could not find a free host port for ${key}`);
      }
      const address = server.address();
      const port = address && address.port;
      if (!port) {
        await closeServer(server);
        throw new Error(`Could not find a free host port for ${key}`);
      }
      servers.push(server);
      resolved[key] = String(port);
    }
  } catch (error) {
    await Promise.all(servers.map(closeServer));
    throw error;
  }

  await Promise.all(servers.map(closeServer));
  return resolved;
}

module.exports = { resolveHostPorts, listen };
