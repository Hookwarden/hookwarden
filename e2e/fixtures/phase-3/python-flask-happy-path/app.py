# Python Flask happy path: stripe.Webhook.construct_event reachable from handler.

import os
import stripe
from flask import Flask, request

app = Flask(__name__)
endpoint_secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

@app.route("/webhooks/stripe", methods=["POST"])
def stripe_webhook():
    payload = request.get_data()
    sig_header = request.headers.get("Stripe-Signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, endpoint_secret)
    except ValueError:
        return ({"error": "invalid payload"}, 400)
    except stripe.error.SignatureVerificationError:
        return ({"error": "invalid signature"}, 400)
    print("Verified event:", event["type"])
    return {"received": True}
