package projectfs

import (
	"os"
	"os/exec"
	"path/filepath"
)

// CoderUID/GID match the VS Code helper image user (`coder`).
const (
	CoderUID = 1000
	CoderGID = 1000
)

// ChownToCoder recursively makes root owned by uid/gid 1000 so the editor
// container can write the mounted project. Best-effort: returns nil when root
// is missing; ignores chown failures on hosts that cannot remap ownership.
func ChownToCoder(root string) error {
	if root == "" {
		return nil
	}
	info, err := os.Stat(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if !info.IsDir() {
		return os.Chown(root, CoderUID, CoderGID)
	}
	if path, lookErr := exec.LookPath("chown"); lookErr == nil {
		cmd := exec.Command(path, "-R", "1000:1000", root)
		_ = cmd.Run()
		return nil
	}
	return filepath.Walk(root, func(path string, _ os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		_ = os.Chown(path, CoderUID, CoderGID)
		return nil
	})
}
