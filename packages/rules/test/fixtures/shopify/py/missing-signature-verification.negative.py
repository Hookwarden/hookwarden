import base64
import hashlib
import hmac
import os

from flask import Flask, request

app = Flask(__name__)


@app.route("/webhooks/shopify", methods=["POST"])
def shopify_webhook():
    sig = request.headers.get("X-Shopify-Hmac-Sha256", "")
    digest = hmac.new(
        os.environ["SHOPIFY_API_SECRET"].encode(),
        request.get_data(),
        hashlib.sha256,
    ).digest()
    expected = base64.b64encode(digest).decode()
    if not hmac.compare_digest(sig, expected):
        return "", 403
    return "", 200
