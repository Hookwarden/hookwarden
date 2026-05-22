<?php
/**
 * framework: vanilla-php
 * rule: shopify/missing-signature-verification
 * expected: not-verified
 * BUG: Shopify webhook handler reads body but skips X-Shopify-Hmac-SHA256 check.
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit;
}

$body = file_get_contents('php://input');
// Read X-Shopify-Topic, X-Shopify-Hmac-SHA256 etc — but never verify HMAC.
$topic = $_SERVER['HTTP_X_SHOPIFY_TOPIC'] ?? '';
echo json_encode(['topic' => $topic, 'received' => true]);
