package procreg

import (
	"errors"
	"os"
	"os/exec"
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

func mergeEnv(extra map[string]string) []string {
	env := os.Environ()
	for k, v := range extra {
		env = append(env, k+"="+v)
	}
	return env
}
