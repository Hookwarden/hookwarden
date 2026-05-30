# The bug: route reads request.get_data() and processes the payload
# WITHOUT calling stripe.WebhookSignature.verify_header or any HMAC
# comparison against the request body + Stripe-Signature header.

from flask import Blueprint, request, jsonify

webhook_bp = Blueprint("webhook", __name__)


@webhook_bp.route("", methods=["POST"])
def handle_webhook():
    payload = request.get_data(as_text=True)
    # Missing: HMAC verification of payload against Stripe-Signature header
    # using STRIPE_WEBHOOK_SECRET. Handler accepts every event.
    return jsonify({"received": True, "bytes": len(payload)})
