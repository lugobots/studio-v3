// Package publish builds a mounted bot project's .lugo/Dockerfile and pushes the
// image to the Lugo registry using the Docker CLI (host engine via docker.sock).
//
// The flow is language-agnostic: whichever .lugo/Dockerfile the project ships is
// built with the project root as context. This package is Studio V3-owned and
// must not import Studio V2 publisher code.
package publish

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

// RegistryHost is the only registry Studio publishes to.
const RegistryHost = "repo.lugobots.ai"

// DockerfilePath is the project-relative Dockerfile used for every language.
const DockerfilePath = ".lugo/Dockerfile"

var (
	// ErrMissingDockerfile means the project has no .lugo/Dockerfile.
	ErrMissingDockerfile = errors.New("missing .lugo/Dockerfile in the bot project")
	// ErrBusy means another publish is already running.
	ErrBusy = errors.New("a publish is already in progress")
	// ErrInvalidInput means bot_uri or tag failed validation.
	ErrInvalidInput = errors.New("invalid input")
)

var (
	botURIPattern = regexp.MustCompile(`^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$`)
	tagPattern    = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$`)
)

// Runner executes an external command. Tests replace it with a fake.
type Runner interface {
	Run(ctx context.Context, dir string, stdin string, name string, args ...string) ([]byte, error)
}

// ExecRunner runs commands with os/exec, returning combined stdout+stderr.
type ExecRunner struct{}

// Run implements Runner.
func (ExecRunner) Run(ctx context.Context, dir string, stdin string, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	return out.Bytes(), err
}

// Service publishes bot images and manages registry credentials.
type Service struct {
	Runner Runner
	// ConfigDir returns the Docker config directory (config.json). Defaults to
	// $DOCKER_CONFIG or ~/.docker.
	ConfigDir func() string

	mu sync.Mutex
}

// New returns a Service backed by the real Docker CLI.
func New() *Service {
	return &Service{Runner: ExecRunner{}}
}

// Result describes a successful publish.
type Result struct {
	Image string `json:"image"`
}

// AuthStatus reports whether Docker holds credentials for RegistryHost.
type AuthStatus struct {
	LoggedIn bool   `json:"logged_in"`
	Username string `json:"username,omitempty"`
	Registry string `json:"registry"`
}

// NormalizeBotURI trims whitespace and an optional leading registry host, then validates.
func NormalizeBotURI(botURI string) (string, error) {
	uri := strings.Trim(strings.TrimSpace(botURI), "/")
	uri = strings.TrimPrefix(uri, RegistryHost+"/")
	if uri == "" {
		return "", fmt.Errorf("%w: bot_uri is required", ErrInvalidInput)
	}
	if !botURIPattern.MatchString(uri) {
		return "", fmt.Errorf("%w: bot_uri %q is not a valid registry path", ErrInvalidInput, botURI)
	}
	return uri, nil
}

// ValidateTag checks a Docker tag.
func ValidateTag(tag string) error {
	tag = strings.TrimSpace(tag)
	if tag == "" {
		return fmt.Errorf("%w: tag is required", ErrInvalidInput)
	}
	if !tagPattern.MatchString(tag) {
		return fmt.Errorf("%w: tag %q is not a valid Docker tag", ErrInvalidInput, tag)
	}
	return nil
}

// ImageRef returns repo.lugobots.ai/{bot_uri}:{tag}.
func ImageRef(botURI, tag string) string {
	return fmt.Sprintf("%s/%s:%s", RegistryHost, botURI, tag)
}

// BuildArgs returns docker build args: -f .lugo/Dockerfile with context ".".
// Run them with cwd set to the project root.
func BuildArgs(image string) []string {
	return []string{"build", "-f", DockerfilePath, "-t", image, "."}
}

// PushArgs returns docker push args.
func PushArgs(image string) []string {
	return []string{"push", image}
}

// Publish builds .lugo/Dockerfile in projectRoot and pushes the tagged image.
func (s *Service) Publish(ctx context.Context, projectRoot, botURI, tag string) (Result, error) {
	uri, err := NormalizeBotURI(botURI)
	if err != nil {
		return Result{}, err
	}
	tag = strings.TrimSpace(tag)
	if err := ValidateTag(tag); err != nil {
		return Result{}, err
	}
	info, err := os.Stat(filepath.Join(projectRoot, filepath.FromSlash(DockerfilePath)))
	if err != nil || info.IsDir() {
		return Result{}, ErrMissingDockerfile
	}
	if !s.mu.TryLock() {
		return Result{}, ErrBusy
	}
	defer s.mu.Unlock()

	image := ImageRef(uri, tag)
	if out, err := s.runner().Run(ctx, projectRoot, "", "docker", BuildArgs(image)...); err != nil {
		return Result{}, commandError("docker build", out, err)
	}
	if out, err := s.runner().Run(ctx, projectRoot, "", "docker", PushArgs(image)...); err != nil {
		return Result{}, commandError("docker push", out, err)
	}
	return Result{Image: image}, nil
}

// Login runs `docker login repo.lugobots.ai` with the password on stdin.
func (s *Service) Login(ctx context.Context, username, password string) error {
	username = strings.TrimSpace(username)
	if username == "" || password == "" {
		return fmt.Errorf("%w: username and password are required", ErrInvalidInput)
	}
	out, err := s.runner().Run(ctx, "", password+"\n", "docker",
		"login", RegistryHost, "--username", username, "--password-stdin")
	if err != nil {
		return commandError("docker login", out, err)
	}
	return nil
}

// Logout runs `docker logout repo.lugobots.ai`.
func (s *Service) Logout(ctx context.Context) error {
	out, err := s.runner().Run(ctx, "", "", "docker", "logout", RegistryHost)
	if err != nil {
		return commandError("docker logout", out, err)
	}
	return nil
}

// Status reports whether Docker config holds credentials for RegistryHost.
func (s *Service) Status() AuthStatus {
	status := AuthStatus{Registry: RegistryHost}
	data, err := os.ReadFile(filepath.Join(s.configDir(), "config.json"))
	if err != nil {
		return status
	}
	var cfg struct {
		Auths map[string]struct {
			Auth string `json:"auth"`
		} `json:"auths"`
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return status
	}
	entry, ok := cfg.Auths[RegistryHost]
	if !ok {
		return status
	}
	status.LoggedIn = true
	if raw, err := base64.StdEncoding.DecodeString(entry.Auth); err == nil {
		if user, _, found := strings.Cut(string(raw), ":"); found {
			status.Username = user
		}
	}
	return status
}

func (s *Service) runner() Runner {
	if s.Runner == nil {
		return ExecRunner{}
	}
	return s.Runner
}

func (s *Service) configDir() string {
	if s.ConfigDir != nil {
		return s.ConfigDir()
	}
	if dir := os.Getenv("DOCKER_CONFIG"); dir != "" {
		return dir
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".docker")
}

// commandError wraps a failed docker command with the tail of its output.
func commandError(what string, out []byte, err error) error {
	tail := strings.TrimSpace(string(out))
	const max = 2000
	if len(tail) > max {
		tail = "…" + tail[len(tail)-max:]
	}
	if tail == "" {
		return fmt.Errorf("%s failed: %w", what, err)
	}
	return fmt.Errorf("%s failed: %w: %s", what, err, tail)
}
