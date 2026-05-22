<?php
/**
 * framework: vanilla-php
 * rule: square/missing-signature-verification
 * expected: verified
 * SAFE: manual HMAC verification using Square's url+body canonical input.
 */

$body = file_get_contents('php://input');
$sig = $_SERVER['HTTP_X_SQUARE_HMACSHA256_SIGNATURE'] ?? '';
$secret = getenv('SQUARE_WEBHOOK_SECRET');
$url = 'https://' . $_SERVER['HTTP_HOST'] . $_SERVER['REQUEST_URI'];
$expected = base64_encode(hash_hmac('sha256', $url . $body, $secret, true));
if (!hash_equals($expected, $sig)) {
    http_response_code(403);
    exit;
}
echo 'ok';
