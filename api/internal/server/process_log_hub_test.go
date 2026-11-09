package server

import (
	"testing"
)

func TestProcessLogHubDefaultsRetainNothing(t *testing.T) {
	h := newProcessLogHubWithCap(8)
	h.Append("server", "quiet")
	h.Append("api", "debug")
	h.Append("home/3", "bot line")
	if h.Len() != 0 {
		t.Fatalf("default-off retained %d lines, want 0", h.Len())
	}
	if h.Armed("server") || h.Armed("api") || h.Armed("home/3") {
		t.Fatal("sources should default unarmed")
	}
}

func TestProcessLogHubArmRetainsTaggedLines(t *testing.T) {
	h := newProcessLogHubWithCap(8)
	if err := h.Arm("server"); err != nil {
		t.Fatal(err)
	}
	h.Append("server", "hello")
	h.Append("home/1", "ignored")
	snap := h.Snapshot()
	if len(snap) != 1 {
		t.Fatalf("retained %d lines, want 1", len(snap))
	}
	if snap[0].Source != "server" || snap[0].Text != "hello" {
		t.Fatalf("line = %+v", snap[0])
	}
	if !h.Armed("server") {
		t.Fatal("server should be armed")
	}
	if h.Armed("home/1") {
		t.Fatal("home/1 should stay unarmed")
	}
}

func TestProcessLogHubOverflowDropsOldest(t *testing.T) {
	h := newProcessLogHubWithCap(3)
	if err := h.Arm("api"); err != nil {
		t.Fatal(err)
	}
	for i, text := range []string{"a", "b", "c", "d", "e"} {
		h.Append("api", text)
		_ = i
	}
	snap := h.Snapshot()
	if len(snap) != 3 {
		t.Fatalf("len = %d, want 3", len(snap))
	}
	got := []string{snap[0].Text, snap[1].Text, snap[2].Text}
	want := []string{"c", "d", "e"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("texts = %v, want %v", got, want)
		}
	}
}

func TestProcessLogHubDisarmStopsFurtherRetention(t *testing.T) {
	h := newProcessLogHubWithCap(8)
	if err := h.Arm("away/2"); err != nil {
		t.Fatal(err)
	}
	h.Append("away/2", "before")
	if err := h.Disarm("away/2"); err != nil {
		t.Fatal(err)
	}
	h.Append("away/2", "after")
	snap := h.Snapshot()
	if len(snap) != 1 || snap[0].Text != "before" {
		t.Fatalf("snap = %+v, want only before", snap)
	}
}

func TestProcessLogHubRejectsInvalidSource(t *testing.T) {
	h := newProcessLogHub()
	if err := h.Arm("home/99"); err == nil {
		t.Fatal("expected invalid source error")
	}
	if err := h.Arm("other"); err == nil {
		t.Fatal("expected invalid source error")
	}
}
