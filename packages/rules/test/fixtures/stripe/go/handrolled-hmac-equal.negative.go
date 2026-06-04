// framework: net-http-go
// rule: stripe/timing-unsafe-comparison
// expected: manual-review
package webhooks

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
)

// Constant-time hand-rolled verification — hmac.Equal is the safe compare. No SDK → manual-review.
func StripeHandRolled(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	sig := r.Header.Get("Stripe-Signature")
	mac := hmac.New(sha256.New, []byte("whsec_test_secret"))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(sig)) {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	w.WriteHeader(http.StatusOK)
}
