// framework: chi
// rule: stripe/timing-unsafe-comparison
// expected: manual-review
package webhooks

import (
	"crypto/hmac"
	"crypto/sha256"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func Register(r chi.Router) {
	r.Post("/webhooks/stripe", stripeChiHandler)
}

func stripeChiHandler(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	sig := []byte(r.Header.Get("Stripe-Signature"))
	mac := hmac.New(sha256.New, []byte("whsec_test_secret"))
	mac.Write(body)
	if !hmac.Equal(mac.Sum(nil), sig) {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	w.WriteHeader(http.StatusOK)
}
