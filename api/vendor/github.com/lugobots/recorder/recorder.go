package recorder

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/golang/protobuf/jsonpb"
	"github.com/lugobots/lugo4go/v3/proto"
	"github.com/pkg/errors"
	"io/ioutil"
	"sync"
	"time"
)

type LugoGameRecorder struct {
	fWriter            FileWriter
	protobufMarshaller *jsonpb.Marshaler
	closeOnlyOnce      sync.Once
}

const MaxWritingTime = time.Second

func NewLugoEventRecorder(fWriter FileWriter, gameSetup *proto.GameSetup) (*LugoGameRecorder, error) {
	headerRaw, err := json.Marshal(FileHeader{
		Date: time.Now(),
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to marshal the file header")
	}

	ctx, stop := context.WithTimeout(context.Background(), MaxWritingTime)
	defer stop()
	compressedLine, err := compressLine(headerRaw)
	if err != nil {
		return nil, err
	}
	if err := fWriter.AppendContents(ctx, compressedLine); err != nil {
		return nil, errors.Wrap(err, "failed to write file header")
	}

	pbMarshaller := &jsonpb.Marshaler{
		OrigName: true,
		//EmitDefaults: true,
	}

	raw, err := pbMarshaller.MarshalToString(gameSetup)
	if err != nil {
		return nil, errors.Wrap(err, "failed to marshal the game setup into json")
	}
	ctx2, stop2 := context.WithTimeout(context.Background(), MaxWritingTime)
	defer stop2()
	compressedLine, err = compressLine([]byte(raw))
	if err != nil {
		return nil, err
	}
	if err := fWriter.AppendContents(ctx2, compressedLine); err != nil {
		return nil, errors.Wrap(err, "failed to write the game setup to the file")
	}

	return &LugoGameRecorder{
		fWriter:            fWriter,
		protobufMarshaller: pbMarshaller,
		closeOnlyOnce:      sync.Once{},
	}, nil
}

func (f *LugoGameRecorder) OnSend(event *proto.GameEvent) error {
	switch event.Event.(type) {
	// let's ignore these events, but they probably won't be here because we cannot record on dev mode
	case *proto.GameEvent_Breakpoint, *proto.GameEvent_DebugReleased:
		return nil
	}

	raw, err := f.protobufMarshaller.MarshalToString(event)
	if err != nil {
		return errors.Wrap(err, "failed to marshal the game event into json")
	}
	ctx, stop := context.WithTimeout(context.Background(), MaxWritingTime)
	defer stop()
	compressedLine, err := compressLine([]byte(raw))
	if err != nil {
		return err
	}
	if err := f.fWriter.AppendContents(ctx, compressedLine); err != nil {
		return errors.Wrap(err, "failed to write the event to the file")
	}
	return nil
}

func (f *LugoGameRecorder) Close(ctx context.Context) error {
	var err error
	f.closeOnlyOnce.Do(func() {
		err = f.fWriter.Close(ctx)
	})
	return err
}

func compressLine(original []byte) ([]byte, error) {
	var b bytes.Buffer
	gz := gzip.NewWriter(&b)
	if _, err := gz.Write(original); err != nil {
		return nil, errors.Wrap(err, "could not compress a line to the file")
	}
	if err := gz.Flush(); err != nil {
		return nil, errors.Wrap(err, "could not write a line to the file")
	}
	if err := gz.Close(); err != nil {
		return nil, errors.Wrap(err, "could not close the writing point a line of the file")
	}
	return []byte(base64.StdEncoding.EncodeToString(b.Bytes())), nil
}

func decompress(original []byte) ([]byte, error) {
	data, err := base64.StdEncoding.DecodeString(string(original))
	if err != nil {
		return nil, errors.Wrap(err, "file corrupted: could not decode a line")
	}
	rdata := bytes.NewReader(data)
	r, err := gzip.NewReader(rdata)
	if err != nil {
		return nil, errors.Wrap(err, "file corrupted: could not decompress a line")
	}
	s, err := ioutil.ReadAll(r)
	if err != nil {
		return nil, errors.Wrap(err, "file corrupted: could not read the decompressed line")
	}
	return s, nil
}
