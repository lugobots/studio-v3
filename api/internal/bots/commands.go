package bots

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	SideHome = "HOME"
	SideAway = "AWAY"

	goPlayerBinaryName = "go-player-command"
	defaultOpponentMode = "default"
	playersPerSide      = 11
)

// botEnv returns the production SDK env vars for a bot process.
func botEnv(side string, number int, grpcURL, mode string) map[string]string {
	env := map[string]string{
		"BOT_NUMBER":   fmt.Sprintf("%d", number),
		"BOT_TEAM":     side,
		"BOT_GRPC_URL": grpcURL,
	}
	if mode != "" {
		env["MODE"] = mode
	}
	return env
}

func goBinaryPath(cacheDir string) string {
	return filepath.Join(cacheDir, goPlayerBinaryName)
}

func goPrepareCommand(projectRoot, cacheDir string) (string, map[string]string) {
	cmd := fmt.Sprintf("go build -C %s -o %s main.go", shellQuote(projectRoot), shellQuote(goBinaryPath(cacheDir)))
	env := map[string]string{
		"GOCACHE":    filepath.Join(cacheDir, "go-cache"),
		"GOMODCACHE": filepath.Join(cacheDir, "go-mod-cache"),
	}
	return cmd, env
}

func goStartCommand(cacheDir string) string {
	return shellQuote(goBinaryPath(cacheDir))
}

func pythonVenvPython(projectRoot string) string {
	candidates := []string{
		filepath.Join(projectRoot, ".studio", "venv-lugo", "bin", "python3.9"),
		filepath.Join(projectRoot, ".studio", "venv-lugo", "bin", "python3"),
	}
	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

func pythonPrepareCommands(projectRoot string) []string {
	if pythonVenvPython(projectRoot) != "" {
		return nil
	}
	venv := filepath.Join(projectRoot, ".studio", "venv-lugo")
	return []string{
		fmt.Sprintf("mkdir -p %s", shellQuote(filepath.Join(projectRoot, ".studio"))),
		fmt.Sprintf("python3 -m venv %s", shellQuote(venv)),
		fmt.Sprintf("%s -m pip install --no-compile -r requirements.txt",
			shellQuote(filepath.Join(venv, "bin", "python3"))),
	}
}

func pythonStartCommand(projectRoot string) string {
	py := pythonVenvPython(projectRoot)
	if py == "" {
		py = "python3"
	}
	return fmt.Sprintf("%s -u src/main.py", shellQuote(py))
}

func jsPrepareCommands() []string {
	return []string{
		"npm install",
		"npm run tsc",
	}
}

func jsStartCommand() string {
	return "node .dist/main.js"
}

// shellQuote wraps s in single quotes for safe inclusion in `sh -c` strings.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
