// Package procreg tracks child processes and in-process shutdown hooks so the
// Studio API can terminate every managed entry when it shuts down.
package procreg

import (
	"errors"
	"sync"
	"sync/atomic"
)

// ID identifies a registered entry.
type ID uint64

// Entry is anything the registry can shut down: an OS child process, an
// in-process game-server hook, or a later helper.
type Entry interface {
	Shutdown() error
}

// Registry tracks registered entries and shuts them all down on demand.
type Registry struct {
	mu      sync.Mutex
	next    atomic.Uint64
	entries map[ID]Entry
}

// New returns an empty registry.
func New() *Registry {
	return &Registry{entries: make(map[ID]Entry)}
}

// Register adds an entry and returns its ID.
func (r *Registry) Register(e Entry) ID {
	if e == nil {
		panic("procreg: Register(nil)")
	}
	id := ID(r.next.Add(1))
	r.mu.Lock()
	defer r.mu.Unlock()
	r.entries[id] = e
	return id
}

// Unregister removes an entry. It is a no-op if the ID is unknown.
func (r *Registry) Unregister(id ID) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.entries, id)
}

// Len returns the number of currently registered entries.
func (r *Registry) Len() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.entries)
}

// ShutdownAll terminates every registered entry and clears the registry.
// It continues shutting down remaining entries after an error and returns a
// combined error if any Shutdown call failed.
func (r *Registry) ShutdownAll() error {
	r.mu.Lock()
	entries := make([]Entry, 0, len(r.entries))
	for id, e := range r.entries {
		entries = append(entries, e)
		delete(r.entries, id)
	}
	r.mu.Unlock()

	var errs []error
	for _, e := range entries {
		if err := e.Shutdown(); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
