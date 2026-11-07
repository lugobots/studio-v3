// Package bots starts match bots for the Studio local match path using official
// SDK process contracts (BOT_TEAM / BOT_NUMBER / BOT_GRPC_URL).
package bots

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"studio-v3/api/internal/procreg"
)

// LogSink receives armed process-log lines (implemented by the Studio API hub).
type LogSink interface {
	Armed(source string) bool
	Append(source, text string)
}

// defaultOpponentBinary is the in-container mount path where the Electron host
// bind-mounts the extracted Level-1 binary. The API image does not ship this file;
// LUGO_STUDIO_OPPONENT_BOT overrides the path when needed.
const defaultOpponentBinary = "/usr/local/lib/lugo/bot-level-1"

// Slot identifies one bot process by team side and shirt number.
type Slot struct {
	Side   string // HOME or AWAY
	Number int    // 1..11
}

// Starter starts the bots listed in an explicit active set for a local match
// and supports per-bot start/stop afterward.
type Starter interface {
	StartMatch(cfg Config, active []Slot) error
	StartBot(cfg Config, slot Slot) error
	StopBot(slot Slot) error
	BotRunning(slot Slot) bool
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
	child *procreg.Child
}

// Manager prepares the player project once and starts only the requested bot
// slots, registering each OS process with the process registry.
type Manager struct {
	Registry *procreg.Registry
	// Logs, when set, captures stdout/stderr for slots whose hub source is armed
	// at process start (home/N or away/N). Mid-run arming applies on next start.
	Logs LogSink

	// Optional test hooks. When nil, real shell/process helpers are used.
	RunSync      func(dir, command string, env map[string]string) error
	StartProcess func(dir, command string, env map[string]string) (*procreg.Child, error)

	mu   sync.Mutex
	bots map[string]botHandle
}

// New returns a Manager that registers bot children on reg.
func New(reg *procreg.Registry) *Manager {
	if reg == nil {
		panic("bots: New(nil registry)")
	}
	return &Manager{Registry: reg, bots: make(map[string]botHandle)}
}

// OpponentBinaryFromEnv reads LUGO_STUDIO_OPPONENT_BOT, falling back to the
// host-mounted Level-1 path (defaultOpponentBinary). Callers must not assume
// an image-baked binary exists at that path.
func OpponentBinaryFromEnv() string {
	if v := os.Getenv("LUGO_STUDIO_OPPONENT_BOT"); v != "" {
		return v
	}
	return defaultOpponentBinary
}

// AllSlots returns HOME and AWAY numbers 1..11 (22 slots). Handy for tests and
// callers that intentionally start a full roster.
func AllSlots() []Slot {
	out := make([]Slot, 0, playersPerSide*2)
	for _, side := range []string{SideHome, SideAway} {
		for n := 1; n <= playersPerSide; n++ {
			out = append(out, Slot{Side: side, Number: n})
		}
	}
	return out
}

func slotKey(s Slot) string {
	return fmt.Sprintf("%s/%d", s.Side, s.Number)
}

// slotLogSource maps a manager slot (HOME/3) to the process-log hub tag (home/3).
func slotLogSource(s Slot) string {
	return fmt.Sprintf("%s/%d", strings.ToLower(s.Side), s.Number)
}

// StartMatch prepares the player project (when needed) and launches only the
// listed slots. Slots on PlayerSide use the project bots; other slots use the
// opponent binary. An empty active set is allowed (stops prior bots, starts none).
// A second call stops previously started bots first.
func (m *Manager) StartMatch(cfg Config, active []Slot) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	cfg, err := normalizeConfig(cfg)
	if err != nil {
		return err
	}
	for _, slot := range active {
		if err := validateSlot(slot); err != nil {
			return err
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
		if err := m.startSlotLocked(lang, cfg, slot); err != nil {
			m.stopBotsLocked()
			return err
		}
	}
	return nil
}

// StartBot starts a single slot (player project or opponent by team side) and
// registers it with procreg. Idempotent when the slot is already running.
func (m *Manager) StartBot(cfg Config, slot Slot) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	cfg, err := normalizeConfig(cfg)
	if err != nil {
		return err
	}
	if err := validateSlot(slot); err != nil {
		return err
	}
	if m.botRunningLocked(slot) {
		return nil
	}
	m.clearSlotLocked(slot)

	var lang Language
	if slot.Side == cfg.PlayerSide {
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
	} else {
		if err := ensureOpponentBinary(cfg.OpponentBinary); err != nil {
			return err
		}
	}
	return m.startSlotLocked(lang, cfg, slot)
}

// StopBot stops a single slot and unregisters it from procreg. No-op when the
// slot is not running.
func (m *Manager) StopBot(slot Slot) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := validateSlot(slot); err != nil {
		return err
	}
	m.clearSlotLocked(slot)
	return nil
}

// BotRunning reports whether a managed process for the slot is alive.
func (m *Manager) BotRunning(slot Slot) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.botRunningLocked(slot)
}

func (m *Manager) startSlotLocked(lang Language, cfg Config, slot Slot) error {
	if slot.Side == cfg.PlayerSide {
		if err := m.startPlayer(lang, cfg, slot); err != nil {
			return fmt.Errorf("start player bot %s/%d: %w", slot.Side, slot.Number, err)
		}
		return nil
	}
	if err := m.startOpponent(cfg, slot); err != nil {
		return fmt.Errorf("start opponent bot %s/%d: %w", slot.Side, slot.Number, err)
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

func (m *Manager) startPlayer(lang Language, cfg Config, slot Slot) error {
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
	return m.launch(slot, cfg.ProjectRoot, command, botEnv(slot.Side, slot.Number, cfg.GRPCURL, ""))
}

func (m *Manager) startOpponent(cfg Config, slot Slot) error {
	command := shellQuote(cfg.OpponentBinary)
	return m.launch(slot, "", command, botEnv(slot.Side, slot.Number, cfg.GRPCURL, cfg.OpponentMode))
}

func (m *Manager) launch(slot Slot, dir, command string, env map[string]string) error {
	child, err := m.startSlotProcess(slot, dir, command, env)
	if err != nil {
		return err
	}
	id := m.Registry.Register(child)
	if m.bots == nil {
		m.bots = make(map[string]botHandle)
	}
	m.bots[slotKey(slot)] = botHandle{id: id, child: child}
	return nil
}

func (m *Manager) startSlotProcess(slot Slot, dir, command string, env map[string]string) (*procreg.Child, error) {
	tag := slotLogSource(slot)
	if m.Logs != nil && m.Logs.Armed(tag) {
		// Capture path for the UI hub. Custom StartProcess hooks skip pipes
		// (tests that override StartProcess are not exercising capture).
		if m.StartProcess == nil {
			return procreg.StartShellCapture(dir, command, env, func(line string) {
				m.Logs.Append(tag, line)
			})
		}
	}
	return m.startProcessFn()(dir, command, env)
}

func (m *Manager) stopBotsLocked() {
	for key, b := range m.bots {
		m.Registry.Unregister(b.id)
		_ = b.child.Shutdown()
		delete(m.bots, key)
	}
}

func (m *Manager) clearSlotLocked(slot Slot) {
	key := slotKey(slot)
	b, ok := m.bots[key]
	if !ok {
		return
	}
	m.Registry.Unregister(b.id)
	_ = b.child.Shutdown()
	delete(m.bots, key)
}

func (m *Manager) botRunningLocked(slot Slot) bool {
	b, ok := m.bots[slotKey(slot)]
	if !ok {
		return false
	}
	if b.child.Alive() {
		return true
	}
	m.Registry.Unregister(b.id)
	delete(m.bots, slotKey(slot))
	return false
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

func normalizeConfig(cfg Config) (Config, error) {
	if cfg.ProjectRoot == "" {
		return cfg, fmt.Errorf("project root is required")
	}
	if cfg.GRPCURL == "" {
		return cfg, fmt.Errorf("grpc url is required")
	}
	if cfg.PlayerSide == "" {
		cfg.PlayerSide = SideHome
	}
	if cfg.PlayerSide != SideHome && cfg.PlayerSide != SideAway {
		return cfg, fmt.Errorf("invalid player side %q", cfg.PlayerSide)
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
	return cfg, nil
}

func validateSlot(slot Slot) error {
	if slot.Side != SideHome && slot.Side != SideAway {
		return fmt.Errorf("invalid bot side %q", slot.Side)
	}
	if slot.Number < 1 || slot.Number > playersPerSide {
		return fmt.Errorf("invalid bot number %d", slot.Number)
	}
	return nil
}

// ensureOpponentBinary verifies the configured/mounted opponent executable
// exists before launch. A missing path returns a clear error so match start
// does not fail later with an opaque exec error.
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
