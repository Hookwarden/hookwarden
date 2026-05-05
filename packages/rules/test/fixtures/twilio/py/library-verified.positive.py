import os

from flask import Flask, request
from twilio.request_validator import RequestValidator

app = Flask(__name__)
validator = RequestValidator(os.environ["TWILIO_AUTH_TOKEN"])


@app.route("/webhooks/twilio", methods=["POST"])
def twilio_webhook():
    url = request.url
    signature = request.headers.get("X-Twilio-Signature", "")
    if not validator.validate(url, request.form.to_dict(), signature):
        return "", 403
    return "", 200
