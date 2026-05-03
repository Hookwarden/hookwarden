# Python Flask bug: manual HMAC with plain == comparison instead of hmac.compare_digest.

import hashlib
import hmac
from flask import Flask, request

app = Flask(__name__)
WEBHOOK_SECRET = "set-from-env"

@app.route("/webhooks/stripe", methods=["POST"])
def stripe_webhook():
    sig = request.headers.get("Stripe-Signature", "")
    body = request.get_data()
    expected = hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    # THE BUG: plain == instead of hmac.compare_digest(...)
    if expected == sig:
        return {"received": True}
    return ({"error": "invalid signature"}, 400)
