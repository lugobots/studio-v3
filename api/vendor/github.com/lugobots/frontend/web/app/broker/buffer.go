package broker

import (
	"context"
	"errors"
	"github.com/lugobots/frontend/web/app"
	"sync"
	"time"
)

// deprecating

type Buffer struct {
	queue       []app.FrontEndUpdate
	mutex       sync.Mutex
	waitingNext context.CancelFunc
	stopOnce    sync.Once
}

func (b *Buffer) Enqueue(udpate app.FrontEndUpdate) {
	defer b.waitingNext()
	b.mutex.Lock()
	defer b.mutex.Unlock()
	b.queue = append(b.queue, udpate)
}

func (b *Buffer) Close() error {
	return nil
}

func (b *Buffer) Next() (*app.FrontEndUpdate, error) {
	if len(b.queue) == 0 {
		var ctx context.Context
		ctx, b.waitingNext = context.WithTimeout(context.Background(), 30*time.Second)
		<-ctx.Done()
		if ctx.Err() != context.Canceled {
			return nil, errors.New("buffer did not received more updates")
		}
	}
	b.mutex.Lock()
	defer b.mutex.Unlock()
	first := b.queue[0]
	b.queue = append([]app.FrontEndUpdate{}, b.queue...)
	return &first, nil
}
