// Go happy path: verifies via the Stripe Go SDK webhook.ConstructEvent → verified, exit 0.
package main

import (
	"io"
	"net/http"
	"os"

	"github.com/stripe/stripe-go/v76/webhook"
)

func StripeWebhook(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	sig := r.Header.Get("Stripe-Signature")
	if _, err := webhook.ConstructEvent(body, sig, os.Getenv("STRIPE_WEBHOOK_SECRET")); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusOK)
}
