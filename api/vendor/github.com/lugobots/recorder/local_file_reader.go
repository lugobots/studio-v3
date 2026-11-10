package recorder

import (
	"bufio"
	"context"
	"github.com/pkg/errors"
	"io"
	"os"
	"sync"
)

type LocalFileReader struct {
	file          *os.File
	scanner       *bufio.Scanner
	closeOnlyOnce sync.Once
}

func NewLocalFileReader(absoluteFilePath string) (*LocalFileReader, error) {
	file, err := os.Open(absoluteFilePath)
	if err != nil {
		return nil, errors.Wrap(err, "could not read the game file")
	}
	scanner := bufio.NewScanner(file)

	return &LocalFileReader{
		file:          file,
		scanner:       scanner,
		closeOnlyOnce: sync.Once{},
	}, err
}

func (l *LocalFileReader) ReadLine() ([]byte, error) {
	if !l.scanner.Scan() {
		return nil, io.EOF
	}
	lineBytes := l.scanner.Bytes()
	if err := l.scanner.Err(); err != nil {
		return nil, err
	}
	return lineBytes, nil
}

func (l *LocalFileReader) Close(_ context.Context) error {
	var err error
	l.closeOnlyOnce.Do(func() {
		err = l.file.Close()
	})
	return err
}
