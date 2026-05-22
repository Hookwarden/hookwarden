<?php
/**
 * framework: vanilla-php
 * rule: github/missing-signature-verification
 * expected: verified
 * SAFE: hash_hmac + hash_equals manual verification flow.
 */

$body = file_get_contents('php://input');
$sig = $_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '';
$secret = getenv('GITHUB_WEBHOOK_SECRET');
$expected = 'sha256=' . hash_hmac('sha256', $body, $secret);

if (!hash_equals($expected, $sig)) {
    http_response_code(403);
    exit;
}

$payload = json_decode($body, true);
echo json_encode(['received' => true]);
