package lugo4go

import (
	"context"
	"fmt"
	"os"
	"os/signal"

	"go.uber.org/zap"

	"github.com/lugobots/lugo4go/v3/field"
)

func NewDefaultStarter() (*Starter, field.Mapper, error) {
	playerConfig, defaultMapper, logger, err := DefaultInitBundle()
	if err != nil {
		return nil, nil, fmt.Errorf("could not init default config or logger: %w", err)
	}

	return &Starter{
		Config: playerConfig,
		Logger: logger,
	}, defaultMapper, nil
}

type Starter struct {
	Config Config
	Logger *zap.SugaredLogger
}

func (s *Starter) Run(bot Bot) error {
	return s.defaultRun(func(client *Client, stop context.CancelFunc) {
		defer stop()
		if err := client.PlayAsBot(bot); err != nil {
			s.Logger.Errorf("bot stopped with an error: %s", err)
		}
	})
}

func (s *Starter) RunJustTurnHandler(handler RawBot) error {
	return s.defaultRun(func(client *Client, stop context.CancelFunc) {
		defer stop()
		if err := client.Play(handler); err != nil {
			s.Logger.Errorf("bot stopped with an error: %s", err)
		}
	})
}

func (s *Starter) defaultRun(runner func(client *Client, stop context.CancelFunc)) error {
	client, err := NewClient(s.Config, s.Logger)
	if err != nil {
		return fmt.Errorf("could not init the client: %w", err)
	}

	ctx, stop := context.WithCancel(context.Background())
	go runner(client, stop)

	signalChan := make(chan os.Signal, 1)
	signal.Notify(signalChan, os.Interrupt)
	select {
	case <-ctx.Done():
	case <-signalChan:
		if err := client.Stop(); err != nil {
			s.Logger.Errorf("error stopping bot: %s", err)
		}
	}
	s.Logger.Debug("bot stopped")
	return nil
}
