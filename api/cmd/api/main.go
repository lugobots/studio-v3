package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
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
	addr := listenAddr()
	mux := http.NewServeMux()
	log.Printf("studio-v3 api listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		fmt.Fprintf(os.Stderr, "listen: %v\n", err)
		os.Exit(1)
	}
}
