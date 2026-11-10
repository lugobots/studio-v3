package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"studio-v3/api/internal/procreg"
)

func readStatusMessage(t *testing.T, conn *websocket.Conn) statusMessage {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read status message: %v", err)
	}
	var msg statusMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("decode status message %q: %v", raw, err)
	}
	return msg
}

func dialStatusWS(t *testing.T, serverURL string) *websocket.Conn {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(serverURL, "http") + "/api/server/status/ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial status ws: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func TestStatusWSConnectSnapshotMatchesRuntime(t *testing.T) {
	starter := &fakeStarter{running: true}
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: starter})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	conn := dialStatusWS(t, srv.URL)
	msg := readStatusMessage(t, conn)
	if !msg.Running {
		t.Fatalf("connect snapshot running = %v, want true", msg.Running)
	}
	if !starter.Running() {
		t.Fatal("runtime Running() = false, snapshot should match")
	}
}

func TestStatusWSConnectSnapshotWhenStopped(t *testing.T) {
	starter := &fakeStarter{}
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: starter})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	conn := dialStatusWS(t, srv.URL)
	msg := readStatusMessage(t, conn)
	if msg.Running {
		t.Fatalf("connect snapshot running = %v, want false", msg.Running)
	}
}

func TestStatusWSBroadcastsStartAndStopTransitions(t *testing.T) {
	starter := &fakeStarter{}
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: starter})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	conn := dialStatusWS(t, srv.URL)
	if msg := readStatusMessage(t, conn); msg.Running {
		t.Fatalf("initial snapshot running = %v, want false", msg.Running)
	}

	startReq, err := http.NewRequest(http.MethodPost, srv.URL+"/api/server/start", nil)
	if err != nil {
		t.Fatal(err)
	}
	startResp, err := http.DefaultClient.Do(startReq)
	if err != nil {
		t.Fatal(err)
	}
	_ = startResp.Body.Close()
	if startResp.StatusCode != http.StatusOK {
		t.Fatalf("start status %d", startResp.StatusCode)
	}
	if !starter.Running() {
		t.Fatal("runtime not running after start")
	}
	if msg := readStatusMessage(t, conn); !msg.Running {
		t.Fatalf("start transition running = %v, want true", msg.Running)
	}

	stopReq, err := http.NewRequest(http.MethodPost, srv.URL+"/api/server/stop", nil)
	if err != nil {
		t.Fatal(err)
	}
	stopResp, err := http.DefaultClient.Do(stopReq)
	if err != nil {
		t.Fatal(err)
	}
	_ = stopResp.Body.Close()
	if stopResp.StatusCode != http.StatusOK {
		t.Fatalf("stop status %d", stopResp.StatusCode)
	}
	if starter.Running() {
		t.Fatal("runtime still running after stop")
	}
	if msg := readStatusMessage(t, conn); msg.Running {
		t.Fatalf("stop transition running = %v, want false", msg.Running)
	}
}

func TestStatusWSBroadcastsRunningOnGameStart(t *testing.T) {
	starter := &fakeStarter{}
	match := &fakeMatch{}
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: starter, Match: match})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	t.Setenv("BOT_SOURCE_PATH", t.TempDir())
	t.Setenv("LUGO_STUDIO_GAME_SERVER_PORT", "5502")
	t.Setenv("LUGO_STUDIO_GAME_FRONTEND_PORT", "8802")

	conn := dialStatusWS(t, srv.URL)
	if msg := readStatusMessage(t, conn); msg.Running {
		t.Fatalf("initial snapshot running = %v, want false", msg.Running)
	}

	startReq, err := http.NewRequest(http.MethodPost, srv.URL+"/api/game/start", nil)
	if err != nil {
		t.Fatal(err)
	}
	startResp, err := http.DefaultClient.Do(startReq)
	if err != nil {
		t.Fatal(err)
	}
	_ = startResp.Body.Close()
	if startResp.StatusCode != http.StatusOK {
		t.Fatalf("game start status %d", startResp.StatusCode)
	}
	if starter.calls != 1 {
		t.Fatalf("server start calls = %d", starter.calls)
	}
	if match.calls != 1 {
		t.Fatalf("match start calls = %d", match.calls)
	}
	if !starter.Running() {
		t.Fatal("runtime not running after game start")
	}
	if msg := readStatusMessage(t, conn); !msg.Running {
		t.Fatalf("game start transition running = %v, want true", msg.Running)
	}
}
