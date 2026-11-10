package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"studio-v3/api/internal/bots"
	"studio-v3/api/internal/gameruntime"
	"studio-v3/api/internal/procreg"
)

func newDebugMux(t *testing.T, hub *processLogHub) http.Handler {
	t.Helper()
	reg := procreg.New()
	return NewMuxWith(Deps{
		Registry: reg,
		Starter:  gameruntime.New(reg),
		Match:    bots.New(reg),
		Logs:     hub,
	})
}

func TestAPIDebugOffProducesNoHubLines(t *testing.T) {
	hub := newProcessLogHub()
	mux := newDebugMux(t, hub)

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("health status %d", rr.Code)
	}
	if hub.Len() != 0 {
		t.Fatalf("unarmed api debug retained %d lines", hub.Len())
	}
	if hub.Armed("api") || hub.Armed("server") || hub.Armed("home/1") {
		t.Fatal("debug-off request armed a log source")
	}
}

func TestAPIDebugOnTagsLinesAsAPI(t *testing.T) {
	hub := newProcessLogHub()
	mux := newDebugMux(t, hub)

	armBody, _ := json.Marshal(map[string]string{"source": "api"})
	armReq := httptest.NewRequest(http.MethodPost, "/api/logs/arm", bytes.NewReader(armBody))
	armRR := httptest.NewRecorder()
	mux.ServeHTTP(armRR, armReq)
	if armRR.Code != http.StatusOK {
		t.Fatalf("arm status %d body %s", armRR.Code, armRR.Body.String())
	}

	healthReq := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	healthRR := httptest.NewRecorder()
	mux.ServeHTTP(healthRR, healthReq)
	if healthRR.Code != http.StatusOK {
		t.Fatalf("health status %d", healthRR.Code)
	}

	lines := hub.Snapshot()
	if len(lines) < 1 {
		t.Fatal("armed api debug produced no lines")
	}
	for _, line := range lines {
		if line.Source != "api" {
			t.Fatalf("line source = %q, want api (text %q)", line.Source, line.Text)
		}
	}
	var sawHealth bool
	for _, line := range lines {
		if strings.Contains(line.Text, "GET /api/health") {
			sawHealth = true
		}
	}
	if !sawHealth {
		t.Fatalf("lines = %#v, want a GET /api/health debug line", lines)
	}
	if hub.Armed("server") || hub.Armed("home/1") || hub.Armed("away/2") {
		t.Fatal("arming api debug also armed bot or game-server capture")
	}

	disarmBody, _ := json.Marshal(map[string]string{"source": "api"})
	disarmReq := httptest.NewRequest(http.MethodPost, "/api/logs/disarm", bytes.NewReader(disarmBody))
	disarmRR := httptest.NewRecorder()
	mux.ServeHTTP(disarmRR, disarmReq)
	if disarmRR.Code != http.StatusOK {
		t.Fatalf("disarm status %d", disarmRR.Code)
	}
	before := hub.Len()
	again := httptest.NewRequest(http.MethodGet, "/api/studio/status", nil)
	againRR := httptest.NewRecorder()
	mux.ServeHTTP(againRR, again)
	if hub.Len() != before {
		t.Fatalf("after disarm hub len = %d, want %d", hub.Len(), before)
	}
}
