package server

import (
	"net/http"
	"sync"
)

const prepareLogCap = 400

// prepareHub retains stdout/stderr lines from the in-flight create-time prepare.
type prepareHub struct {
	mu      sync.Mutex
	running bool
	lines   []string
}

func newPrepareHub() *prepareHub {
	return &prepareHub{lines: make([]string, 0, 32)}
}

func (h *prepareHub) begin() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.running = true
	h.lines = h.lines[:0]
}

func (h *prepareHub) end() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.running = false
}

func (h *prepareHub) append(line string) {
	if line == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.lines = append(h.lines, line)
	if len(h.lines) > prepareLogCap {
		h.lines = append([]string(nil), h.lines[len(h.lines)-prepareLogCap:]...)
	}
}

func (h *prepareHub) snapshot() (running bool, lines []string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]string, len(h.lines))
	copy(out, h.lines)
	return h.running, out
}

func (a *api) handlePrepareDependencies(w http.ResponseWriter, r *http.Request) {
	if a.prepper == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "prepare is not available"})
		return
	}
	a.prepare.begin()
	defer a.prepare.end()
	root := projectRoot()
	err := a.prepper.PrepareProject(root, a.prepare.append)
	if err != nil {
		text := err.Error()
		if text == "" {
			text = "dependency prepare failed"
		}
		a.prepare.append("error: " + text)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": text})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "OK"})
}

func (a *api) handlePrepareLogs(w http.ResponseWriter, r *http.Request) {
	running, lines := a.prepare.snapshot()
	writeJSON(w, http.StatusOK, map[string]any{
		"running": running,
		"lines":   lines,
	})
}
