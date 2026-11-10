package procreg

import (
	"strings"
	"sync"
	"testing"
	"time"
)

func TestStartShellCaptureReadsStdout(t *testing.T) {
	var mu sync.Mutex
	var lines []string
	child, err := StartShellCapture("", "echo hello-capture; echo world-capture", nil, func(line string) {
		mu.Lock()
		lines = append(lines, line)
		mu.Unlock()
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = child.Shutdown() })

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		n := len(lines)
		mu.Unlock()
		if n >= 2 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	mu.Lock()
	defer mu.Unlock()
	joined := strings.Join(lines, "\n")
	if !strings.Contains(joined, "hello-capture") || !strings.Contains(joined, "world-capture") {
		t.Fatalf("lines = %v", lines)
	}
}

func TestStartShellCaptureNilOnLineMatchesStartShell(t *testing.T) {
	child, err := StartShellCapture("", "sleep 60", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = child.Shutdown() })
	if child.Cmd.Stdout != nil || child.Cmd.Stderr != nil {
		t.Fatal("nil onLine should not attach pipes")
	}
}
