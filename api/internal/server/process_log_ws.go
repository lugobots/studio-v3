package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/gorilla/websocket"
)

// processLogPush is the WebSocket payload for snapshot and live lines.
type processLogPush struct {
	Lines []processLogLine `json:"lines"`
}

type processLogArmBody struct {
	Source string `json:"source"`
}

func marshalProcessLogPush(lines []processLogLine) ([]byte, error) {
	if lines == nil {
		lines = []processLogLine{}
	}
	return json.Marshal(processLogPush{Lines: lines})
}

var processLogUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (a *api) handleProcessLogArm(w http.ResponseWriter, r *http.Request) {
	source, err := decodeProcessLogSource(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	if err := a.logs.Arm(source); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "OK", "source": source, "armed": true})
}

func (a *api) handleProcessLogDisarm(w http.ResponseWriter, r *http.Request) {
	source, err := decodeProcessLogSource(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	if err := a.logs.Disarm(source); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "OK", "source": source, "armed": false})
}

func (a *api) handleProcessLogWS(w http.ResponseWriter, r *http.Request) {
	conn, err := processLogUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	client := &processLogClient{send: make(chan []byte, 8)}
	a.logs.add(client)
	defer func() {
		a.logs.remove(client)
		_ = conn.Close()
	}()

	snapshot, err := marshalProcessLogPush(a.logs.Snapshot())
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

func decodeProcessLogSource(r *http.Request) (string, error) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return "", err
	}
	var body processLogArmBody
	if len(raw) == 0 {
		return "", errMissingLogSource
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return "", errInvalidLogArmJSON
	}
	if body.Source == "" {
		return "", errMissingLogSource
	}
	if err := validateProcessLogSource(body.Source); err != nil {
		return "", err
	}
	return body.Source, nil
}

var (
	errMissingLogSource  = errors.New("missing source")
	errInvalidLogArmJSON = errors.New("invalid log arm JSON")
)
