<?php
/**
 * framework: vanilla-php
 * rule: slack/timing-unsafe-comparison
 * expected: not-verified
 * BUG (D-09): strcmp(...) === 0 is not constant-time.
 */

$body = file_get_contents('php://input');
$timestamp = $_SERVER['HTTP_X_SLACK_REQUEST_TIMESTAMP'] ?? '0';
$sig = $_SERVER['HTTP_X_SLACK_SIGNATURE'] ?? '';
$secret = getenv('SLACK_SIGNING_SECRET');
$expected = 'v0=' . hash_hmac('sha256', 'v0:' . $timestamp . ':' . $body, $secret);

if (strcmp($expected, $sig) === 0) {
    echo 'ok';
} else {
    http_response_code(403);
}
