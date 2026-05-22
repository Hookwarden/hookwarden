<?php
/**
 * framework: vanilla-php
 * rule: github/timing-unsafe-comparison
 * expected: not-verified
 * BUG (D-09 PHP-specific): strcmp() === 0 is not constant-time.
 */

$body = file_get_contents('php://input');
$sig = $_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '';
$secret = getenv('GITHUB_WEBHOOK_SECRET');
$expected = 'sha256=' . hash_hmac('sha256', $body, $secret);

if (strcmp($expected, $sig) === 0) {
    echo 'ok';
} else {
    http_response_code(403);
}
