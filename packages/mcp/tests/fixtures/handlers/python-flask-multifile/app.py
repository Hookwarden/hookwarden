# Wave 0 fixture for Plan 23-05 scan_handler — Python multi-file shape.
# Flask app registers the webhook blueprint; the handler in
# handlers/webhook.py consumes request.get_data() without HMAC verification,
# the Python equivalent of the JS/TS missing-verification bug.
#
# scan_handler must walk the blueprint registration to find the handler
# in the sibling file. Cross-file resolution for Python parallels the
# JS/TS middleware_chain extraction.

from flask import Flask
from handlers.webhook import webhook_bp

app = Flask(__name__)
app.register_blueprint(webhook_bp, url_prefix="/webhooks/stripe")

if __name__ == "__main__":
    app.run(port=3000)
