<?php
/**
 * framework: vanilla-php
 * rule: slack/timing-unsafe-comparison
 * expected: manual-review
 * INCONCLUSIVE: signature compare uses a runtime-selected callback — the engine
 * can't statically know whether $compareFn is hash_equals or a custom function.
 */

$body = file_get_contents('php://input');
$timestamp = $_SERVER['HTTP_X_SLACK_REQUEST_TIMESTAMP'] ?? '0';
$sig = $_SERVER['HTTP_X_SLACK_SIGNATURE'] ?? '';
$secret = getenv('SLACK_SIGNING_SECRET');
$expected = 'v0=' . hash_hmac('sha256', 'v0:' . $timestamp . ':' . $body, $secret);

// Dynamic dispatch — runtime decides comparison strategy.
$compareFn = getenv('USE_HASH_EQUALS') === '1' ? 'hash_equals' : 'strcmp';
$result = $compareFn($expected, $sig);
if ($result === 0 || $result === true) {
    echo 'ok';
} else {
    http_response_code(403);
}
