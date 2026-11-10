package recorder

import (
	"context"
	"fmt"
	"os"
	"sync"

	"github.com/pkg/errors"
)

type LocalFileWriter struct {
	file          *os.File
	closeOnlyOnce sync.Once
}

func NewLocalFileWriter(absoluteFilePath string) (*LocalFileWriter, error) {
	if _, err := os.Stat(absoluteFilePath); !errors.Is(err, os.ErrNotExist) {
		return nil, errors.Wrapf(err, "recording file '%s' already exist - must be a new file", absoluteFilePath)
	}
	f, err := os.OpenFile(absoluteFilePath, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0600)
	if err != nil {
		return nil, errors.Wrap(err, "could not create a file to save the game")
	}

	return &LocalFileWriter{
		file:          f,
		closeOnlyOnce: sync.Once{},
	}, nil
}

func (l *LocalFileWriter) AppendContents(ctx context.Context, data []byte) error {
	_, err := l.file.WriteString(fmt.Sprintf("%s\n", data))
	return errors.Wrap(err, "error writing")
}

func (l *LocalFileWriter) Close(_ context.Context) error {
	var err error
	l.closeOnlyOnce.Do(func() {
		err = l.file.Close()
	})
	return err
}
