<?php
// Vanilla PHP bug: manual HMAC compared with strcmp() — not constant-time.
// Equivalent to the JS / Python "manual HMAC with plain ==" bug fixtures.

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit;
}

$body = file_get_contents('php://input');
$sig = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';
$secret = getenv('STRIPE_WEBHOOK_SECRET');
$expected = hash_hmac('sha256', $body, $secret);

// THE BUG: strcmp() is not constant-time. Use hash_equals() instead.
if (strcmp($expected, $sig) === 0) {
    echo 'ok';
} else {
    http_response_code(403);
}
