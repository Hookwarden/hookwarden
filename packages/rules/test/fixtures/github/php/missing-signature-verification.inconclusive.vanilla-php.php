<?php
/**
 * framework: vanilla-php
 * rule: github/missing-signature-verification
 * expected: manual-review
 * INCONCLUSIVE: dynamic dispatch on $_GET['provider'] — engine can't statically
 * decide which branch verifies. Real codebases that multiplex providers this way
 * need human review.
 */

$body = file_get_contents('php://input');
$provider = $_GET['provider'] ?? 'unknown';

switch ($provider) {
    case 'github':
        $sig = $_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '';
        $expected = 'sha256=' . hash_hmac('sha256', $body, getenv('GITHUB_WEBHOOK_SECRET'));
        $ok = hash_equals($expected, $sig);
        break;
    default:
        $ok = false;
}

if (!$ok) {
    http_response_code(403);
    exit;
}
echo 'ok';
