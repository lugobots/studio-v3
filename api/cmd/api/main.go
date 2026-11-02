package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"studio-v3/api/internal/gameruntime"
	"studio-v3/api/internal/procreg"
	"studio-v3/api/internal/server"
)

const defaultPort = "8081"

func listenAddr() string {
	port := os.Getenv("LUGO_STUDIO_API_PORT")
	if port == "" {
		port = defaultPort
	}
	return ":" + port
}

func main() {
	reg := procreg.New()
	starter := gameruntime.New(reg)
	mux := server.NewMuxWith(server.Deps{
		Registry: reg,
		Starter:  starter,
	})

	addr := listenAddr()
	httpServer := &http.Server{Addr: addr, Handler: mux}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
		if err := reg.ShutdownAll(); err != nil {
			log.Printf("runtime shutdown: %v", err)
		}
	}()

	log.Printf("studio-v3 api listening on %s", addr)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		fmt.Fprintf(os.Stderr, "listen: %v\n", err)
		os.Exit(1)
	}
}
