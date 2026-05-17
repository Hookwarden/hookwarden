# Fixture: a Flask Stripe webhook handler that uses the library-verified path.
# Phase 4.2 release-binaries.yml smoke step scans this directory; the compiled
# binary must recognise stripe.Webhook.construct_event as RULES-04 verified.
# This file exercises the embedded WASM Python grammar on every target leg
# (Linux arm64, Linux x64, Windows x64) — proves DIST-05 end-to-end.
import os

import stripe
from flask import Flask, jsonify, request

app = Flask(__name__)
endpoint_secret = os.environ["STRIPE_WEBHOOK_SECRET"]


@app.route("/webhook", methods=["POST"])
def webhook() -> tuple:
    # Raw bytes — required for HMAC verification against the unparsed JSON.
    payload = request.get_data()
    sig_header = request.headers.get("Stripe-Signature", "")
    event = stripe.Webhook.construct_event(payload, sig_header, endpoint_secret)
    return jsonify({"received": True, "type": event["type"]}), 200


if __name__ == "__main__":
    app.run(port=3000)
