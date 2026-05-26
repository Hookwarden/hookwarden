# Flask GitHub webhook — manual HMAC verified, but compared with a timing-unsafe
# `!=` instead of hmac.compare_digest, so the check leaks timing information.
import hashlib
import hmac
import os

from flask import Flask, abort, request

app = Flask(__name__)


@app.route("/webhooks/github", methods=["POST"])
def github_webhook():
    secret = os.environ["GITHUB_WEBHOOK_SECRET"].encode()
    expected = "sha256=" + hmac.new(secret, request.data, hashlib.sha256).hexdigest()
    signature = request.headers.get("X-Hub-Signature-256", "")
    if signature != expected:
        abort(401)
    return "", 202
