package recorder

import (
	"context"
	"github.com/lugobots/lugo4go/v3/proto"
	"time"
)

type FileWriter interface {
	AppendContents(ctx context.Context, data []byte) error
	Close(ctx context.Context) error
}

type FileReader interface {
	ReadLine() ([]byte, error)
	Close(ctx context.Context) error
}

type FileHeader struct {
	Date time.Time `json:"date"`
}

type GameRecordReader interface {
	GetFileHeader() FileHeader
	GetGameSetup() *proto.GameSetup
	ReadNextEvent() (*proto.GameEvent, error)
}
