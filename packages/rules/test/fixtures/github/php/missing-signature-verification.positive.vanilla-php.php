<?php
/**
 * framework: vanilla-php
 * rule: github/missing-signature-verification
 * expected: not-verified
 * BUG: handler reads body but never verifies the GitHub signature.
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit;
}

$body = file_get_contents('php://input');
// Process body without verifying X-Hub-Signature-256. Anti-pattern.
$payload = json_decode($body, true);
echo json_encode(['received' => $payload['action'] ?? null]);
