package diffuser

import "github.com/lugobots/lugo4go/v3/proto"

// EventListenner consumes game events
type EventListenner interface {
	OnSend(*proto.GameEvent) error
}

// EventBroadcaster Can be user to broadcast event to an audience (e.g. web user, a server that saves da data)
type EventBroadcaster interface {
	Send(*proto.GameEvent)
}
