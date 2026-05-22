<?php
/**
 * framework: laravel
 * rule: twilio/timing-unsafe-comparison
 * expected: not-verified
 * BUG: === comparison on Twilio HMAC leaks timing.
 */

use Illuminate\Support\Facades\Route;

Route::post('/webhooks/twilio', function (\Illuminate\Http\Request $request) {
    $sig = $_SERVER['HTTP_X_TWILIO_SIGNATURE'] ?? '';
    $secret = getenv('TWILIO_AUTH_TOKEN');
    $url = $request->fullUrl();
    $params = $request->all();
    ksort($params);
    $payload = $url . implode('', array_map(fn ($k, $v) => $k . $v, array_keys($params), $params));
    $expected = base64_encode(hash_hmac('sha1', $payload, $secret, true));
    if ($expected === $sig) {
        return response('ok');
    }
    return response('forbidden', 403);
});
