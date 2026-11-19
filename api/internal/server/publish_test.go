package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"studio-v3/api/internal/publish"
)

type fakeCall struct {
	Dir   string
	Stdin string
	Name  string
	Args  []string
}

type fakeRunner struct {
	calls []fakeCall
	fail  map[string]error // keyed by first docker arg
}

func (f *fakeRunner) Run(ctx context.Context, dir, stdin, name string, args ...string) ([]byte, error) {
	f.calls = append(f.calls, fakeCall{Dir: dir, Stdin: stdin, Name: name, Args: args})
	if err := f.fail[args[0]]; err != nil {
		return []byte("boom: " + args[0]), err
	}
	return nil, nil
}

func publishMux(t *testing.T, project string, runner *fakeRunner, configDir string) http.Handler {
	t.Helper()
	t.Setenv("BOT_SOURCE_PATH", project)
	return NewMuxWith(Deps{Publish: &publish.Service{
		Runner:    runner,
		ConfigDir: func() string { return configDir },
	}})
}

func postForm(mux http.Handler, method, path string, form url.Values) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return body
}

func writeDockerfile(t *testing.T, project string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(project, ".lugo"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, ".lugo", "Dockerfile"), []byte("FROM scratch\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

// The same publish path must serve Go, Python, and JS projects: the project
// language only changes the manifest file, never the docker commands.
func TestPublishBuildsLugoDockerfileForAllLanguages(t *testing.T) {
	for lang, manifest := range map[string]string{
		"go": "go.mod", "python": "requirements.txt", "javascript": "package.json",
	} {
		t.Run(lang, func(t *testing.T) {
			project := t.TempDir()
			writeDockerfile(t, project)
			if err := os.WriteFile(filepath.Join(project, manifest), []byte("x"), 0o644); err != nil {
				t.Fatal(err)
			}
			runner := &fakeRunner{}
			mux := publishMux(t, project, runner, t.TempDir())

			rec := postForm(mux, http.MethodPost, "/api/bot/publish",
				url.Values{"bot_uri": {"acme/my-bot"}, "tag": {"v1"}})
			if rec.Code != http.StatusOK {
				t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
			}
			body := decode(t, rec)
			if _, ok := body["implemented"]; ok {
				t.Fatalf("must not include implemented: %#v", body)
			}
			if body["status"] != "OK" || body["image"] != "repo.lugobots.ai/acme/my-bot:v1" {
				t.Fatalf("body = %#v", body)
			}
			if len(runner.calls) != 2 {
				t.Fatalf("calls = %#v", runner.calls)
			}
			build, push := runner.calls[0], runner.calls[1]
			wantBuild := []string{"build", "-f", ".lugo/Dockerfile", "-t", "repo.lugobots.ai/acme/my-bot:v1", "."}
			if build.Name != "docker" || strings.Join(build.Args, " ") != strings.Join(wantBuild, " ") {
				t.Fatalf("build = %#v", build)
			}
			if build.Dir != project {
				t.Fatalf("build dir = %q, want project root %q", build.Dir, project)
			}
			if push.Name != "docker" || strings.Join(push.Args, " ") != "push repo.lugobots.ai/acme/my-bot:v1" {
				t.Fatalf("push = %#v", push)
			}
		})
	}
}

func TestPublishAcceptsCamelCaseBotURI(t *testing.T) {
	project := t.TempDir()
	writeDockerfile(t, project)
	runner := &fakeRunner{}
	mux := publishMux(t, project, runner, t.TempDir())

	rec := postForm(mux, http.MethodPost, "/api/bot/publish",
		url.Values{"botUri": {"repo.lugobots.ai/acme/bot"}, "tag": {"latest"}})
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if got := decode(t, rec)["image"]; got != "repo.lugobots.ai/acme/bot:latest" {
		t.Fatalf("image = %#v", got)
	}
}

func TestPublishWithOTPCredentialsSkipsDockerLogin(t *testing.T) {
	project := t.TempDir()
	writeDockerfile(t, project)
	cfg := t.TempDir()
	runner := &fakeRunner{}
	mux := publishMux(t, project, runner, cfg)

	rec := postForm(mux, http.MethodPost, "/api/bot/publish", url.Values{
		"bot_uri":  {"acme/bot"},
		"tag":      {"v9"},
		"username": {"ada@example.com"},
		"password": {"otp-plain"},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if len(runner.calls) != 2 {
		t.Fatalf("calls = %#v, want build+push only", runner.calls)
	}
	for _, c := range runner.calls {
		joined := strings.Join(c.Args, " ")
		if strings.Contains(joined, "login") {
			t.Fatalf("OTP publish must not docker login: %#v", runner.calls)
		}
	}
	auth := base64.StdEncoding.EncodeToString([]byte("ada@example.com:otp-plain"))
	raw, err := os.ReadFile(filepath.Join(cfg, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), auth) {
		t.Fatalf("config missing auth entry: %s", raw)
	}
	if strings.Contains(rec.Body.String(), "otp-plain") {
		t.Fatalf("password leaked into response: %s", rec.Body.String())
	}
}

func TestPublishMissingDockerfileIsError(t *testing.T) {
	project := t.TempDir()
	runner := &fakeRunner{}
	mux := publishMux(t, project, runner, t.TempDir())

	rec := postForm(mux, http.MethodPost, "/api/bot/publish",
		url.Values{"bot_uri": {"acme/bot"}, "tag": {"v1"}})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	body := decode(t, rec)
	if msg, _ := body["error"].(string); !strings.Contains(msg, ".lugo/Dockerfile") {
		t.Fatalf("error = %#v", body)
	}
	if _, ok := body["status"]; ok {
		t.Fatalf("must not claim success: %#v", body)
	}
	if _, ok := body["implemented"]; ok {
		t.Fatalf("must not include implemented: %#v", body)
	}
	if len(runner.calls) != 0 {
		t.Fatalf("docker must not run: %#v", runner.calls)
	}
}

func TestPublishRejectsInvalidInput(t *testing.T) {
	project := t.TempDir()
	writeDockerfile(t, project)
	for name, form := range map[string]url.Values{
		"missing uri": {"tag": {"v1"}},
		"missing tag": {"bot_uri": {"acme/bot"}},
		"bad uri":     {"bot_uri": {"Acme/Bot; rm -rf"}, "tag": {"v1"}},
		"bad tag":     {"bot_uri": {"acme/bot"}, "tag": {"-x y"}},
	} {
		t.Run(name, func(t *testing.T) {
			runner := &fakeRunner{}
			mux := publishMux(t, project, runner, t.TempDir())
			rec := postForm(mux, http.MethodPost, "/api/bot/publish", form)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
			}
			if len(runner.calls) != 0 {
				t.Fatalf("docker must not run: %#v", runner.calls)
			}
		})
	}
}

func TestPublishBuildOrPushFailureIsError(t *testing.T) {
	for _, step := range []string{"build", "push"} {
		t.Run(step, func(t *testing.T) {
			project := t.TempDir()
			writeDockerfile(t, project)
			runner := &fakeRunner{fail: map[string]error{step: errors.New("exit status 1")}}
			mux := publishMux(t, project, runner, t.TempDir())

			rec := postForm(mux, http.MethodPost, "/api/bot/publish",
				url.Values{"bot_uri": {"acme/bot"}, "tag": {"v1"}})
			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
			}
			body := decode(t, rec)
			if msg, _ := body["error"].(string); !strings.Contains(msg, "docker "+step) {
				t.Fatalf("error = %#v", body)
			}
			if _, ok := body["status"]; ok {
				t.Fatalf("must not claim success: %#v", body)
			}
			if step == "build" && len(runner.calls) != 1 {
				t.Fatalf("push must not run after failed build: %#v", runner.calls)
			}
		})
	}
}

func TestRegistryAuthCheckLoginLogout(t *testing.T) {
	cfg := t.TempDir()
	runner := &fakeRunner{}
	mux := publishMux(t, t.TempDir(), runner, cfg)

	check := func() map[string]any {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/bot/auth", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("check status %d body %s", rec.Code, rec.Body.String())
		}
		return decode(t, rec)
	}

	if got := check(); got["logged_in"] != false || got["registry"] != "repo.lugobots.ai" {
		t.Fatalf("initial check = %#v", got)
	}

	rec := postForm(mux, http.MethodPost, "/api/bot/auth",
		url.Values{"username": {"ada"}, "password": {"s3cret"}})
	if rec.Code != http.StatusOK {
		t.Fatalf("login status %d body %s", rec.Code, rec.Body.String())
	}
	login := runner.calls[0]
	if login.Name != "docker" || strings.Join(login.Args, " ") !=
		"login repo.lugobots.ai --username ada --password-stdin" {
		t.Fatalf("login = %#v", login)
	}
	if strings.TrimSpace(login.Stdin) != "s3cret" {
		t.Fatalf("password must be passed on stdin, got %q", login.Stdin)
	}
	for _, arg := range login.Args {
		if strings.Contains(arg, "s3cret") {
			t.Fatalf("password leaked into args: %#v", login.Args)
		}
	}
	if strings.Contains(rec.Body.String(), "s3cret") {
		t.Fatalf("password leaked into response: %s", rec.Body.String())
	}

	// docker login would write this; simulate it.
	auth := base64.StdEncoding.EncodeToString([]byte("ada:s3cret"))
	cfgJSON := `{"auths":{"repo.lugobots.ai":{"auth":"` + auth + `"}}}`
	if err := os.WriteFile(filepath.Join(cfg, "config.json"), []byte(cfgJSON), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := check(); got["logged_in"] != true || got["username"] != "ada" {
		t.Fatalf("check after login = %#v", got)
	}

	if err := os.WriteFile(filepath.Join(cfg, "config.json"), []byte(`{"auths":{}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/bot/auth", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("logout status %d body %s", rec.Code, rec.Body.String())
	}
	last := runner.calls[len(runner.calls)-1]
	if strings.Join(last.Args, " ") != "logout repo.lugobots.ai" {
		t.Fatalf("logout = %#v", last)
	}
	if got := check(); got["logged_in"] != false {
		t.Fatalf("check after logout = %#v", got)
	}
}

func TestRegistryLoginFailureAndValidation(t *testing.T) {
	runner := &fakeRunner{fail: map[string]error{"login": errors.New("exit status 1")}}
	mux := publishMux(t, t.TempDir(), runner, t.TempDir())

	rec := postForm(mux, http.MethodPost, "/api/bot/auth",
		url.Values{"username": {"ada"}, "password": {"wrong"}})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	rec = postForm(mux, http.MethodPost, "/api/bot/auth", url.Values{"username": {"ada"}})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}

// Studio V3 publish must stay independent from the Studio V2 publisher.
func TestPublishDoesNotImportStudioV2(t *testing.T) {
	for _, dir := range []string{".", filepath.Join("..", "publish")} {
		files, err := filepath.Glob(filepath.Join(dir, "*.go"))
		if err != nil {
			t.Fatal(err)
		}
		for _, file := range files {
			parsed, err := parser.ParseFile(token.NewFileSet(), file, nil, parser.ImportsOnly)
			if err != nil {
				t.Fatal(err)
			}
			for _, imp := range parsed.Imports {
				path := strings.ToLower(imp.Path.Value)
				if strings.Contains(path, "studio-v2") || strings.Contains(path, "studiov2") || strings.Contains(path, "publisher") {
					t.Fatalf("%s imports %s", file, imp.Path.Value)
				}
			}
		}
	}
}
