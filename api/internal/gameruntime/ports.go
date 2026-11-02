package gameruntime

import (
	"os"
	"strconv"
)

const (
	defaultGameServerPort   = 5000
	defaultGameFrontendPort = 8080
)

// Ports holds the local game-server gRPC and game-frontend HTTP ports.
type Ports struct {
	GameServer   int
	GameFrontend int
}

// PortsFromEnv reads LUGO_STUDIO_GAME_SERVER_PORT and
// LUGO_STUDIO_GAME_FRONTEND_PORT (defaults 5000 / 8080).
func PortsFromEnv() Ports {
	return Ports{
		GameServer:   envPort("LUGO_STUDIO_GAME_SERVER_PORT", defaultGameServerPort),
		GameFrontend: envPort("LUGO_STUDIO_GAME_FRONTEND_PORT", defaultGameFrontendPort),
	}
}

func envPort(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 || n > 65535 {
		return fallback
	}
	return n
}
