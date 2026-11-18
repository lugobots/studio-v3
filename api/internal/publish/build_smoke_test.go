package publish

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// Builds fixtures that mirror the Go / Python / JS template layouts
// (language manifest at the root, Dockerfile under .lugo/) with the exact
// docker args used by Publish. Skipped when no Docker engine is reachable.
func TestDockerBuildSmokeAllLanguages(t *testing.T) {
	if _, err := exec.LookPath("docker"); err != nil {
		t.Skip("docker CLI not found")
	}
	if err := exec.Command("docker", "info").Run(); err != nil {
		t.Skip("docker engine not reachable")
	}

	for lang, manifest := range map[string]string{
		"go": "go.mod", "python": "requirements.txt", "javascript": "package.json",
	} {
		t.Run(lang, func(t *testing.T) {
			project := t.TempDir()
			// Context-root COPY proves the build context is the project root,
			// not .lugo/. FROM scratch avoids any registry pull.
			files := map[string]string{
				manifest:           "fixture\n",
				".lugo/Dockerfile": "FROM scratch\nCOPY " + manifest + " /app/" + manifest + "\n",
			}
			for rel, content := range files {
				path := filepath.Join(project, filepath.FromSlash(rel))
				if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
					t.Fatal(err)
				}
			}

			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			image := "lugo-publish-smoke/" + lang + ":test"
			out, err := ExecRunner{}.Run(ctx, project, "", "docker", BuildArgs(image)...)
			if err != nil {
				t.Fatalf("docker build failed: %v\n%s", err, out)
			}
			t.Cleanup(func() { _ = exec.Command("docker", "rmi", "-f", image).Run() })
		})
	}
}
