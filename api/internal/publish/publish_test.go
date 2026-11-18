package publish

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestBuildAndPushArgsAreLanguageAgnostic(t *testing.T) {
	image := ImageRef("acme/bot", "v1")
	if image != "repo.lugobots.ai/acme/bot:v1" {
		t.Fatalf("image = %q", image)
	}
	want := "build -f .lugo/Dockerfile -t repo.lugobots.ai/acme/bot:v1 ."
	if got := strings.Join(BuildArgs(image), " "); got != want {
		t.Fatalf("build args = %q, want %q", got, want)
	}
	if got := strings.Join(PushArgs(image), " "); got != "push repo.lugobots.ai/acme/bot:v1" {
		t.Fatalf("push args = %q", got)
	}
}

func TestNormalizeBotURI(t *testing.T) {
	for in, want := range map[string]string{
		"acme/bot":                     "acme/bot",
		" repo.lugobots.ai/acme/bot/ ": "acme/bot",
		"bot":                          "bot",
	} {
		got, err := NormalizeBotURI(in)
		if err != nil || got != want {
			t.Fatalf("NormalizeBotURI(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{"", "Acme/Bot", "acme//bot", "acme/bot:v1", "-bad", "a b"} {
		if _, err := NormalizeBotURI(in); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("NormalizeBotURI(%q) err = %v", in, err)
		}
	}
}

type blockingRunner struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (b *blockingRunner) Run(ctx context.Context, dir, stdin, name string, args ...string) ([]byte, error) {
	b.once.Do(func() { close(b.started) })
	<-b.release
	return nil, nil
}

func TestPublishRejectsConcurrentRuns(t *testing.T) {
	project := t.TempDir()
	if err := os.MkdirAll(filepath.Join(project, ".lugo"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, ".lugo", "Dockerfile"), []byte("FROM scratch\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runner := &blockingRunner{started: make(chan struct{}), release: make(chan struct{})}
	svc := &Service{Runner: runner}

	done := make(chan error, 1)
	go func() {
		_, err := svc.Publish(context.Background(), project, "acme/bot", "v1")
		done <- err
	}()
	<-runner.started
	if _, err := svc.Publish(context.Background(), project, "acme/bot", "v2"); !errors.Is(err, ErrBusy) {
		t.Fatalf("second publish err = %v, want ErrBusy", err)
	}
	close(runner.release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
