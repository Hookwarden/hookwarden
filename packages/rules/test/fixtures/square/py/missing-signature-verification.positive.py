from flask import Flask, request

app = Flask(__name__)


@app.route("/webhooks/square", methods=["POST"])
def square_webhook():
    # BUG: no HMAC verification.
    event = request.get_json()
    print("Square event:", event.get("event_id"))
    return "", 200
