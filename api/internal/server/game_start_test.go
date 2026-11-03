package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"studio-v3/api/internal/bots"
	"studio-v3/api/internal/gameruntime"
	"studio-v3/api/internal/procreg"
)

type fakeMatch struct {
	mu     sync.Mutex
	calls  int
	cfg    bots.Config
	active []bots.Slot
	err    error
}

func (f *fakeMatch) StartMatch(cfg bots.Config, active []bots.Slot) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	f.cfg = cfg
	f.active = append([]bots.Slot(nil), active...)
	return f.err
}

func (f *fakeMatch) StartBot(cfg bots.Config, slot bots.Slot) error { return nil }
func (f *fakeMatch) StopBot(slot bots.Slot) error                   { return nil }
func (f *fakeMatch) BotRunning(slot bots.Slot) bool                 { return false }

func TestGameStartSuccess(t *testing.T) {
	starter := &fakeStarter{}
	match := &fakeMatch{}
	reg := procreg.New()
	mux := NewMuxWith(Deps{Registry: reg, Starter: starter, Match: match})

	project := t.TempDir()
	t.Setenv("BOT_SOURCE_PATH", project)
	t.Setenv("LUGO_STUDIO_GAME_SERVER_PORT", "5501")
	t.Setenv("LUGO_STUDIO_GAME_FRONTEND_PORT", "8801")
	t.Setenv("LUGO_STUDIO_OPPONENT_BOT", "/tmp/opp-bot")

	req := httptest.NewRequest(http.MethodPost, "/api/game/start", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["status"] != "OK" {
		t.Fatalf("body = %#v", body)
	}
	if _, ok := body["implemented"]; ok {
		t.Fatalf("must not include implemented: %#v", body)
	}
	if starter.calls != 1 {
		t.Fatalf("server start calls = %d", starter.calls)
	}
	if match.calls != 1 {
		t.Fatalf("match start calls = %d", match.calls)
	}
	if match.cfg.ProjectRoot != project {
		t.Fatalf("project = %q", match.cfg.ProjectRoot)
	}
	if match.cfg.GRPCURL != "localhost:5501" {
		t.Fatalf("grpc = %q", match.cfg.GRPCURL)
	}
	if match.cfg.OpponentBinary != "/tmp/opp-bot" {
		t.Fatalf("opponent = %q", match.cfg.OpponentBinary)
	}
	if match.cfg.PlayerSide != bots.SideHome {
		t.Fatalf("default player side = %q", match.cfg.PlayerSide)
	}
	if match.cfg.OpponentMode != "" {
		t.Fatalf("default opponent mode = %q, want empty (manager default)", match.cfg.OpponentMode)
	}
	if len(match.active) != 0 {
		t.Fatalf("empty body active set = %#v, want empty (server only)", match.active)
	}
}

func TestGameStartAutoStartsServerWithMatchSettings(t *testing.T) {
	starter := &fakeStarter{}
	match := &fakeMatch{}
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: starter, Match: match})

	project := t.TempDir()
	t.Setenv("BOT_SOURCE_PATH", project)
	t.Setenv("LUGO_STUDIO_GAME_SERVER_PORT", "5502")
	t.Setenv("LUGO_STUDIO_GAME_FRONTEND_PORT", "8802")

	body := `{"team_side":"away","skip_to_golden_goal":true,"game_speed":"fast","opponent_mode":"zombies"}`
	req := httptest.NewRequest(http.MethodPost, "/api/game/start", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if starter.calls != 1 {
		t.Fatalf("server start calls = %d", starter.calls)
	}
	got := starter.lastSettings
	if got.TeamSide != gameruntime.TeamSideAway || !got.SkipToGoldenGoal || got.GameSpeed != gameruntime.GameSpeedFast || got.OpponentMode != gameruntime.OpponentModeZombies {
		t.Fatalf("settings = %#v", got)
	}
	if match.calls != 1 {
		t.Fatalf("match start calls = %d", match.calls)
	}
	if match.cfg.PlayerSide != bots.SideAway {
		t.Fatalf("player side = %q, want %q", match.cfg.PlayerSide, bots.SideAway)
	}
	if match.cfg.OpponentMode != string(gameruntime.OpponentModeZombies) {
		t.Fatalf("opponent mode = %q", match.cfg.OpponentMode)
	}
}

func TestGameStartReusesLastAppliedSettings(t *testing.T) {
	starter := &fakeStarter{}
	match := &fakeMatch{}
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: starter, Match: match})

	t.Setenv("BOT_SOURCE_PATH", t.TempDir())
	t.Setenv("LUGO_STUDIO_GAME_SERVER_PORT", "5503")
	t.Setenv("LUGO_STUDIO_GAME_FRONTEND_PORT", "8803")

	startBody := `{"team_side":"away","skip_to_golden_goal":true,"game_speed":"slow","opponent_mode":"kids"}`
	req := httptest.NewRequest(http.MethodPost, "/api/server/start", strings.NewReader(startBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("server start status %d", rec.Code)
	}
	want := starter.lastSettings

	// Stop so game/start must auto-start again; empty body should reuse last settings.
	stopReq := httptest.NewRequest(http.MethodPost, "/api/server/stop", nil)
	stopRec := httptest.NewRecorder()
	mux.ServeHTTP(stopRec, stopReq)
	if stopRec.Code != http.StatusOK {
		t.Fatalf("server stop status %d", stopRec.Code)
	}
	if starter.Running() {
		t.Fatal("expected stopped")
	}

	req = httptest.NewRequest(http.MethodPost, "/api/game/start", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("game start status %d body %s", rec.Code, rec.Body.String())
	}
	if starter.calls != 2 {
		t.Fatalf("server start calls = %d", starter.calls)
	}
	if starter.lastSettings != want {
		t.Fatalf("reused settings = %#v want %#v", starter.lastSettings, want)
	}
	if match.cfg.PlayerSide != bots.SideAway {
		t.Fatalf("player side from session = %q", match.cfg.PlayerSide)
	}
	if match.cfg.OpponentMode != string(gameruntime.OpponentModeKids) {
		t.Fatalf("opponent mode from session = %q", match.cfg.OpponentMode)
	}
}

func TestGameStartIgnoresSettingsWhileServerRunning(t *testing.T) {
	starter := &fakeStarter{}
	match := &fakeMatch{}
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: starter, Match: match})

	t.Setenv("BOT_SOURCE_PATH", t.TempDir())
	t.Setenv("LUGO_STUDIO_GAME_SERVER_PORT", "5504")
	t.Setenv("LUGO_STUDIO_GAME_FRONTEND_PORT", "8804")

	startBody := `{"team_side":"home","skip_to_golden_goal":false,"game_speed":"normal"}`
	req := httptest.NewRequest(http.MethodPost, "/api/server/start", strings.NewReader(startBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("server start status %d", rec.Code)
	}
	want := starter.lastSettings

	changed := `{"team_side":"away","skip_to_golden_goal":true,"game_speed":"slow"}`
	req = httptest.NewRequest(http.MethodPost, "/api/game/start", strings.NewReader(changed))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("game start status %d body %s", rec.Code, rec.Body.String())
	}
	if starter.lastSettings != want {
		t.Fatalf("settings changed while running: got %#v want %#v", starter.lastSettings, want)
	}
}

func TestGameStartPartialActiveSet(t *testing.T) {
	starter := &fakeStarter{}
	match := &fakeMatch{}
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: starter, Match: match})

	project := t.TempDir()
	t.Setenv("BOT_SOURCE_PATH", project)
	t.Setenv("LUGO_STUDIO_GAME_SERVER_PORT", "5505")
	t.Setenv("LUGO_STUDIO_GAME_FRONTEND_PORT", "8805")

	body := `{"team_side":"home","opponent_mode":"zombies","active":[{"side":"HOME","number":1},{"side":"away","number":11},{"side":"HOME","number":5}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/game/start", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if starter.calls != 1 {
		t.Fatalf("server start calls = %d", starter.calls)
	}
	if match.calls != 1 {
		t.Fatalf("match start calls = %d", match.calls)
	}
	want := []bots.Slot{
		{Side: bots.SideHome, Number: 1},
		{Side: bots.SideAway, Number: 11},
		{Side: bots.SideHome, Number: 5},
	}
	if len(match.active) != len(want) {
		t.Fatalf("active len = %d, want %d (%#v)", len(match.active), len(want), match.active)
	}
	for i := range want {
		if match.active[i] != want[i] {
			t.Fatalf("active[%d] = %#v, want %#v", i, match.active[i], want[i])
		}
	}
	// Inactive roster slots must not be included.
	for _, slot := range match.active {
		if slot.Number == 2 || slot.Number == 3 {
			t.Fatalf("unexpected inactive slot started: %#v", slot)
		}
	}
}

func TestGameStartEmptyActiveSetServerOnly(t *testing.T) {
	starter := &fakeStarter{}
	match := &fakeMatch{}
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: starter, Match: match})

	t.Setenv("BOT_SOURCE_PATH", t.TempDir())
	t.Setenv("LUGO_STUDIO_GAME_SERVER_PORT", "5506")
	t.Setenv("LUGO_STUDIO_GAME_FRONTEND_PORT", "8806")

	body := `{"team_side":"away","skip_to_golden_goal":true,"game_speed":"slow","opponent_mode":"kids","active":[]}`
	req := httptest.NewRequest(http.MethodPost, "/api/game/start", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if starter.calls != 1 {
		t.Fatalf("server start calls = %d", starter.calls)
	}
	got := starter.lastSettings
	if got.TeamSide != gameruntime.TeamSideAway || !got.SkipToGoldenGoal || got.GameSpeed != gameruntime.GameSpeedSlow || got.OpponentMode != gameruntime.OpponentModeKids {
		t.Fatalf("settings = %#v", got)
	}
	if match.calls != 1 {
		t.Fatalf("match start calls = %d", match.calls)
	}
	if len(match.active) != 0 {
		t.Fatalf("active = %#v, want empty (server only)", match.active)
	}
}

func TestGameStartActiveOnlyDoesNotClearSettings(t *testing.T) {
	starter := &fakeStarter{}
	match := &fakeMatch{}
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: starter, Match: match})

	t.Setenv("BOT_SOURCE_PATH", t.TempDir())
	t.Setenv("LUGO_STUDIO_GAME_SERVER_PORT", "5507")
	t.Setenv("LUGO_STUDIO_GAME_FRONTEND_PORT", "8807")

	startBody := `{"team_side":"away","opponent_mode":"statues","game_speed":"fast"}`
	req := httptest.NewRequest(http.MethodPost, "/api/server/start", strings.NewReader(startBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("server start status %d", rec.Code)
	}
	want := starter.lastSettings

	stopReq := httptest.NewRequest(http.MethodPost, "/api/server/stop", nil)
	stopRec := httptest.NewRecorder()
	mux.ServeHTTP(stopRec, stopReq)
	if stopRec.Code != http.StatusOK {
		t.Fatalf("server stop status %d", stopRec.Code)
	}

	body := `{"active":[{"side":"HOME","number":3}]}`
	req = httptest.NewRequest(http.MethodPost, "/api/game/start", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("game start status %d body %s", rec.Code, rec.Body.String())
	}
	if starter.lastSettings != want {
		t.Fatalf("settings cleared by active-only body: got %#v want %#v", starter.lastSettings, want)
	}
	if match.cfg.PlayerSide != bots.SideAway {
		t.Fatalf("player side = %q", match.cfg.PlayerSide)
	}
	if match.cfg.OpponentMode != string(gameruntime.OpponentModeStatues) {
		t.Fatalf("opponent mode = %q", match.cfg.OpponentMode)
	}
	if len(match.active) != 1 || match.active[0] != (bots.Slot{Side: bots.SideHome, Number: 3}) {
		t.Fatalf("active = %#v", match.active)
	}
}

func TestGameStartRejectsInvalidActiveSlot(t *testing.T) {
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: &fakeStarter{}, Match: &fakeMatch{}})
	req := httptest.NewRequest(http.MethodPost, "/api/game/start",
		strings.NewReader(`{"active":[{"side":"left","number":1}]}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestGameStartEnsuresServerBeforeBots(t *testing.T) {
	var order []string
	var mu sync.Mutex
	starter := &fakeStarter{
		onStart: func(ports gameruntime.Ports, _ gameruntime.MatchSettings) error {
			mu.Lock()
			order = append(order, "server")
			mu.Unlock()
			return nil
		},
	}
	match := &recordingMatch{onStart: func(cfg bots.Config, active []bots.Slot) error {
		mu.Lock()
		order = append(order, "bots")
		mu.Unlock()
		return nil
	}}
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: starter, Match: match})
	t.Setenv("BOT_SOURCE_PATH", t.TempDir())

	req := httptest.NewRequest(http.MethodPost, "/api/game/start", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(order) != 2 || order[0] != "server" || order[1] != "bots" {
		t.Fatalf("order = %#v", order)
	}
}

func TestGameStartServerFailure(t *testing.T) {
	starter := &fakeStarter{err: errors.New("bind failed")}
	match := &fakeMatch{}
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: starter, Match: match})

	req := httptest.NewRequest(http.MethodPost, "/api/game/start", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status %d", rec.Code)
	}
	if match.calls != 0 {
		t.Fatalf("match should not run after server failure")
	}
}

func TestGameStartMatchFailure(t *testing.T) {
	starter := &fakeStarter{}
	match := &fakeMatch{err: errors.New("bot boom")}
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: starter, Match: match})
	t.Setenv("BOT_SOURCE_PATH", t.TempDir())

	req := httptest.NewRequest(http.MethodPost, "/api/game/start", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["status"] == "OK" {
		t.Fatalf("claimed OK: %#v", body)
	}
	if body["message"] == nil || body["message"] == "" {
		t.Fatalf("missing message: %#v", body)
	}
}

func TestGameStartIntegrationRegistersBots(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "go.mod"), []byte("module demo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	opp := filepath.Join(t.TempDir(), "opp-bot")
	if err := os.WriteFile(opp, []byte("#!/bin/sh\nexec sleep 60\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	reg := procreg.New()
	match := bots.New(reg)
	match.RunSync = func(dir, command string, env map[string]string) error { return nil }
	match.StartProcess = func(dir, command string, env map[string]string) (*procreg.Child, error) {
		return procreg.StartChild("sleep", "60")
	}

	starter := &fakeStarter{}
	mux := NewMuxWith(Deps{Registry: reg, Starter: starter, Match: match})
	t.Setenv("BOT_SOURCE_PATH", project)
	t.Setenv("LUGO_STUDIO_OPPONENT_BOT", opp)
	t.Setenv("LUGO_STUDIO_GAME_SERVER_PORT", "5600")
	t.Setenv("LUGO_STUDIO_GAME_FRONTEND_PORT", "8600")

	slots := make([]map[string]any, 0, 22)
	for _, slot := range bots.AllSlots() {
		slots = append(slots, map[string]any{"side": slot.Side, "number": slot.Number})
	}
	activeJSON, err := json.Marshal(map[string]any{"active": slots})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/game/start", strings.NewReader(string(activeJSON)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	t.Cleanup(func() {
		if err := reg.ShutdownAll(); err != nil {
			t.Errorf("ShutdownAll: %v", err)
		}
	})

	if starter.calls != 1 {
		t.Fatalf("server starts = %d", starter.calls)
	}
	if reg.Len() != 22 {
		t.Fatalf("registry len = %d, want 22 bots registered", reg.Len())
	}
}

func TestGameStartIntegrationPartialAndEmptyActive(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "go.mod"), []byte("module demo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	opp := filepath.Join(t.TempDir(), "opp-bot")
	if err := os.WriteFile(opp, []byte("#!/bin/sh\nexec sleep 60\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	reg := procreg.New()
	match := bots.New(reg)
	match.RunSync = func(dir, command string, env map[string]string) error { return nil }
	match.StartProcess = func(dir, command string, env map[string]string) (*procreg.Child, error) {
		return procreg.StartChild("sleep", "60")
	}

	starter := &fakeStarter{}
	mux := NewMuxWith(Deps{Registry: reg, Starter: starter, Match: match})
	t.Setenv("BOT_SOURCE_PATH", project)
	t.Setenv("LUGO_STUDIO_OPPONENT_BOT", opp)
	t.Setenv("LUGO_STUDIO_GAME_SERVER_PORT", "5601")
	t.Setenv("LUGO_STUDIO_GAME_FRONTEND_PORT", "8601")
	t.Cleanup(func() { _ = reg.ShutdownAll() })

	partial := `{"active":[{"side":"HOME","number":1},{"side":"AWAY","number":2}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/game/start", strings.NewReader(partial))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("partial status %d body %s", rec.Code, rec.Body.String())
	}
	if starter.calls != 1 {
		t.Fatalf("server starts = %d", starter.calls)
	}
	if reg.Len() != 2 {
		t.Fatalf("partial registry len = %d, want 2", reg.Len())
	}

	empty := `{"active":[]}`
	req = httptest.NewRequest(http.MethodPost, "/api/game/start", strings.NewReader(empty))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("empty status %d body %s", rec.Code, rec.Body.String())
	}
	if !starter.Running() {
		t.Fatal("server should remain running for empty active set")
	}
	if reg.Len() != 0 {
		t.Fatalf("empty active registry len = %d, want 0 (server only)", reg.Len())
	}
}

type recordingMatch struct {
	onStart func(bots.Config, []bots.Slot) error
	calls   int
}

func (r *recordingMatch) StartMatch(cfg bots.Config, active []bots.Slot) error {
	r.calls++
	if r.onStart != nil {
		return r.onStart(cfg, active)
	}
	return nil
}

func (r *recordingMatch) StartBot(cfg bots.Config, slot bots.Slot) error { return nil }
func (r *recordingMatch) StopBot(slot bots.Slot) error                   { return nil }
func (r *recordingMatch) BotRunning(slot bots.Slot) bool                 { return false }
