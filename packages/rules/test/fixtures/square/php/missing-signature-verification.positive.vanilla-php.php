<?php
/**
 * framework: vanilla-php
 * rule: square/missing-signature-verification
 * expected: not-verified
 * BUG: Square webhook reads body but skips signature verification.
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit;
}

$body = file_get_contents('php://input');
$event = json_decode($body, true);
echo json_encode(['type' => $event['type'] ?? 'unknown']);
