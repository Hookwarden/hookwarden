from flask import Flask, request
from shopify.webhooks import verify  # canonical Python verify path (ShopifyAPI library)

app = Flask(__name__)


@app.route("/webhooks/shopify", methods=["POST"])
def shopify_webhook():
    sig = request.headers.get("X-Shopify-Hmac-Sha256", "")
    if not verify(request.get_data(), sig):
        return "", 403
    return "", 200
