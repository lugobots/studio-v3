package procreg

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"
)

const childStopTimeout = 2 * time.Second

// Child wraps an OS child process. When ProcessGroup is true, Shutdown signals
// the child's process group (negative PID) so grandchildren are included.
type Child struct {
	Cmd          *exec.Cmd
	ProcessGroup bool
}

// Alive reports whether the OS process appears to still be running.
// Zombies (exited but not yet reaped) are treated as not alive so bot status
// and restart paths do not get stuck on a dead PID.
func (c *Child) Alive() bool {
	if c == nil || c.Cmd == nil || c.Cmd.Process == nil {
		return false
	}
	if c.Cmd.ProcessState != nil {
		return false
	}
	pid := c.Cmd.Process.Pid
	if processZombie(pid) {
		return false
	}
	return syscall.Kill(pid, 0) == nil
}

// processZombie reports Linux /proc state 'Z' (zombie). Other platforms fall
// back to Kill-based liveness only.
func processZombie(pid int) bool {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return false
	}
	// /proc/<pid>/stat: pid (comm) state ...
	s := string(data)
	idx := strings.LastIndex(s, ") ")
	if idx < 0 || idx+2 >= len(s) {
		return false
	}
	return s[idx+2] == 'Z'
}

// Shutdown implements Entry. It sends SIGTERM (to the process group when
// ProcessGroup is set), waits briefly, then SIGKILL if still running.
func (c *Child) Shutdown() error {
	if c == nil || c.Cmd == nil || c.Cmd.Process == nil {
		return nil
	}

	// Ignore signal errors (process may already be exiting) and wait/reap next.
	_ = c.signal(syscall.SIGTERM)

	done := make(chan error, 1)
	go func() {
		done <- c.Cmd.Wait()
	}()

	select {
	case err := <-done:
		return ignoreExitError(err)
	case <-time.After(childStopTimeout):
		_ = c.signal(syscall.SIGKILL)
		select {
		case err := <-done:
			return ignoreExitError(err)
		case <-time.After(childStopTimeout):
			return errors.New("procreg: child did not exit after SIGKILL")
		}
	}
}

func ignoreExitError(err error) error {
	if err == nil {
		return nil
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return nil
	}
	return err
}

func (c *Child) signal(sig syscall.Signal) error {
	pid := c.Cmd.Process.Pid
	if c.ProcessGroup {
		return syscall.Kill(-pid, sig)
	}
	return c.Cmd.Process.Signal(sig)
}

// StartChild starts name with args in a new process group and returns a Child
// ready to register. The caller owns registration with the Registry.
func StartChild(name string, args ...string) (*Child, error) {
	return StartCmd(exec.Command(name, args...))
}

// StartShell runs command via `sh -c` in dir with extraEnv merged onto the
// current environment, in a new process group.
func StartShell(dir, command string, extraEnv map[string]string) (*Child, error) {
	cmd := exec.Command("sh", "-c", command)
	cmd.Dir = dir
	cmd.Env = mergeEnv(extraEnv)
	return StartCmd(cmd)
}

// StartShellCapture is StartShell with stdout/stderr line capture. onLine is
// called for each newline-delimited chunk from either stream. When onLine is
// nil, behavior matches StartShell (inherit container fds).
func StartShellCapture(dir, command string, extraEnv map[string]string, onLine func(string)) (*Child, error) {
	if onLine == nil {
		return StartShell(dir, command, extraEnv)
	}
	cmd := exec.Command("sh", "-c", command)
	cmd.Dir = dir
	cmd.Env = mergeEnv(extraEnv)
	return StartCmdCapture(cmd, onLine)
}

// StartCmd starts cmd in a new process group and returns a Child ready to
// register. The caller owns registration with the Registry.
func StartCmd(cmd *exec.Cmd) (*Child, error) {
	if cmd == nil {
		return nil, errors.New("procreg: StartCmd(nil)")
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return &Child{Cmd: cmd, ProcessGroup: true}, nil
}

// StartCmdCapture starts cmd like StartCmd but pipes stdout and stderr into
// onLine (one call per scanned line). Pipes are attached before Start.
func StartCmdCapture(cmd *exec.Cmd, onLine func(string)) (*Child, error) {
	if cmd == nil {
		return nil, errors.New("procreg: StartCmdCapture(nil)")
	}
	if onLine == nil {
		return StartCmd(cmd)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("procreg: stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("procreg: stderr pipe: %w", err)
	}
	child, err := StartCmd(cmd)
	if err != nil {
		return nil, err
	}
	go scanLines(stdout, onLine)
	go scanLines(stderr, onLine)
	return child, nil
}

func scanLines(r io.Reader, onLine func(string)) {
	scanner := bufio.NewScanner(r)
	// Bots can emit long JSON-ish lines; raise the default token limit a bit.
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		onLine(scanner.Text())
	}
}

func mergeEnv(extra map[string]string) []string {
	env := os.Environ()
	for k, v := range extra {
		env = append(env, k+"="+v)
	}
	return env
}
