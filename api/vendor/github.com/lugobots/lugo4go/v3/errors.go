package lugo4go

import (
	"errors"
)

var (
	// ErrGRPCConnectionClosed identifies when the error returned is cased by the connection has been closed
	ErrGRPCConnectionClosed = errors.New("grpc connection closed by the server")

	// ErrGRPCConnectionLost identifies that something unexpected broke the gRPC connection
	ErrGRPCConnectionLost = errors.New("grpc stream error")
)

var (
	ErrNilSnapshot    = errors.New("invalid snapshot state (nil)")
	ErrPlayerNotFound = errors.New("player not found in the game snapshot")
	ErrNoBall         = errors.New("no ball found in the snapshot")
)
