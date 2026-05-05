import os

from flask import Flask, request
from slack_sdk.signature import SignatureVerifier

app = Flask(__name__)
verifier = SignatureVerifier(os.environ["SLACK_SIGNING_SECRET"])


@app.route("/slack/events", methods=["POST"])
def slack_events():
    body = request.get_data().decode("utf-8")
    if not verifier.is_valid_request(body, request.headers):
        return "", 403
    return "", 200
