// Go net/http bug: manual HMAC compared with bytes.Equal — NOT constant-time.
// Equivalent to the JS/Python/PHP "manual HMAC with non-constant-time compare" fixtures.
// Proves the tree-sitter-go WASM loader resolves the embedded asset in a compiled-Bun binary.
package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"io"
	"net/http"
	"os"
)

func StripeWebhook(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	sig := []byte(r.Header.Get("Stripe-Signature"))
	mac := hmac.New(sha256.New, []byte(os.Getenv("STRIPE_WEBHOOK_SECRET")))
	mac.Write(body)
	expected := mac.Sum(nil)
	// THE BUG: bytes.Equal is not constant-time. Use hmac.Equal instead.
	if bytes.Equal(expected, sig) {
		w.WriteHeader(http.StatusOK)
	} else {
		w.WriteHeader(http.StatusForbidden)
	}
}
