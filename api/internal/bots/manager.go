// Package bots starts match bots for the Studio local match path using official
// SDK process contracts (BOT_TEAM / BOT_NUMBER / BOT_GRPC_URL).
package bots

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"

	"studio-v3/api/internal/procreg"
)

const defaultOpponentBinary = "/usr/local/lib/lugo/bot-level-1"

// Slot identifies one bot process by team side and shirt number.
type Slot struct {
	Side   string // HOME or AWAY
	Number int    // 1..11
}

// Starter starts the bots listed in an explicit active set for a local match.
type Starter interface {
	StartMatch(cfg Config, active []Slot) error
}

// Config describes how to launch player and opponent bots for one match.
type Config struct {
	ProjectRoot    string
	GRPCURL        string
	PlayerSide     string // HOME or AWAY; default HOME
	OpponentMode   string // default "default"
	OpponentBinary string
	CacheDir       string
}

type botHandle struct {
	id    procreg.ID
	entry procreg.Entry
}

// Manager prepares the player project once and starts only the requested bot
// slots, registering each OS process with the process registry.
type Manager struct {
	Registry *procreg.Registry

	// Optional test hooks. When nil, real shell/process helpers are used.
	RunSync      func(dir, command string, env map[string]string) error
	StartProcess func(dir, command string, env map[string]string) (*procreg.Child, error)

	mu   sync.Mutex
	bots []botHandle
}

// New returns a Manager that registers bot children on reg.
func New(reg *procreg.Registry) *Manager {
	if reg == nil {
		panic("bots: New(nil registry)")
	}
	return &Manager{Registry: reg}
}

// OpponentBinaryFromEnv reads LUGO_STUDIO_OPPONENT_BOT (default
// /usr/local/lib/lugo/bot-level-1).
func OpponentBinaryFromEnv() string {
	if v := os.Getenv("LUGO_STUDIO_OPPONENT_BOT"); v != "" {
		return v
	}
	return defaultOpponentBinary
}

// AllSlots returns HOME and AWAY numbers 1..11 (22 slots). Used by callers that
// still start a full roster until the game-start payload carries an active set.
func AllSlots() []Slot {
	out := make([]Slot, 0, playersPerSide*2)
	for _, side := range []string{SideHome, SideAway} {
		for n := 1; n <= playersPerSide; n++ {
			out = append(out, Slot{Side: side, Number: n})
		}
	}
	return out
}

// StartMatch prepares the player project (when needed) and launches only the
// listed slots. Slots on PlayerSide use the project bots; other slots use the
// opponent binary. An empty active set is allowed (stops prior bots, starts none).
// A second call stops previously started bots first.
func (m *Manager) StartMatch(cfg Config, active []Slot) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if cfg.ProjectRoot == "" {
		return fmt.Errorf("project root is required")
	}
	if cfg.GRPCURL == "" {
		return fmt.Errorf("grpc url is required")
	}
	if cfg.PlayerSide == "" {
		cfg.PlayerSide = SideHome
	}
	if cfg.PlayerSide != SideHome && cfg.PlayerSide != SideAway {
		return fmt.Errorf("invalid player side %q", cfg.PlayerSide)
	}
	if cfg.OpponentMode == "" {
		cfg.OpponentMode = defaultOpponentMode
	}
	if cfg.OpponentBinary == "" {
		cfg.OpponentBinary = OpponentBinaryFromEnv()
	}
	if cfg.CacheDir == "" {
		cfg.CacheDir = filepath.Join(cfg.ProjectRoot, ".cache")
	}

	for _, slot := range active {
		if slot.Side != SideHome && slot.Side != SideAway {
			return fmt.Errorf("invalid bot side %q", slot.Side)
		}
		if slot.Number < 1 || slot.Number > playersPerSide {
			return fmt.Errorf("invalid bot number %d", slot.Number)
		}
	}

	m.stopBotsLocked()

	if len(active) == 0 {
		return nil
	}

	needPlayer := false
	needOpponent := false
	for _, slot := range active {
		if slot.Side == cfg.PlayerSide {
			needPlayer = true
		} else {
			needOpponent = true
		}
	}

	var lang Language
	if needPlayer {
		lang = DetectLanguage(cfg.ProjectRoot)
		if lang == LangUnknown {
			return fmt.Errorf("could not detect project language in %s (need go.mod, requirements.txt, or package.json)", cfg.ProjectRoot)
		}
		if err := os.MkdirAll(cfg.CacheDir, 0o755); err != nil {
			return fmt.Errorf("create cache dir: %w", err)
		}
		if err := m.preparePlayer(lang, cfg); err != nil {
			return fmt.Errorf("prepare player bots: %w", err)
		}
	}
	if needOpponent {
		if err := ensureOpponentBinary(cfg.OpponentBinary); err != nil {
			return err
		}
	}

	for _, slot := range active {
		if slot.Side == cfg.PlayerSide {
			if err := m.startPlayer(lang, cfg, slot.Side, slot.Number); err != nil {
				m.stopBotsLocked()
				return fmt.Errorf("start player bot %s/%d: %w", slot.Side, slot.Number, err)
			}
			continue
		}
		if err := m.startOpponent(cfg, slot.Side, slot.Number); err != nil {
			m.stopBotsLocked()
			return fmt.Errorf("start opponent bot %s/%d: %w", slot.Side, slot.Number, err)
		}
	}
	return nil
}

func (m *Manager) preparePlayer(lang Language, cfg Config) error {
	run := m.runSyncFn()
	switch lang {
	case LangGo:
		cmd, env := goPrepareCommand(cfg.ProjectRoot, cfg.CacheDir)
		return run(cfg.ProjectRoot, cmd, env)
	case LangPython:
		for _, cmd := range pythonPrepareCommands(cfg.ProjectRoot) {
			if err := run(cfg.ProjectRoot, cmd, nil); err != nil {
				return err
			}
		}
		return nil
	case LangTypeScript:
		for _, cmd := range jsPrepareCommands() {
			if err := run(cfg.ProjectRoot, cmd, nil); err != nil {
				return err
			}
		}
		return nil
	default:
		return fmt.Errorf("unsupported language %q", lang)
	}
}

func (m *Manager) startPlayer(lang Language, cfg Config, side string, number int) error {
	var command string
	switch lang {
	case LangGo:
		command = goStartCommand(cfg.CacheDir)
	case LangPython:
		command = pythonStartCommand(cfg.ProjectRoot)
	case LangTypeScript:
		command = jsStartCommand()
	default:
		return fmt.Errorf("unsupported language %q", lang)
	}
	return m.launch(cfg.ProjectRoot, command, botEnv(side, number, cfg.GRPCURL, ""))
}

func (m *Manager) startOpponent(cfg Config, side string, number int) error {
	command := shellQuote(cfg.OpponentBinary)
	return m.launch("", command, botEnv(side, number, cfg.GRPCURL, cfg.OpponentMode))
}

func (m *Manager) launch(dir, command string, env map[string]string) error {
	child, err := m.startProcessFn()(dir, command, env)
	if err != nil {
		return err
	}
	id := m.Registry.Register(child)
	m.bots = append(m.bots, botHandle{id: id, entry: child})
	return nil
}

func (m *Manager) stopBotsLocked() {
	for _, b := range m.bots {
		m.Registry.Unregister(b.id)
		_ = b.entry.Shutdown()
	}
	m.bots = nil
}

func (m *Manager) runSyncFn() func(dir, command string, env map[string]string) error {
	if m.RunSync != nil {
		return m.RunSync
	}
	return func(dir, command string, env map[string]string) error {
		cmd := exec.Command("sh", "-c", command)
		cmd.Dir = dir
		cmd.Env = mergeEnv(env)
		out, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("%w: %s", err, truncate(string(out), 2048))
		}
		return nil
	}
}

func (m *Manager) startProcessFn() func(dir, command string, env map[string]string) (*procreg.Child, error) {
	if m.StartProcess != nil {
		return m.StartProcess
	}
	return procreg.StartShell
}

func ensureOpponentBinary(path string) error {
	st, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("opponent bot binary %s: %w", path, err)
	}
	if st.IsDir() {
		return fmt.Errorf("opponent bot binary %s is a directory", path)
	}
	return nil
}

func mergeEnv(extra map[string]string) []string {
	env := os.Environ()
	for k, v := range extra {
		env = append(env, k+"="+v)
	}
	return env
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
