package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
)

const defaultProjectRoot = "/home/coder/project"

// NewMux returns the Studio V3 API HTTP handler.
func NewMux() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", handleHealth)
	mux.HandleFunc("GET /api/studio/status", handleStudioStatus)
	return mux
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "OK"})
}

func handleStudioStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, studioStatus())
}

func studioStatus() map[string]string {
	root := os.Getenv("BOT_SOURCE_PATH")
	if root == "" {
		root = defaultProjectRoot
	}
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

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}
