// framework: net-http-go
// rule: stripe/timing-unsafe-comparison
// expected: not-verified
package webhooks

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"io"
	"net/http"
)

// BUG: bytes.Equal is NOT constant-time (CWE-208). Should flag critical not-verified.
func StripeBroken(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	sig := []byte(r.Header.Get("Stripe-Signature"))
	mac := hmac.New(sha256.New, []byte("whsec_test_secret"))
	mac.Write(body)
	if bytes.Equal(mac.Sum(nil), sig) {
		w.WriteHeader(http.StatusOK)
	}
}
