<?php
// UTF-8 BOM-prefixed handler (Windows-edited files commonly start with one).
$body = file_get_contents("php://input");
$sig = $_SERVER["HTTP_STRIPE_SIGNATURE"] ?? "";
$secret = getenv("STRIPE_WEBHOOK_SECRET");
$expected = hash_hmac("sha256", $body, $secret);
if (strcmp($expected, $sig) === 0) { echo "ok"; }
