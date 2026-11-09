package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"studio-v3/api/internal/procreg"
)

func dialProcessLogWS(t *testing.T, serverURL string) *websocket.Conn {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(serverURL, "http") + "/api/logs/ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial process log ws: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func readProcessLogPush(t *testing.T, conn *websocket.Conn) processLogPush {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read process log message: %v", err)
	}
	var msg processLogPush
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("decode process log message %q: %v", raw, err)
	}
	return msg
}

func postLogArm(t *testing.T, baseURL, path, source string) *http.Response {
	t.Helper()
	body, err := json.Marshal(map[string]string{"source": source})
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, baseURL+path, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestProcessLogArmDisarmHTTP(t *testing.T) {
	hub := newProcessLogHub()
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: &fakeStarter{}, Logs: hub})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	armResp := postLogArm(t, srv.URL, "/api/logs/arm", "server")
	_ = armResp.Body.Close()
	if armResp.StatusCode != http.StatusOK {
		t.Fatalf("arm status %d", armResp.StatusCode)
	}
	if !hub.Armed("server") {
		t.Fatal("hub server not armed after POST /api/logs/arm")
	}

	disarmResp := postLogArm(t, srv.URL, "/api/logs/disarm", "server")
	_ = disarmResp.Body.Close()
	if disarmResp.StatusCode != http.StatusOK {
		t.Fatalf("disarm status %d", disarmResp.StatusCode)
	}
	if hub.Armed("server") {
		t.Fatal("hub server still armed after POST /api/logs/disarm")
	}
}

func TestProcessLogArmRejectsInvalidSource(t *testing.T) {
	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: &fakeStarter{}})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	resp := postLogArm(t, srv.URL, "/api/logs/arm", "home/99")
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", resp.StatusCode)
	}
}

func TestProcessLogWSSubscribeReceivesSnapshotAndLive(t *testing.T) {
	hub := newProcessLogHub()
	if err := hub.Arm("server"); err != nil {
		t.Fatal(err)
	}
	hub.Append("server", "buffered")

	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: &fakeStarter{}, Logs: hub})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	conn := dialProcessLogWS(t, srv.URL)
	snap := readProcessLogPush(t, conn)
	if len(snap.Lines) != 1 || snap.Lines[0].Text != "buffered" {
		t.Fatalf("snapshot = %+v", snap)
	}

	hub.Append("server", "live")
	live := readProcessLogPush(t, conn)
	if len(live.Lines) != 1 || live.Lines[0].Text != "live" {
		t.Fatalf("live = %+v", live)
	}
}

func TestProcessLogWSUnsubscribeStopsPush(t *testing.T) {
	hub := newProcessLogHub()
	if err := hub.Arm("api"); err != nil {
		t.Fatal(err)
	}

	mux := NewMuxWith(Deps{Registry: procreg.New(), Starter: &fakeStarter{}, Logs: hub})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	conn := dialProcessLogWS(t, srv.URL)
	_ = readProcessLogPush(t, conn) // empty snapshot
	if hub.SubscriberCount() != 1 {
		t.Fatalf("subscribers = %d, want 1", hub.SubscriberCount())
	}

	_ = conn.Close()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if hub.SubscriberCount() == 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if hub.SubscriberCount() != 0 {
		t.Fatalf("subscribers = %d after close, want 0", hub.SubscriberCount())
	}

	// Must not block or panic with zero subscribers.
	hub.Append("api", "after unsubscribe")
	if hub.Len() != 1 {
		t.Fatalf("retained %d, want 1 (buffer still fills when armed)", hub.Len())
	}
}

func TestProcessLogHubNoPushWithZeroSubscribers(t *testing.T) {
	hub := newProcessLogHubWithCap(4)
	if err := hub.Arm("server"); err != nil {
		t.Fatal(err)
	}
	if hub.SubscriberCount() != 0 {
		t.Fatal("expected zero subscribers")
	}
	hub.Append("server", "retained only")
	if hub.Len() != 1 {
		t.Fatalf("len = %d", hub.Len())
	}
}

func TestProcessLogHubSlowClientDrops(t *testing.T) {
	hub := newProcessLogHubWithCap(32)
	if err := hub.Arm("server"); err != nil {
		t.Fatal(err)
	}
	client := &processLogClient{send: make(chan []byte, 1)}
	hub.add(client)
	t.Cleanup(func() { hub.remove(client) })

	// Fill the single-slot buffer.
	hub.Append("server", "first")
	select {
	case <-client.send:
	case <-time.After(time.Second):
		t.Fatal("expected first push")
	}

	// Fill again so channel is full, then append more — must not block.
	hub.Append("server", "queued")
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 20; i++ {
			hub.Append("server", "overflow")
		}
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Append blocked on slow client")
	}

	// Channel still holds at most one pending payload.
	if got := len(client.send); got > 1 {
		t.Fatalf("pending sends = %d, want <= 1", got)
	}
}
