package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
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
	mux.HandleFunc("POST /api/team/{side}/bots/{number}", api.handleBotStart)
	mux.HandleFunc("DELETE /api/team/{side}/bots/{number}", api.handleBotStop)
	mux.HandleFunc("GET /api/team/{side}/bots/{number}", api.handleBotStatus)
	return mux
}

type api struct {
	starter      gameruntime.Starter
	match        bots.Starter
	registry     *procreg.Registry
	status       *statusHub
	startMu      sync.Mutex
	lastSettings gameruntime.MatchSettings // last applied while server was down / on start
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

	settings, _, err := decodeMatchSettings(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}

	ports := gameruntime.PortsFromEnv()
	// Settings are locked while the server is running: ignore body changes and
	// re-use the last applied session copy (Start itself is idempotent).
	if a.starter.Running() {
		if err := a.starter.Start(ports, a.lastSettings); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
			return
		}
		a.publishStatus()
		writeJSON(w, http.StatusOK, map[string]string{"status": "OK"})
		return
	}

	a.lastSettings = settings
	if err := a.starter.Start(ports, settings); err != nil {
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

	settings, settingsPresent, active, err := decodeGameStartRequest(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}

	ports := gameruntime.PortsFromEnv()
	// Auto-start reuses last-applied settings when the body omits them.
	// Settings are locked while the server is already running.
	if !a.starter.Running() && settingsPresent {
		a.lastSettings = settings
	}
	if err := a.starter.Start(ports, a.lastSettings); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	a.publishStatus()

	cfg := bots.Config{
		ProjectRoot:    projectRoot(),
		GRPCURL:        fmt.Sprintf("localhost:%d", ports.GameServer),
		PlayerSide:     playerSideForBots(a.lastSettings.TeamSide),
		OpponentMode:   string(a.lastSettings.OpponentMode),
		OpponentBinary: bots.OpponentBinaryFromEnv(),
	}
	// Start only the requested active set; empty means server-only (no bots).
	if err := a.match.StartMatch(cfg, active); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "OK"})
}

func (a *api) handleBotStart(w http.ResponseWriter, r *http.Request) {
	a.startMu.Lock()
	defer a.startMu.Unlock()

	slot, err := parseBotSlot(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	if err := a.match.StartBot(a.botConfig(), slot); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, botStatusBody(slot, a.match.BotRunning(slot)))
}

func (a *api) handleBotStop(w http.ResponseWriter, r *http.Request) {
	a.startMu.Lock()
	defer a.startMu.Unlock()

	slot, err := parseBotSlot(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	if err := a.match.StopBot(slot); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, botStatusBody(slot, a.match.BotRunning(slot)))
}

func (a *api) handleBotStatus(w http.ResponseWriter, r *http.Request) {
	slot, err := parseBotSlot(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, botStatusBody(slot, a.match.BotRunning(slot)))
}

func (a *api) botConfig() bots.Config {
	ports := gameruntime.PortsFromEnv()
	return bots.Config{
		ProjectRoot:    projectRoot(),
		GRPCURL:        fmt.Sprintf("localhost:%d", ports.GameServer),
		PlayerSide:     playerSideForBots(a.lastSettings.TeamSide),
		OpponentMode:   string(a.lastSettings.OpponentMode),
		OpponentBinary: bots.OpponentBinaryFromEnv(),
	}
}

func parseBotSlot(r *http.Request) (bots.Slot, error) {
	side := strings.ToUpper(r.PathValue("side"))
	if side != bots.SideHome && side != bots.SideAway {
		return bots.Slot{}, fmt.Errorf("invalid side %q", r.PathValue("side"))
	}
	number, err := strconv.Atoi(r.PathValue("number"))
	if err != nil {
		return bots.Slot{}, fmt.Errorf("invalid bot number %q", r.PathValue("number"))
	}
	if number < 1 || number > 11 {
		return bots.Slot{}, fmt.Errorf("invalid bot number %d", number)
	}
	return bots.Slot{Side: side, Number: number}, nil
}

func botStatusBody(slot bots.Slot, running bool) map[string]any {
	return map[string]any{
		"status":  "OK",
		"side":    slot.Side,
		"number":  slot.Number,
		"running": running,
	}
}

// playerSideForBots maps match-settings team_side to the BOT_TEAM value used by
// the bot manager (HOME/AWAY). Empty defaults to HOME.
func playerSideForBots(side gameruntime.TeamSide) string {
	if side == gameruntime.TeamSideAway {
		return bots.SideAway
	}
	return bots.SideHome
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

// decodeMatchSettings reads optional match-settings JSON from the request body.
// An empty body yields zero-value defaults and present=false. Invalid JSON or
// enum values return an error suitable for HTTP 400.
func decodeMatchSettings(r *http.Request) (gameruntime.MatchSettings, bool, error) {
	raw, err := readRequestBody(r)
	if err != nil {
		return gameruntime.MatchSettings{}, false, err
	}
	if len(raw) == 0 {
		return gameruntime.MatchSettings{}, false, nil
	}
	return parseMatchSettingsJSON(raw)
}

// decodeGameStartRequest reads optional match settings plus an active-bot set
// from POST /api/game/start. An empty body yields no settings update and an
// empty active set (server-only start). Settings keys alone update session
// settings; an active-only body leaves last-applied settings unchanged.
func decodeGameStartRequest(r *http.Request) (gameruntime.MatchSettings, bool, []bots.Slot, error) {
	raw, err := readRequestBody(r)
	if err != nil {
		return gameruntime.MatchSettings{}, false, nil, err
	}
	if len(raw) == 0 {
		return gameruntime.MatchSettings{}, false, nil, nil
	}

	var keys map[string]json.RawMessage
	if err := json.Unmarshal(raw, &keys); err != nil {
		return gameruntime.MatchSettings{}, false, nil, fmt.Errorf("invalid game start JSON: %w", err)
	}

	settingsPresent := hasMatchSettingsKeys(keys)
	var settings gameruntime.MatchSettings
	if settingsPresent {
		parsed, _, err := parseMatchSettingsJSON(raw)
		if err != nil {
			return gameruntime.MatchSettings{}, false, nil, err
		}
		settings = parsed
	}

	active, err := parseActiveSlots(keys["active"])
	if err != nil {
		return gameruntime.MatchSettings{}, false, nil, err
	}
	return settings, settingsPresent, active, nil
}

func readRequestBody(r *http.Request) ([]byte, error) {
	if r.Body == nil {
		return nil, nil
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	return bytes.TrimSpace(raw), nil
}

func parseMatchSettingsJSON(raw []byte) (gameruntime.MatchSettings, bool, error) {
	var settings gameruntime.MatchSettings
	if err := json.Unmarshal(raw, &settings); err != nil {
		return gameruntime.MatchSettings{}, false, fmt.Errorf("invalid match settings JSON: %w", err)
	}
	if err := validateMatchSettings(settings); err != nil {
		return gameruntime.MatchSettings{}, false, err
	}
	return settings, true, nil
}

func hasMatchSettingsKeys(keys map[string]json.RawMessage) bool {
	for _, k := range []string{"team_side", "skip_to_golden_goal", "game_speed", "opponent_mode"} {
		if _, ok := keys[k]; ok {
			return true
		}
	}
	return false
}

type activeSlotDTO struct {
	Side   string `json:"side"`
	Number int    `json:"number"`
}

func parseActiveSlots(raw json.RawMessage) ([]bots.Slot, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var dtos []activeSlotDTO
	if err := json.Unmarshal(raw, &dtos); err != nil {
		return nil, fmt.Errorf("invalid active set JSON: %w", err)
	}
	out := make([]bots.Slot, 0, len(dtos))
	for _, dto := range dtos {
		side := strings.ToUpper(dto.Side)
		slot := bots.Slot{Side: side, Number: dto.Number}
		if side != bots.SideHome && side != bots.SideAway {
			return nil, fmt.Errorf("invalid bot side %q", dto.Side)
		}
		if dto.Number < 1 || dto.Number > 11 {
			return nil, fmt.Errorf("invalid bot number %d", dto.Number)
		}
		out = append(out, slot)
	}
	return out, nil
}

func validateMatchSettings(settings gameruntime.MatchSettings) error {
	switch settings.TeamSide {
	case "", gameruntime.TeamSideHome, gameruntime.TeamSideAway:
	default:
		return fmt.Errorf("invalid team_side %q", settings.TeamSide)
	}
	switch settings.GameSpeed {
	case "", gameruntime.GameSpeedSlow, gameruntime.GameSpeedNormal, gameruntime.GameSpeedFast:
	default:
		return fmt.Errorf("invalid game_speed %q", settings.GameSpeed)
	}
	switch settings.OpponentMode {
	case "",
		gameruntime.OpponentModeDefault,
		gameruntime.OpponentModeZombies,
		gameruntime.OpponentModeStatues,
		gameruntime.OpponentModeKids,
		gameruntime.OpponentModeDefenses:
	default:
		return fmt.Errorf("invalid opponent_mode %q", settings.OpponentMode)
	}
	return nil
}
