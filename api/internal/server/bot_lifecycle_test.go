package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"studio-v3/api/internal/bots"
	"studio-v3/api/internal/procreg"
)

func TestBotStartStopStatusHomeAndAway(t *testing.T) {
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

	mux := NewMuxWith(Deps{Registry: reg, Starter: &fakeStarter{}, Match: match})
	t.Setenv("BOT_SOURCE_PATH", project)
	t.Setenv("LUGO_STUDIO_OPPONENT_BOT", opp)
	t.Setenv("LUGO_STUDIO_GAME_SERVER_PORT", "5701")
	t.Setenv("LUGO_STUDIO_GAME_FRONTEND_PORT", "8701")

	// Seed session settings: player on HOME so AWAY is opponent.
	startReq := httptest.NewRequest(http.MethodPost, "/api/server/start",
		strings.NewReader(`{"team_side":"home","opponent_mode":"kids"}`))
	startReq.Header.Set("Content-Type", "application/json")
	startRec := httptest.NewRecorder()
	mux.ServeHTTP(startRec, startReq)
	if startRec.Code != http.StatusOK {
		t.Fatalf("server start status %d body %s", startRec.Code, startRec.Body.String())
	}

	t.Cleanup(func() { _ = reg.ShutdownAll() })

	for _, tc := range []struct {
		side   string
		number int
		path   string
	}{
		{side: bots.SideHome, number: 1, path: "/api/team/HOME/bots/1"},
		{side: bots.SideAway, number: 11, path: "/api/team/away/bots/11"},
	} {
		statusRec := httptest.NewRecorder()
		mux.ServeHTTP(statusRec, httptest.NewRequest(http.MethodGet, tc.path, nil))
		assertBotStatus(t, statusRec, tc.side, tc.number, false)

		startBotRec := httptest.NewRecorder()
		mux.ServeHTTP(startBotRec, httptest.NewRequest(http.MethodPost, tc.path, nil))
		assertBotStatus(t, startBotRec, tc.side, tc.number, true)

		statusRec = httptest.NewRecorder()
		mux.ServeHTTP(statusRec, httptest.NewRequest(http.MethodGet, tc.path, nil))
		assertBotStatus(t, statusRec, tc.side, tc.number, true)
	}

	if reg.Len() != 2 {
		t.Fatalf("registry len = %d, want 2", reg.Len())
	}

	for _, path := range []string{"/api/team/HOME/bots/1", "/api/team/away/bots/11"} {
		stopRec := httptest.NewRecorder()
		mux.ServeHTTP(stopRec, httptest.NewRequest(http.MethodDelete, path, nil))
		if stopRec.Code != http.StatusOK {
			t.Fatalf("stop %s status %d body %s", path, stopRec.Code, stopRec.Body.String())
		}
		var body map[string]any
		if err := json.Unmarshal(stopRec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body["running"] != false {
			t.Fatalf("stop %s body = %#v", path, body)
		}
	}

	if reg.Len() != 0 {
		t.Fatalf("registry len = %d after stop, want 0", reg.Len())
	}
	if match.BotRunning(bots.Slot{Side: bots.SideHome, Number: 1}) {
		t.Fatal("home still running")
	}
	if match.BotRunning(bots.Slot{Side: bots.SideAway, Number: 11}) {
		t.Fatal("away still running")
	}
}

func TestBotStartRejectsInvalidSlot(t *testing.T) {
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: &fakeStarter{}, Match: &fakeMatch{}})

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/team/left/bots/1", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/team/HOME/bots/99", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}

func assertBotStatus(t *testing.T, rec *httptest.ResponseRecorder, side string, number int, running bool) {
	t.Helper()
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
	if body["side"] != side {
		t.Fatalf("side = %#v, want %s", body["side"], side)
	}
	if int(body["number"].(float64)) != number {
		t.Fatalf("number = %#v, want %d", body["number"], number)
	}
	if body["running"] != running {
		t.Fatalf("running = %#v, want %v", body["running"], running)
	}
}
