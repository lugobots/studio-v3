package app

type Config struct {
	GRPCAddress         string
	GRPCInsecure        bool `json:"-"`
	StaysIfDisconnected bool
}
