<?php
/**
 * framework: vanilla-php
 * rule: twilio/missing-signature-verification
 * expected: not-verified
 * BUG: Twilio webhook handler reads body but skips signature check.
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit;
}

// Twilio posts form-encoded body — read $_POST.
$from = $_POST['From'] ?? '';
$body = $_POST['Body'] ?? '';
// Read the signature header BUT skip verification — antipattern. The presence of the header
// read tells the engine this is a webhook handler; the absence of hash_hmac/verify is the bug.
$sig = $_SERVER['HTTP_X_TWILIO_SIGNATURE'] ?? '';
echo "<Response><Message>Received from {$from}</Message></Response>";
