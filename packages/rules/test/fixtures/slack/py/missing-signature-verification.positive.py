from flask import Flask, request

app = Flask(__name__)


@app.route("/slack/events", methods=["POST"])
def slack_events():
    # BUG: no signature verification.
    event = request.get_json()
    print("Slack event:", event.get("type"))
    return "", 200
