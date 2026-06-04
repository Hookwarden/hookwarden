// framework: net-http-go
// rule: github/library-verified
// expected: verified
package webhooks

import (
	"net/http"

	gh "github.com/google/go-github/v62/github"
)

// Verifies via go-github's ValidatePayload (reads body + checks X-Hub-Signature-256 internally).
func GithubWebhook(w http.ResponseWriter, r *http.Request) {
	payload, err := gh.ValidatePayload(r, []byte("github_webhook_secret"))
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	_ = payload
	w.WriteHeader(http.StatusOK)
}
