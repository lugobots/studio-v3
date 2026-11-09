package bottemplate

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Installer copies a published language template into a project directory.
type Installer interface {
	Install(language, destDir string) error
}

// RepoForLanguage maps API language values to published dummy repo names.
func RepoForLanguage(language string) (string, bool) {
	switch language {
	case "python":
		return "the-dummies-py", true
	case "go":
		return "the-dummies-go", true
	case "typescript":
		return "the-dummies-js", true
	default:
		return "", false
	}
}

// GitHubInstaller fetches the latest tagged dummy template from GitHub.
type GitHubInstaller struct {
	HTTPClient *http.Client
	BaseAPI    string // e.g. https://api.github.com
	BaseCode   string // e.g. https://codeload.github.com
}

// DefaultInstaller returns the production GitHub-backed installer.
func DefaultInstaller() Installer {
	return &GitHubInstaller{}
}

func (g *GitHubInstaller) client() *http.Client {
	if g != nil && g.HTTPClient != nil {
		return g.HTTPClient
	}
	return http.DefaultClient
}

func (g *GitHubInstaller) apiBase() string {
	if g != nil && g.BaseAPI != "" {
		return strings.TrimRight(g.BaseAPI, "/")
	}
	return "https://api.github.com"
}

func (g *GitHubInstaller) codeBase() string {
	if g != nil && g.BaseCode != "" {
		return strings.TrimRight(g.BaseCode, "/")
	}
	return "https://codeload.github.com"
}

// Install downloads the latest tag of the language's dummy template and copies it into destDir.
func (g *GitHubInstaller) Install(language, destDir string) error {
	repo, ok := RepoForLanguage(language)
	if !ok {
		return fmt.Errorf("unsupported language %q", language)
	}
	version, err := g.latestTag(repo)
	if err != nil {
		return err
	}
	return g.copyTag(repo, version, destDir)
}

func (g *GitHubInstaller) latestTag(repo string) (string, error) {
	url := fmt.Sprintf("%s/repos/lugobots/%s/tags?per_page=100", g.apiBase(), repo)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	res, err := g.client().Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return "", fmt.Errorf("list tags for %s: HTTP %d: %s", repo, res.StatusCode, strings.TrimSpace(string(body)))
	}
	var tags []struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(res.Body).Decode(&tags); err != nil {
		return "", err
	}
	names := make([]string, 0, len(tags))
	for _, tag := range tags {
		if tag.Name != "" {
			names = append(names, tag.Name)
		}
	}
	if len(names) == 0 {
		return "", fmt.Errorf("no tags found for lugobots/%s", repo)
	}
	sort.Slice(names, func(i, j int) bool {
		return semverLess(names[i], names[j])
	})
	return names[len(names)-1], nil
}

func (g *GitHubInstaller) copyTag(repo, version, destDir string) error {
	url := fmt.Sprintf("%s/lugobots/%s/tar.gz/%s", g.codeBase(), repo, version)
	res, err := g.client().Get(url)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return fmt.Errorf("download %s@%s: HTTP %d: %s", repo, version, res.StatusCode, strings.TrimSpace(string(body)))
	}
	gz, err := gzip.NewReader(res.Body)
	if err != nil {
		return err
	}
	defer gz.Close()
	return extractTarPrefix(tar.NewReader(gz), destDir)
}

// extractTarPrefix strips the single top-level directory from a GitHub archive and writes into destDir.
func extractTarPrefix(tr *tar.Reader, destDir string) error {
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return err
	}
	var prefix string
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		name := filepath.ToSlash(hdr.Name)
		if name == "" || name == "." {
			continue
		}
		parts := strings.SplitN(name, "/", 2)
		if len(parts) < 2 {
			// top-level directory entry only
			continue
		}
		if prefix == "" {
			prefix = parts[0] + "/"
		}
		rel := parts[1]
		if rel == "" {
			continue
		}
		target := filepath.Join(destDir, filepath.FromSlash(rel))
		if !isWithin(destDir, target) {
			return fmt.Errorf("refusing to write outside destination: %s", rel)
		}
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			mode := hdr.FileInfo().Mode().Perm()
			if mode == 0 {
				mode = 0o644
			}
			f, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
			if err != nil {
				return err
			}
			if _, err := io.Copy(f, tr); err != nil {
				f.Close()
				return err
			}
			if err := f.Close(); err != nil {
				return err
			}
		}
	}
}

func isWithin(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// semverLess compares simple dotted numeric versions (v-prefix optional). Non-numeric tails sort lower.
func semverLess(a, b string) bool {
	return compareSemver(a, b) < 0
}

func compareSemver(a, b string) int {
	ap := splitVersion(a)
	bp := splitVersion(b)
	n := len(ap)
	if len(bp) > n {
		n = len(bp)
	}
	for i := 0; i < n; i++ {
		var av, bv int
		if i < len(ap) {
			av = ap[i]
		}
		if i < len(bp) {
			bv = bp[i]
		}
		if av != bv {
			if av < bv {
				return -1
			}
			return 1
		}
	}
	return 0
}

func splitVersion(v string) []int {
	v = strings.TrimPrefix(v, "v")
	v = strings.TrimPrefix(v, "V")
	parts := strings.Split(v, ".")
	out := make([]int, 0, len(parts))
	for _, p := range parts {
		n := 0
		for _, r := range p {
			if r < '0' || r > '9' {
				break
			}
			n = n*10 + int(r-'0')
		}
		out = append(out, n)
	}
	return out
}

// FuncInstaller adapts a function to Installer (used by HTTP handler tests).
type FuncInstaller func(language, destDir string) error

func (f FuncInstaller) Install(language, destDir string) error {
	return f(language, destDir)
}

// DirInstaller copies from a local templates root containing one subdirectory per repo name.
type DirInstaller struct {
	Root string
}

func (d DirInstaller) Install(language, destDir string) error {
	repo, ok := RepoForLanguage(language)
	if !ok {
		return fmt.Errorf("unsupported language %q", language)
	}
	src := filepath.Join(d.Root, repo)
	return copyTree(src, destDir)
}

func copyTree(src, dest string) error {
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("template source is not a directory: %s", src)
	}
	return filepath.Walk(src, func(path string, fi os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dest, rel)
		if !isWithin(dest, target) && rel != "." {
			return fmt.Errorf("refusing to write outside destination: %s", rel)
		}
		if fi.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if !fi.Mode().IsRegular() {
			return nil
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		in, err := os.Open(path)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, fi.Mode().Perm())
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(out, in)
		closeErr := out.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	})
}
