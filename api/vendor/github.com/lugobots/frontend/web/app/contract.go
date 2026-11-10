package app

import (
	"encoding/json"
	"github.com/lugobots/lugo4go/v3/proto"
)

type EventsBroker interface {
	StreamEventsTo(uuid string) chan FrontEndUpdate
	GetGameConfig(uuid string) (FrontEndSet, error)
	GetRemote() proto.RemoteClient
	StartGame(uuid string) error
}

type EventType string

const (
	EventNewPlayer     EventType = "new_player"
	EventBreakpoint    EventType = "breakpoint"
	EventStateChange   EventType = "state_change"
	EventDebugReleased EventType = "debug_released"
	EventGameOver      EventType = "game_over"
	EventLostPlayer    EventType = "lost_player"
	EventGoal          EventType = "goal"
	EventPeriodChanged EventType = "period_changed"

	//events between frontend server and frontend
	EventConnectionLost          EventType = "connection_lots"
	EventConnectionReestablished EventType = "connection_reestablished"
	EventBuffering               EventType = "buffering"
	EventBufferReady             EventType = "buffer_ready"
)

const (
	ConnStateUp   = "up"
	ConnStateDown = "down"
)

type UpdateData struct {
	GameEvent     json.RawMessage `json:"game_event"`
	TimeRemaining string          `json:"time_remaining"`
	ShotTime      string          `json:"shot_time"`
	DebugMode     bool            `json:"debug_mode"`
	Buffer        int             `json:"buffer_percentile"`
}

type FrontEndUpdate struct {
	// speed up the rate calc
	GameEvent       *proto.GameEvent `json:"-"`
	Type            EventType        `json:"type"`
	Update          UpdateData       `json:"data"`
	ConnectionState string           `json:"connection_state"`
}
type FrontEndSet struct {
	GameSetup       json.RawMessage `json:"game_setup"`
	ConnectionState string          `json:"connection_state"`
}

// Error is used to identify internal errors
type Error string

// Error implements the native golang error interface
func (e Error) Error() string { return string(e) }

const (
	// ErrGRPCConnectionClosed identifies when the error returned is cased by the connection has been closed
	ErrGRPCConnectionClosed = Error("grpc connection closed by the server")

	// ErrGRPCConnectionLost identifies that something unexpected broke the gRPC connection
	ErrGRPCConnectionLost = Error("grpc stream error")

	// ErrUnknownGameEvent identifies an error when the service receives an event of an unknown type
	ErrUnknownGameEvent = Error("unknown event type")

	ErrGameOver = Error("the game is over")

	//ErrStopRequested = Error("it was requested to stop")
)
