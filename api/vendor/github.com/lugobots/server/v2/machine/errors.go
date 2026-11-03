package machine

type Error string

func (e Error) Error() string { return string(e) }

const (
	ErrPositionNotAvailable   = Error("position not available")
	ErrInvalidPlayerNumber    = Error("invalid player number")
	ErrInvalidInitialPosition = Error("invalid initial position")
)
