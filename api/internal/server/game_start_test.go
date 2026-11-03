package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"studio-v3/api/internal/bots"
	"studio-v3/api/internal/gameruntime"
	"studio-v3/api/internal/procreg"
)

type fakeMatch struct {
	mu    sync.Mutex
	calls int
	cfg   bots.Config
	err   error
}

func (f *fakeMatch) Start(cfg bots.Config) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	f.cfg = cfg
	return f.err
}

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
	match := &recordingMatch{onStart: func(cfg bots.Config) error {
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

	req := httptest.NewRequest(http.MethodPost, "/api/game/start", nil)
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

type recordingMatch struct {
	onStart func(bots.Config) error
	calls   int
}

func (r *recordingMatch) Start(cfg bots.Config) error {
	r.calls++
	if r.onStart != nil {
		return r.onStart(cfg)
	}
	return nil
}
