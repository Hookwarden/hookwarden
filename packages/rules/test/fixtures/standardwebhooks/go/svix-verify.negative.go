// framework: net-http-go
// rule: standardwebhooks/library-verified
// expected: verified
package webhooks

import (
	"io"
	"net/http"

	svix "github.com/svix/svix-webhooks/go"
)

// Verifies via the Svix Go SDK (Standard Webhooks). wh.Verify reads webhook-id/timestamp/signature.
func SvixWebhook(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	wh, _ := svix.NewWebhook("whsec_svix_secret")
	if err := wh.Verify(body, r.Header); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusOK)
}
