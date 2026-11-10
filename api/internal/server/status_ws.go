package server

import (
	"encoding/json"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

// statusMessage is the live game-server up/down payload pushed to clients.
type statusMessage struct {
	Running bool `json:"running"`
}

type statusClient struct {
	send chan []byte
}

type statusHub struct {
	mu      sync.Mutex
	clients map[*statusClient]struct{}
}

func newStatusHub() *statusHub {
	return &statusHub{clients: make(map[*statusClient]struct{})}
}

func (h *statusHub) add(c *statusClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c] = struct{}{}
}

func (h *statusHub) remove(c *statusClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[c]; !ok {
		return
	}
	delete(h.clients, c)
	close(c.send)
}

func (h *statusHub) broadcast(running bool) {
	payload, err := json.Marshal(statusMessage{Running: running})
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		select {
		case c.send <- payload:
		default:
			// Slow client: drop this update; connect snapshot + later
			// transitions still converge on reconnect / next event.
		}
	}
}

var statusUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (a *api) handleServerStatusWS(w http.ResponseWriter, r *http.Request) {
	conn, err := statusUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	client := &statusClient{send: make(chan []byte, 8)}
	a.status.add(client)
	defer func() {
		a.status.remove(client)
		_ = conn.Close()
	}()

	snapshot, err := json.Marshal(statusMessage{Running: a.starter.Running()})
	if err != nil {
		return
	}
	if err := conn.WriteMessage(websocket.TextMessage, snapshot); err != nil {
		return
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	for {
		select {
		case <-done:
			return
		case payload, ok := <-client.send:
			if !ok {
				return
			}
			if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
				return
			}
		}
	}
}

func (a *api) publishStatus() {
	a.status.broadcast(a.starter.Running())
}
