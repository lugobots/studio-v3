package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"studio-v3/api/internal/procreg"
)

func TestServerStatusReportsStoppedWhenIdle(t *testing.T) {
	starter := &fakeStarter{}
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: starter})

	req := httptest.NewRequest(http.MethodGet, "/api/server/status", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["running"] != false {
		t.Fatalf("running = %#v, want false", body["running"])
	}
	if _, ok := body["implemented"]; ok {
		t.Fatalf("must not include implemented: %#v", body)
	}
}

func TestServerStatusReportsRunningAfterStart(t *testing.T) {
	starter := &fakeStarter{}
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: starter})

	startReq := httptest.NewRequest(http.MethodPost, "/api/server/start", nil)
	startRec := httptest.NewRecorder()
	mux.ServeHTTP(startRec, startReq)
	if startRec.Code != http.StatusOK {
		t.Fatalf("start status %d body %s", startRec.Code, startRec.Body.String())
	}

	req := httptest.NewRequest(http.MethodGet, "/api/server/status", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["running"] != true {
		t.Fatalf("running = %#v, want true", body["running"])
	}
}

func TestServerStopEndsRunningServer(t *testing.T) {
	starter := &fakeStarter{running: true}
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: starter})

	req := httptest.NewRequest(http.MethodPost, "/api/server/stop", nil)
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
	if starter.stopCalls != 1 {
		t.Fatalf("stopCalls = %d", starter.stopCalls)
	}
	if starter.Running() {
		t.Fatal("Running() = true after stop")
	}

	statusReq := httptest.NewRequest(http.MethodGet, "/api/server/status", nil)
	statusRec := httptest.NewRecorder()
	mux.ServeHTTP(statusRec, statusReq)
	var statusBody map[string]any
	if err := json.Unmarshal(statusRec.Body.Bytes(), &statusBody); err != nil {
		t.Fatal(err)
	}
	if statusBody["running"] != false {
		t.Fatalf("status after stop = %#v", statusBody)
	}
}

func TestServerStopWhileAlreadyStoppedIsSafe(t *testing.T) {
	starter := &fakeStarter{}
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: starter})

	req := httptest.NewRequest(http.MethodPost, "/api/server/stop", nil)
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
	if starter.stopCalls != 1 {
		t.Fatalf("stopCalls = %d", starter.stopCalls)
	}
	if starter.Running() {
		t.Fatal("Running() = true after stop-while-stopped")
	}

	statusReq := httptest.NewRequest(http.MethodGet, "/api/server/status", nil)
	statusRec := httptest.NewRecorder()
	mux.ServeHTTP(statusRec, statusReq)
	var statusBody map[string]any
	if err := json.Unmarshal(statusRec.Body.Bytes(), &statusBody); err != nil {
		t.Fatal(err)
	}
	if statusBody["running"] != false {
		t.Fatalf("status after stop-while-stopped = %#v", statusBody)
	}
}
