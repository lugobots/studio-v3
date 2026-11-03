package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"studio-v3/api/internal/bots"
	"studio-v3/api/internal/bottemplate"
	"studio-v3/api/internal/gameruntime"
	"studio-v3/api/internal/procreg"
)

const defaultProjectRoot = "/home/coder/project"

// templateInstaller copies published dummy templates; tests may replace it.
var templateInstaller bottemplate.Installer = bottemplate.DefaultInstaller()

// Deps configures optional runtime collaborators for the API mux.
type Deps struct {
	Registry *procreg.Registry
	Starter  gameruntime.Starter
	Match    bots.Starter
}

// NewMux returns the Studio V3 API HTTP handler with default deps.
func NewMux() http.Handler {
	return NewMuxWith(Deps{})
}

// NewMuxWith returns the Studio V3 API HTTP handler.
func NewMuxWith(deps Deps) http.Handler {
	if deps.Registry == nil {
		deps.Registry = procreg.New()
	}
	if deps.Starter == nil {
		deps.Starter = gameruntime.New(deps.Registry)
	}
	if deps.Match == nil {
		deps.Match = bots.New(deps.Registry)
	}
	api := &api{
		starter:  deps.Starter,
		match:    deps.Match,
		registry: deps.Registry,
		status:   newStatusHub(),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", handleHealth)
	mux.HandleFunc("GET /api/studio/status", handleStudioStatus)
	mux.HandleFunc("POST /api/init/setup-new-bot", handleSetupNewBot)
	mux.HandleFunc("POST /api/bot/publish", handlePublish)
	mux.HandleFunc("POST /api/server/start", api.handleServerStart)
	mux.HandleFunc("GET /api/server/status", api.handleServerStatus)
	mux.HandleFunc("GET /api/server/status/ws", api.handleServerStatusWS)
	mux.HandleFunc("POST /api/server/stop", api.handleServerStop)
	mux.HandleFunc("POST /api/game/start", api.handleGameStart)
	return mux
}

type api struct {
	starter  gameruntime.Starter
	match    bots.Starter
	registry *procreg.Registry
	status   *statusHub
	startMu  sync.Mutex
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

func handlePublish(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"implemented": false})
}

func (a *api) handleServerStart(w http.ResponseWriter, r *http.Request) {
	a.startMu.Lock()
	defer a.startMu.Unlock()

	ports := gameruntime.PortsFromEnv()
	if err := a.starter.Start(ports, gameruntime.MatchSettings{}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	a.publishStatus()
	writeJSON(w, http.StatusOK, map[string]string{"status": "OK"})
}

func (a *api) handleServerStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"running": a.starter.Running()})
}

func (a *api) handleServerStop(w http.ResponseWriter, r *http.Request) {
	a.startMu.Lock()
	defer a.startMu.Unlock()

	if err := a.starter.Stop(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	a.publishStatus()
	writeJSON(w, http.StatusOK, map[string]string{"status": "OK"})
}

func (a *api) handleGameStart(w http.ResponseWriter, r *http.Request) {
	a.startMu.Lock()
	defer a.startMu.Unlock()

	ports := gameruntime.PortsFromEnv()
	if err := a.starter.Start(ports, gameruntime.MatchSettings{}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	a.publishStatus()

	cfg := bots.Config{
		ProjectRoot:    projectRoot(),
		GRPCURL:        fmt.Sprintf("localhost:%d", ports.GameServer),
		OpponentBinary: bots.OpponentBinaryFromEnv(),
	}
	if err := a.match.Start(cfg); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
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
