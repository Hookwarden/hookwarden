<?php
/**
 * framework: vanilla-php
 * rule: slack/timing-unsafe-comparison
 * expected: not-verified
 * BUG: === comparison on Slack v0 signature leaks timing.
 */

$body = file_get_contents('php://input');
$timestamp = $_SERVER['HTTP_X_SLACK_REQUEST_TIMESTAMP'] ?? '0';
$sig = $_SERVER['HTTP_X_SLACK_SIGNATURE'] ?? '';
$secret = getenv('SLACK_SIGNING_SECRET');
$base = 'v0:' . $timestamp . ':' . $body;
$expected = 'v0=' . hash_hmac('sha256', $base, $secret);

if ($expected === $sig) {
    echo 'ok';
} else {
    http_response_code(403);
}
