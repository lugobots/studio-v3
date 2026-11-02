package procreg

// Hook is an in-process shutdown callback (for example stopping an embedded
// game server). A nil Hook is a no-op.
type Hook func() error

// Shutdown implements Entry.
func (h Hook) Shutdown() error {
	if h == nil {
		return nil
	}
	return h()
}
