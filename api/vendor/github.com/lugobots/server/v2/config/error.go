package config

import (
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

func SilentError(err error) zap.Field {
	// you could even flip the encoding depending on the environment here if you want
	return zap.Field{Key: "error", Type: zapcore.StringType, String: err.Error()}
}
