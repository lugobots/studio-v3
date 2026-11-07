package server

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
)

const defaultProcessLogMaxLines = 2000

// processLogLine is one retained / streamed process log entry.
type processLogLine struct {
	Source string `json:"source"`
	Text   string `json:"text"`
	TS     int64  `json:"ts"` // unix milliseconds
}

type processLogClient struct {
	send chan []byte
}

// processLogHub retains armed-source lines in a bounded ring and fans out
// to WebSocket subscribers with drop-on-full backpressure.
type processLogHub struct {
	mu       sync.Mutex
	maxLines int
	buf      []processLogLine
	armed    map[string]bool
	clients  map[*processLogClient]struct{}
}

func newProcessLogHub() *processLogHub {
	return newProcessLogHubWithCap(defaultProcessLogMaxLines)
}

func newProcessLogHubWithCap(maxLines int) *processLogHub {
	if maxLines < 1 {
		maxLines = defaultProcessLogMaxLines
	}
	return &processLogHub{
		maxLines: maxLines,
		armed:    make(map[string]bool),
		clients:  make(map[*processLogClient]struct{}),
	}
}

func (h *processLogHub) Arm(source string) error {
	if err := validateProcessLogSource(source); err != nil {
		return err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.armed[source] = true
	return nil
}

func (h *processLogHub) Disarm(source string) error {
	if err := validateProcessLogSource(source); err != nil {
		return err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.armed, source)
	return nil
}

func (h *processLogHub) Armed(source string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.armed[source]
}

// Append retains a line when its source is armed. Unarmed sources are ignored.
// With subscribers, the line is pushed non-blocking (slow clients drop).
func (h *processLogHub) Append(source, text string) {
	if err := validateProcessLogSource(source); err != nil {
		return
	}
	line := processLogLine{
		Source: source,
		Text:   text,
		TS:     time.Now().UnixMilli(),
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.armed[source] {
		return
	}
	h.buf = append(h.buf, line)
	if len(h.buf) > h.maxLines {
		drop := len(h.buf) - h.maxLines
		copy(h.buf, h.buf[drop:])
		h.buf = h.buf[:h.maxLines]
	}
	if len(h.clients) == 0 {
		return
	}
	payload, err := marshalProcessLogPush([]processLogLine{line})
	if err != nil {
		return
	}
	for c := range h.clients {
		select {
		case c.send <- payload:
		default:
			// Slow client: drop this update; reconnect snapshot recovers history.
		}
	}
}

// Snapshot returns a copy of the current ring buffer (oldest first).
func (h *processLogHub) Snapshot() []processLogLine {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]processLogLine, len(h.buf))
	copy(out, h.buf)
	return out
}

func (h *processLogHub) Len() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.buf)
}

func (h *processLogHub) SubscriberCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}

func (h *processLogHub) add(c *processLogClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c] = struct{}{}
}

func (h *processLogHub) remove(c *processLogClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[c]; !ok {
		return
	}
	delete(h.clients, c)
	close(c.send)
}

func validateProcessLogSource(source string) error {
	switch source {
	case "api", "server":
		return nil
	}
	side, num, ok := strings.Cut(source, "/")
	if !ok || (side != "home" && side != "away") {
		return fmt.Errorf("invalid log source %q", source)
	}
	n, err := strconv.Atoi(num)
	if err != nil || n < 1 || n > 11 {
		return fmt.Errorf("invalid log source %q", source)
	}
	return nil
}
