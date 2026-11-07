package gameruntime

import (
	"strings"
	"sync"
	"testing"
)

type memLogSink struct {
	mu    sync.Mutex
	armed map[string]bool
	lines []struct{ Source, Text string }
}

func (m *memLogSink) Armed(source string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.armed[source]
}

func (m *memLogSink) Append(source, text string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.armed[source] {
		return
	}
	m.lines = append(m.lines, struct{ Source, Text string }{source, text})
}

func (m *memLogSink) Arm(source string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.armed == nil {
		m.armed = make(map[string]bool)
	}
	m.armed[source] = true
}

func (m *memLogSink) Disarm(source string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.armed, source)
}

func (m *memLogSink) Texts() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, len(m.lines))
	for i, l := range m.lines {
		out[i] = l.Text
	}
	return out
}

func TestServerHubLoggerArmAdmitsAndDisarmStops(t *testing.T) {
	sink := &memLogSink{}
	logger := newServerHubLogger(sink)

	logger.Info("before-arm")
	if got := sink.Texts(); len(got) != 0 {
		t.Fatalf("unarmed lines = %v, want none", got)
	}

	sink.Arm(serverLogSource)
	logger.Info("armed-line")
	got := sink.Texts()
	if len(got) != 1 {
		t.Fatalf("armed lines = %v, want 1", got)
	}
	if got[0] == "" || !strings.Contains(got[0], "armed-line") {
		t.Fatalf("line %q missing armed-line", got[0])
	}
	if sink.lines[0].Source != serverLogSource {
		t.Fatalf("source = %q, want %q", sink.lines[0].Source, serverLogSource)
	}

	sink.Disarm(serverLogSource)
	logger.Info("after-disarm")
	if got := sink.Texts(); len(got) != 1 {
		t.Fatalf("after disarm lines = %v, want still 1", got)
	}
}
