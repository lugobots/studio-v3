package recorder

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/golang/protobuf/jsonpb"
	"github.com/lugobots/lugo4go/v3/proto"
	"github.com/pkg/errors"
)

type LugoGameRecordReader struct {
	fileReader FileReader
	header     FileHeader
	gameSetup  *proto.GameSetup
}

func NewLugoGameRecordReader(fileReader FileReader) (*LugoGameRecordReader, error) {
	firstLine, err := fileReader.ReadLine()
	if err != nil {
		return nil, errors.Wrap(err, "file to read the file first line")
	}

	var header FileHeader
	decompressedLine, err := decompress(firstLine)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(decompressedLine, &header); err != nil {
		return nil, errors.Wrap(err, "could not marshall the header (first line)")
	}

	secondLine, err := fileReader.ReadLine()
	if err != nil {
		return nil, errors.Wrap(err, "file to read the file second line")
	}

	var gameSetup proto.GameSetup
	decompressedLine, err = decompress(secondLine)
	if err != nil {
		return nil, err
	}
	if err := jsonpb.Unmarshal(bytes.NewReader(decompressedLine), &gameSetup); err != nil {
		return nil, errors.Wrap(err, "could not marshall game setup (second line)")
	}

	return &LugoGameRecordReader{
		fileReader: fileReader,
		header:     header,
		gameSetup:  &gameSetup,
	}, nil
}

func (l *LugoGameRecordReader) GetFileHeader() FileHeader {
	return l.header
}
func (l *LugoGameRecordReader) GetGameSetup() *proto.GameSetup {
	return l.gameSetup
}

func (l *LugoGameRecordReader) ReadNextEvent() (*proto.GameEvent, error) {
	nextLine, err := l.fileReader.ReadLine()
	if err != nil {
		return nil, errors.Wrap(err, "file to read the next line")
	}

	var gameEvent proto.GameEvent
	decompressedLine, err := decompress(nextLine)
	if err != nil {
		return nil, err
	}
	if err := jsonpb.Unmarshal(bytes.NewReader(decompressedLine), &gameEvent); err != nil {
		return nil, errors.Wrap(err, "could not marshall a game event")
	}
	return &gameEvent, nil
}

func (l *LugoGameRecordReader) Close(ctx context.Context) error {
	return l.fileReader.Close(ctx)
}
