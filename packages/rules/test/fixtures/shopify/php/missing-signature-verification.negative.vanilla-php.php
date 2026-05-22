<?php
/**
 * framework: vanilla-php
 * rule: shopify/missing-signature-verification
 * expected: verified
 * SAFE: explicit HMAC verification via hash_hmac + hash_equals.
 */

$body = file_get_contents('php://input');
$sig = $_SERVER['HTTP_X_SHOPIFY_HMAC_SHA256'] ?? '';
$secret = getenv('SHOPIFY_WEBHOOK_SECRET');
$expected = base64_encode(hash_hmac('sha256', $body, $secret, true));
if (!hash_equals($expected, $sig)) {
    http_response_code(403);
    exit;
}
echo 'ok';
