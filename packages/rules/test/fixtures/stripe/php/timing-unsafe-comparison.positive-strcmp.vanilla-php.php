<?php
/**
 * framework: vanilla-php
 * rule: stripe/timing-unsafe-comparison
 * expected: not-verified
 * BUG (D-09 PHP-specific): strcmp() is not constant-time. Use hash_equals() instead.
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit;
}

$body = file_get_contents('php://input');
$sig = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';
$secret = getenv('STRIPE_WEBHOOK_SECRET');
$expected = hash_hmac('sha256', $body, $secret);

if (strcmp($expected, $sig) === 0) {
    echo 'ok';
} else {
    http_response_code(403);
}
