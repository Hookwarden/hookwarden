<?php
/**
 * framework: vanilla-php
 * rule: stripe/hardcoded-secret-prefix
 * expected: not-verified
 * BUG: A literal whsec_* secret is checked into source — it lands in git history,
 * docker images, etc. Read from getenv() and rotate the leaked credential.
 */

$body = file_get_contents('php://input');
$sig = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';
// Hardcoded secret — anti-pattern.
$secret = 'whsec_test_abc123';
$expected = hash_hmac('sha256', $body, $secret);
if (hash_equals($expected, $sig)) {
    echo 'ok';
}
