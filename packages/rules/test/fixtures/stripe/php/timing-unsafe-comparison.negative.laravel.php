<?php
/**
 * framework: laravel
 * rule: stripe/timing-unsafe-comparison
 * expected: verified
 * SAFE: hash_equals() is PHP's constant-time string-compare (5.6+).
 */

use Illuminate\Support\Facades\Route;

Route::post('/webhooks/stripe', function (\Illuminate\Http\Request $request) {
    $sig = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';
    $secret = getenv('STRIPE_WEBHOOK_SECRET');
    $expected = hash_hmac('sha256', $request->getContent(), $secret);
    if (hash_equals($expected, $sig)) {
        return response('ok');
    }
    return response('forbidden', 403);
});
