package procreg_test

import (
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"studio-v3/api/internal/procreg"
)

func TestShutdownAllTerminatesEveryRegisteredEntry(t *testing.T) {
	reg := procreg.New()

	var hooks [3]atomic.Bool
	for i := range hooks {
		i := i
		reg.Register(procreg.Hook(func() error {
			hooks[i].Store(true)
			return nil
		}))
	}

	childA, err := procreg.StartChild("sleep", "60")
	if err != nil {
		t.Fatalf("start child A: %v", err)
	}
	childB, err := procreg.StartChild("sleep", "60")
	if err != nil {
		t.Fatalf("start child B: %v", err)
	}
	reg.Register(childA)
	reg.Register(childB)

	if got := reg.Len(); got != 5 {
		t.Fatalf("Len() = %d, want 5", got)
	}

	if err := reg.ShutdownAll(); err != nil {
		t.Fatalf("ShutdownAll: %v", err)
	}

	if got := reg.Len(); got != 0 {
		t.Fatalf("Len() after ShutdownAll = %d, want 0", got)
	}

	for i, h := range hooks {
		if !h.Load() {
			t.Fatalf("hook %d was not terminated", i)
		}
	}
	assertProcessDead(t, childA.Cmd.Process.Pid, "child A")
	assertProcessDead(t, childB.Cmd.Process.Pid, "child B")
}

func TestUnregisterSkipsShutdown(t *testing.T) {
	reg := procreg.New()
	var called atomic.Bool
	id := reg.Register(procreg.Hook(func() error {
		called.Store(true)
		return nil
	}))
	reg.Unregister(id)

	if err := reg.ShutdownAll(); err != nil {
		t.Fatalf("ShutdownAll: %v", err)
	}
	if called.Load() {
		t.Fatal("unregistered hook was shut down")
	}
}

func assertProcessDead(t *testing.T, pid int, name string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for processAlive(pid) {
		if time.Now().After(deadline) {
			t.Fatalf("%s (pid %d) still running after ShutdownAll", name, pid)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func processAlive(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil
}
