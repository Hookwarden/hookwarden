import os

from flask import Flask, request
from squareup.utilities.webhooks_helper import WebhooksHelper

app = Flask(__name__)


@app.route("/webhooks/square", methods=["POST"])
def square_webhook():
    sig = request.headers.get("X-Square-HmacSha256-Signature", "")
    body = request.get_data().decode("utf-8")
    if not WebhooksHelper.is_valid_webhook_event_signature(
        body, sig, os.environ["SQUARE_SIGNATURE_KEY"], request.url
    ):
        return "", 403
    return "", 200
