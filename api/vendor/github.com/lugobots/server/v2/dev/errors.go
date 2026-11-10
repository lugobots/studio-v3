package dev

type Error string

func (e Error) Error() string { return string(e) }

const (
	ErrBrkPointAlreadyClosed = Error("debugger already closed")
	ErrBrkPointClosed        = Error("debugger is closed")
	ErrBrkPointNotWaiting    = Error("point not being waited")
	ErrBrkPointTimeExceeded  = Error("Bug exceeded the time")
)
