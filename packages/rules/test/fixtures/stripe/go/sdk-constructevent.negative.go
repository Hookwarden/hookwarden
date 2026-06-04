// framework: net-http-go
// rule: stripe/library-verified
// expected: verified
package webhooks

import (
	"io"
	"net/http"

	"github.com/stripe/stripe-go/v76/webhook"
)

// StripeWebhook verifies via the Stripe Go SDK — the SDK enforces HMAC + timestamp + constant-time.
func StripeWebhook(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	sig := r.Header.Get("Stripe-Signature")
	event, err := webhook.ConstructEvent(body, sig, "whsec_test_secret")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	_ = event
	w.WriteHeader(http.StatusOK)
}
