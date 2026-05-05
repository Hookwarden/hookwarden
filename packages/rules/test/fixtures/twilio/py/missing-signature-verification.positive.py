from flask import Flask, request

app = Flask(__name__)


@app.route("/webhooks/twilio", methods=["POST"])
def twilio_webhook():
    # BUG: no RequestValidator, no manual HMAC.
    message_sid = request.form.get("MessageSid")
    print("Twilio event:", message_sid)
    return "", 200
