package main

import (
	"context"
	"log"
	"net/http"
	"time"

	"studio-v3/api/internal/procreg"
)

const runtimeShutdownTimeout = 10 * time.Second

// awaitRuntimeShutdown mirrors the API process exit path: after ctx is canceled
// (typically by signal.NotifyContext on SIGINT/SIGTERM), stop the HTTP server
// and terminate every tracked server/bot runtime entry.
func awaitRuntimeShutdown(ctx context.Context, httpServer *http.Server, reg *procreg.Registry) {
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), runtimeShutdownTimeout)
	defer cancel()
	if httpServer != nil {
		_ = httpServer.Shutdown(shutdownCtx)
	}
	if reg == nil {
		return
	}
	if err := reg.ShutdownAll(); err != nil {
		log.Printf("runtime shutdown: %v", err)
	}
}
