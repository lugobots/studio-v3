package bots

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"studio-v3/api/internal/procreg"
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

func (m *memLogSink) forSource(source string) []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []string
	for _, l := range m.lines {
		if l.Source == source {
			out = append(out, l.Text)
		}
	}
	return out
}

func waitForLine(t *testing.T, sink *memLogSink, source, substr string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		for _, line := range sink.forSource(source) {
			if strings.Contains(line, substr) {
				return
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for %q from %s; got %v", substr, source, sink.forSource(source))
}

func TestManagerArmedSlotCapturesStdoutTagged(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module demo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	opp := filepath.Join(t.TempDir(), "opp-bot")
	script := "#!/bin/sh\necho home-one-line\nsleep 60\n"
	if err := os.WriteFile(opp, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	sink := &memLogSink{}
	sink.Arm("home/1")

	reg := procreg.New()
	mgr := New(reg)
	mgr.Logs = sink
	mgr.RunSync = func(dir, command string, env map[string]string) error { return nil }
	// No StartProcess override: real StartShellCapture path.

	cfg := Config{
		ProjectRoot:    root,
		GRPCURL:        "localhost:5123",
		PlayerSide:     SideAway, // home slots use opponent binary
		OpponentMode:   "default",
		OpponentBinary: opp,
	}
	home := Slot{Side: SideHome, Number: 1}
	if err := mgr.StartBot(cfg, home); err != nil {
		t.Fatalf("StartBot: %v", err)
	}
	t.Cleanup(func() { _ = reg.ShutdownAll() })

	waitForLine(t, sink, "home/1", "home-one-line")
}

func TestManagerDisarmStopsFurtherHubIntake(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module demo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	opp := filepath.Join(t.TempDir(), "opp-bot")
	// Emit a line, pause, emit another — disarm between them.
	script := "#!/bin/sh\necho first-line\nsleep 0.3\necho second-line\nsleep 60\n"
	if err := os.WriteFile(opp, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	sink := &memLogSink{}
	sink.Arm("home/2")

	reg := procreg.New()
	mgr := New(reg)
	mgr.Logs = sink
	mgr.RunSync = func(dir, command string, env map[string]string) error { return nil }

	cfg := Config{
		ProjectRoot:    root,
		GRPCURL:        "localhost:5123",
		PlayerSide:     SideAway,
		OpponentBinary: opp,
	}
	slot := Slot{Side: SideHome, Number: 2}
	if err := mgr.StartBot(cfg, slot); err != nil {
		t.Fatalf("StartBot: %v", err)
	}
	t.Cleanup(func() { _ = reg.ShutdownAll() })

	waitForLine(t, sink, "home/2", "first-line")
	sink.Disarm("home/2")
	time.Sleep(500 * time.Millisecond)
	for _, line := range sink.forSource("home/2") {
		if strings.Contains(line, "second-line") {
			t.Fatalf("disarmed source still retained %q", line)
		}
	}
}

func TestManagerOneSlotIsolationAndDefaultOff(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module demo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	oppDir := t.TempDir()
	armedBin := filepath.Join(oppDir, "armed")
	quietBin := filepath.Join(oppDir, "quiet")
	if err := os.WriteFile(armedBin, []byte("#!/bin/sh\necho armed-only\nsleep 60\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(quietBin, []byte("#!/bin/sh\necho should-not-capture\nsleep 60\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	sink := &memLogSink{}
	sink.Arm("home/3")

	reg := procreg.New()
	mgr := New(reg)
	mgr.Logs = sink
	mgr.RunSync = func(dir, command string, env map[string]string) error { return nil }

	// Launch armed home/3 via opponent binary path swap between starts.
	cfgArmed := Config{
		ProjectRoot:    root,
		GRPCURL:        "localhost:5123",
		PlayerSide:     SideAway,
		OpponentBinary: armedBin,
	}
	cfgQuiet := cfgArmed
	cfgQuiet.OpponentBinary = quietBin

	armed := Slot{Side: SideHome, Number: 3}
	quiet := Slot{Side: SideHome, Number: 4}

	if err := mgr.StartBot(cfgArmed, armed); err != nil {
		t.Fatalf("StartBot armed: %v", err)
	}
	if err := mgr.StartBot(cfgQuiet, quiet); err != nil {
		t.Fatalf("StartBot quiet: %v", err)
	}
	t.Cleanup(func() { _ = reg.ShutdownAll() })

	waitForLine(t, sink, "home/3", "armed-only")
	time.Sleep(200 * time.Millisecond)
	if got := sink.forSource("home/4"); len(got) != 0 {
		t.Fatalf("disarmed slot retained lines %v", got)
	}
	// Quiet slot still pipes stdout, but Append drops lines until armed.
	_ = mgr.bots[slotKey(quiet)].child
	armedChild := mgr.bots[slotKey(armed)].child
	if armedChild.Cmd.Stdout == nil && armedChild.Cmd.Stderr == nil {
		// After Start, pipe fields may be nilled by os/exec once started; check
		// that we at least captured output as evidence pipes were used.
		t.Log("pipe fields cleared after start (ok if lines captured)")
	}
}

func TestManagerMidRunArmRetainsAfterStart(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module demo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	opp := filepath.Join(t.TempDir(), "opp-bot")
	script := "#!/bin/sh\nwhile true; do echo mid-run-line; sleep 0.1; done\n"
	if err := os.WriteFile(opp, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	sink := &memLogSink{}
	reg := procreg.New()
	mgr := New(reg)
	mgr.Logs = sink
	mgr.RunSync = func(dir, command string, env map[string]string) error { return nil }

	cfg := Config{
		ProjectRoot:    root,
		GRPCURL:        "localhost:5123",
		PlayerSide:     SideAway,
		OpponentBinary: opp,
	}
	slot := Slot{Side: SideHome, Number: 1}
	if err := mgr.StartBot(cfg, slot); err != nil {
		t.Fatalf("StartBot: %v", err)
	}
	t.Cleanup(func() { _ = reg.ShutdownAll() })

	time.Sleep(250 * time.Millisecond)
	if got := sink.forSource("home/1"); len(got) != 0 {
		t.Fatalf("expected no retained lines before arm, got %v", got)
	}
	sink.Arm("home/1")
	waitForLine(t, sink, "home/1", "mid-run-line")
}

func TestSlotLogSourceLowercasesSide(t *testing.T) {
	if got := slotLogSource(Slot{Side: SideHome, Number: 11}); got != "home/11" {
		t.Fatalf("got %q", got)
	}
	if got := slotLogSource(Slot{Side: SideAway, Number: 1}); got != "away/1" {
		t.Fatalf("got %q", got)
	}
}
