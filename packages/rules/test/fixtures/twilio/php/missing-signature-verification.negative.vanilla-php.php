<?php
/**
 * framework: vanilla-php
 * rule: twilio/missing-signature-verification
 * expected: verified
 * SAFE: manual sha1+base64 HMAC verification using Twilio's canonical URL+params shape.
 */

$sig = $_SERVER['HTTP_X_TWILIO_SIGNATURE'] ?? '';
$secret = getenv('TWILIO_AUTH_TOKEN');
$url = 'https://' . $_SERVER['HTTP_HOST'] . $_SERVER['REQUEST_URI'];
ksort($_POST);
$payload = $url;
foreach ($_POST as $k => $v) {
    $payload .= $k . $v;
}
$expected = base64_encode(hash_hmac('sha1', $payload, $secret, true));
if (!hash_equals($expected, $sig)) {
    http_response_code(403);
    exit;
}
echo "<Response/>";
