from flask import Flask, request

app = Flask(__name__)


@app.route("/webhooks/shopify", methods=["POST"])
def shopify_webhook():
    # BUG: no HMAC verification.
    order = request.get_json()
    print("Shopify order:", order.get("id"))
    return "", 200
