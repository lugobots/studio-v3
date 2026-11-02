package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"studio-v3/api/internal/bottemplate"
)

const defaultProjectRoot = "/home/coder/project"

// templateInstaller copies published dummy templates; tests may replace it.
var templateInstaller bottemplate.Installer = bottemplate.DefaultInstaller()

// NewMux returns the Studio V3 API HTTP handler.
func NewMux() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", handleHealth)
	mux.HandleFunc("GET /api/studio/status", handleStudioStatus)
	mux.HandleFunc("POST /api/init/setup-new-bot", handleSetupNewBot)
	return mux
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "OK"})
}

func handleStudioStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, studioStatus())
}

func handleSetupNewBot(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid form"})
		return
	}
	lang := r.PostFormValue("lang")
	if _, ok := bottemplate.RepoForLanguage(lang); !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unsupported language"})
		return
	}
	dest := projectRoot()
	if err := templateInstaller.Install(lang, dest); err != nil {
		text := strings.TrimSpace(err.Error())
		if text == "" {
			text = "template install failed"
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": text})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "OK"})
}

func studioStatus() map[string]string {
	root := projectRoot()
	host := os.Getenv("LUGO_HOST_PROJECT_PATH")
	status := "missing"
	info, err := os.Stat(filepath.Join(root, ".lugo", "info.json"))
	if err == nil && !info.IsDir() && host != "" {
		status = "ready"
	}
	return map[string]string{
		"project_status": status,
		"project_path":   host,
	}
}

func projectRoot() string {
	root := os.Getenv("BOT_SOURCE_PATH")
	if root == "" {
		root = defaultProjectRoot
	}
	return root
}

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}
