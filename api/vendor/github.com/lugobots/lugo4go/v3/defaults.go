package lugo4go

import (
	"fmt"
	"os"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/lugobots/lugo4go/v3/field"
)

const (
	DefaultFieldMapCols = 16
	DefaultFieldMapRows = 8
)

var DefaultInitialPositions = map[int]struct {
	Col int
	Row int
}{
	2:  {Col: 1, Row: 2},
	3:  {Col: 1, Row: 3},
	4:  {Col: 1, Row: 4},
	5:  {Col: 1, Row: 5},
	6:  {Col: 4, Row: 1},
	7:  {Col: 4, Row: 3},
	8:  {Col: 4, Row: 4},
	9:  {Col: 4, Row: 6},
	10: {Col: 6, Row: 3},
	11: {Col: 6, Row: 4},
}

// DefaultLogger creates a logger that is compatible with the lugo4go.rawBot expected logger.
// The bots are NOT obligated to use this logger though. You may implement your own logger.
func DefaultLogger(config Config) *zap.SugaredLogger {
	configZap := zap.NewDevelopmentConfig()
	configZap.EncoderConfig.EncodeLevel = zapcore.CapitalColorLevelEncoder
	zapLog, _ := configZap.Build()
	// no need to check the error since this configuration won cause any
	return zapLog.Sugar().Named(fmt.Sprintf("%s-%d", config.TeamSide, config.Number))
}

// DefaultInitBundle created a basic configuration that may be used by the client to connect to the server.
// It also creates a logger that is compatible with the lugo4go.rawBot.
func DefaultInitBundle() (Config, field.Mapper, *zap.SugaredLogger, error) {
	config := Config{}

	if err := config.loadConfig(os.Args[1:]); err != nil {
		return config, nil, nil, fmt.Errorf("did not parsed well the flags for config: %s", err)
	}

	// default initial position
	defaultMapper, _ := field.NewMapper(DefaultFieldMapCols, DefaultFieldMapRows, config.TeamSide)

	defaultInitialRegion, _ := defaultMapper.GetRegion(DefaultInitialPositions[config.Number].Col, DefaultInitialPositions[config.Number].Row)
	config.InitialPosition = defaultInitialRegion.Center()

	logger := DefaultLogger(config)
	return config, defaultMapper, logger, nil
}
