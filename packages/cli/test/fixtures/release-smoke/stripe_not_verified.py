# Fixture: a Flask Stripe webhook handler with NO signature verification.
# Phase 4.2 release-binaries.yml smoke step scans this directory; the compiled
# binary must recognise this as RULES-02 not-verified (handler reads the body
# and parses JSON, never validates the Stripe-Signature header).
# Exercises the embedded WASM Python grammar on every target leg (DIST-05).
#
# This file deliberately omits the verification API and the standard-library
# crypto primitive a webhook handler would normally use, so the not-verified
# rule fires cleanly in the smoke step.
import json

from flask import Flask, jsonify, request

app = Flask(__name__)


@app.route("/webhook", methods=["POST"])
def webhook() -> tuple:
    payload = request.get_data()
    # BUG: signature header read but never checked against the payload.
    _sig_header = request.headers.get("Stripe-Signature", "")
    event = json.loads(payload)
    return jsonify({"received": True, "type": event.get("type")}), 200


if __name__ == "__main__":
    app.run(port=3000)
