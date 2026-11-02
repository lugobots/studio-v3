package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"studio-v3/api/internal/gameruntime"
	"studio-v3/api/internal/procreg"
)

type fakeStarter struct {
	mu        sync.Mutex
	calls     int
	lastPorts gameruntime.Ports
	err       error
	onStart   func(gameruntime.Ports) error
}

func (f *fakeStarter) Start(ports gameruntime.Ports) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	f.lastPorts = ports
	if f.onStart != nil {
		if err := f.onStart(ports); err != nil {
			return err
		}
	}
	return f.err
}

func TestServerStartSuccess(t *testing.T) {
	starter := &fakeStarter{}
	reg := procreg.New()
	mux := NewMuxWith(Deps{Registry: reg, Starter: starter})

	t.Setenv("LUGO_STUDIO_GAME_SERVER_PORT", "5500")
	t.Setenv("LUGO_STUDIO_GAME_FRONTEND_PORT", "8800")

	req := httptest.NewRequest(http.MethodPost, "/api/server/start", nil)
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
		t.Fatalf("calls = %d", starter.calls)
	}
	if starter.lastPorts.GameServer != 5500 || starter.lastPorts.GameFrontend != 8800 {
		t.Fatalf("ports = %#v", starter.lastPorts)
	}
}

func TestServerStartUsesDefaultPorts(t *testing.T) {
	starter := &fakeStarter{}
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: starter})
	t.Setenv("LUGO_STUDIO_GAME_SERVER_PORT", "")
	t.Setenv("LUGO_STUDIO_GAME_FRONTEND_PORT", "")

	req := httptest.NewRequest(http.MethodPost, "/api/server/start", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if starter.lastPorts.GameServer != 5000 || starter.lastPorts.GameFrontend != 8080 {
		t.Fatalf("ports = %#v", starter.lastPorts)
	}
}

func TestServerStartFailure(t *testing.T) {
	starter := &fakeStarter{err: errors.New("bind failed")}
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: starter})

	req := httptest.NewRequest(http.MethodPost, "/api/server/start", nil)
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
		t.Fatalf("failure claimed OK: %#v", body)
	}
	if body["message"] == nil || body["message"] == "" {
		t.Fatalf("missing message: %#v", body)
	}
}

func TestServerStartRegistersCleanupAndServesFrontend(t *testing.T) {
	reg := procreg.New()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	frontPort := ln.Addr().(*net.TCPAddr).Port

	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("game-frontend"))
	})}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() {
		_ = srv.Close()
	})

	starter := &fakeStarter{
		onStart: func(ports gameruntime.Ports) error {
			if ports.GameFrontend != frontPort {
				return fmt.Errorf("unexpected frontend port %d", ports.GameFrontend)
			}
			reg.Register(procreg.Hook(func() error {
				return srv.Close()
			}))
			return nil
		},
	}
	mux := NewMuxWith(Deps{Registry: reg, Starter: starter})
	t.Setenv("LUGO_STUDIO_GAME_SERVER_PORT", "5100")
	t.Setenv("LUGO_STUDIO_GAME_FRONTEND_PORT", fmt.Sprintf("%d", frontPort))

	req := httptest.NewRequest(http.MethodPost, "/api/server/start", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if reg.Len() != 1 {
		t.Fatalf("registry len = %d, want cleanup registered", reg.Len())
	}

	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/", frontPort))
	if err != nil {
		t.Fatalf("frontend not reachable: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("frontend status %d", resp.StatusCode)
	}

	if err := reg.ShutdownAll(); err != nil {
		t.Fatalf("ShutdownAll: %v", err)
	}
	if reg.Len() != 0 {
		t.Fatalf("registry not cleared: %d", reg.Len())
	}
}
