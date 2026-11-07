package gameruntime

import (
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// LogSink receives armed process-log lines (implemented by the Studio API hub).
type LogSink interface {
	Armed(source string) bool
	Append(source, text string)
}

const serverLogSource = "server"

// armedLevel enables log emission only while the server source is armed so
// disarmed sessions stay near Quiet/Nop cost (no encode/write).
type armedLevel struct {
	sink LogSink
}

func (a armedLevel) Enabled(lvl zapcore.Level) bool {
	return a.sink != nil && a.sink.Armed(serverLogSource)
}

type hubWriteSyncer struct {
	sink LogSink
}

func (w hubWriteSyncer) Write(p []byte) (int, error) {
	if w.sink == nil {
		return len(p), nil
	}
	// zap console encoder includes a trailing newline; trim for the hub line.
	text := string(p)
	if n := len(text); n > 0 && text[n-1] == '\n' {
		text = text[:n-1]
	}
	w.sink.Append(serverLogSource, text)
	return len(p), nil
}

func (w hubWriteSyncer) Sync() error { return nil }

// newServerHubLogger builds a sugared logger that appends tagged "server" lines
// into sink only while that source is armed.
func newServerHubLogger(sink LogSink) *zap.SugaredLogger {
	encCfg := zap.NewDevelopmentEncoderConfig()
	encCfg.EncodeLevel = zapcore.CapitalLevelEncoder
	encCfg.EncodeTime = zapcore.ISO8601TimeEncoder
	core := zapcore.NewCore(
		zapcore.NewConsoleEncoder(encCfg),
		hubWriteSyncer{sink: sink},
		armedLevel{sink: sink},
	)
	return zap.New(core).Sugar()
}
