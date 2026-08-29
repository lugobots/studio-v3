import { createShell } from "./layout/shell.js";
import { registerRoute, startRouter } from "./lib/router.js";
import { renderLoading } from "./pages/loading/index.js";
import { renderDockerCheck } from "./pages/docker-check/index.js";
import { renderStartProject } from "./pages/start-project/index.js";
import { renderMain } from "./pages/main/index.js";

registerRoute("/loading", renderLoading);
registerRoute("/docker-check", renderDockerCheck);
registerRoute("/start-project", renderStartProject);
registerRoute("/main", renderMain);

const { root, outlet } = createShell();
document.body.append(root);
startRouter(outlet);
