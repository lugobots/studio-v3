package bots

import (
	"os"
	"path/filepath"
)

// Language identifies how the mounted player project is started.
type Language string

const (
	LangGo         Language = "go"
	LangPython     Language = "python"
	LangTypeScript Language = "typescript"
	LangUnknown    Language = ""
)

// DetectLanguage inspects projectRoot for go.mod, requirements.txt, or package.json.
func DetectLanguage(projectRoot string) Language {
	checks := []struct {
		file string
		lang Language
	}{
		{"go.mod", LangGo},
		{"requirements.txt", LangPython},
		{"package.json", LangTypeScript},
	}
	for _, c := range checks {
		if _, err := os.Stat(filepath.Join(projectRoot, c.file)); err == nil {
			return c.lang
		}
	}
	return LangUnknown
}
