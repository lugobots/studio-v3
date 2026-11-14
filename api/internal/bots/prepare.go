package bots

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const prepareStampName = "deps.stamp"

// ProjectPrepper prepares language dependencies for a mounted bot project.
type ProjectPrepper interface {
	PrepareProject(projectRoot string, onLog func(string)) error
}

// PrepareProject detects the project language and runs the same prepare work
// used before player bots start. onLog may be nil.
func (m *Manager) PrepareProject(projectRoot string, onLog func(string)) error {
	if projectRoot == "" {
		return fmt.Errorf("project root is required")
	}
	lang := DetectLanguage(projectRoot)
	if lang == LangUnknown {
		return fmt.Errorf("could not detect project language in %s (need go.mod, requirements.txt, or package.json)", projectRoot)
	}
	cacheDir := filepath.Join(projectRoot, ".cache")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return fmt.Errorf("create cache dir: %w", err)
	}
	log := onLog
	if log == nil {
		log = func(string) {}
	}
	if prepareAlreadyReady(lang, projectRoot, cacheDir) {
		log("Dependencies already prepared.")
		return nil
	}
	log(fmt.Sprintf("Preparing %s dependencies…", lang))
	cfg := Config{ProjectRoot: projectRoot, CacheDir: cacheDir, GRPCURL: "unused"}
	if err := m.preparePlayer(lang, cfg, log); err != nil {
		return err
	}
	log("Dependencies are ready.")
	return nil
}

func prepareStampPath(projectRoot string) string {
	return filepath.Join(projectRoot, ".studio", prepareStampName)
}

func manifestFingerprint(lang Language, projectRoot string) (string, error) {
	var parts []string
	switch lang {
	case LangPython:
		parts = []string{"requirements.txt"}
	case LangGo:
		parts = []string{"go.mod", "go.sum"}
	case LangTypeScript:
		parts = []string{"package.json", "package-lock.json", "npm-shrinkwrap.json"}
	default:
		return "", fmt.Errorf("unsupported language %q", lang)
	}
	h := sha256.New()
	_, _ = h.Write([]byte(string(lang)))
	for _, name := range parts {
		path := filepath.Join(projectRoot, name)
		data, err := os.ReadFile(path)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return "", err
		}
		_, _ = h.Write([]byte(name))
		_, _ = h.Write(data)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func writePrepareStamp(lang Language, projectRoot string) error {
	fp, err := manifestFingerprint(lang, projectRoot)
	if err != nil {
		return err
	}
	dir := filepath.Join(projectRoot, ".studio")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	body := string(lang) + "\n" + fp + "\n"
	return os.WriteFile(prepareStampPath(projectRoot), []byte(body), 0o644)
}

func readPrepareStamp(projectRoot string) (lang Language, fp string, ok bool) {
	data, err := os.ReadFile(prepareStampPath(projectRoot))
	if err != nil {
		return "", "", false
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) < 2 {
		return "", "", false
	}
	return Language(lines[0]), lines[1], true
}

func prepareArtifactsReady(lang Language, projectRoot, cacheDir string) bool {
	switch lang {
	case LangPython:
		return pythonVenvHealthy(projectRoot)
	case LangGo:
		st, err := os.Stat(goBinaryPath(cacheDir))
		return err == nil && !st.IsDir()
	case LangTypeScript:
		nodeModules := filepath.Join(projectRoot, "node_modules")
		dist := filepath.Join(projectRoot, ".dist")
		nm, errNM := os.Stat(nodeModules)
		d, errD := os.Stat(dist)
		return errNM == nil && nm.IsDir() && errD == nil && d.IsDir()
	default:
		return false
	}
}

func prepareAlreadyReady(lang Language, projectRoot, cacheDir string) bool {
	stampLang, stampFP, ok := readPrepareStamp(projectRoot)
	if !ok || stampLang != lang {
		return false
	}
	fp, err := manifestFingerprint(lang, projectRoot)
	if err != nil || fp != stampFP {
		return false
	}
	return prepareArtifactsReady(lang, projectRoot, cacheDir)
}
