<?php
// Laravel PHP bug: manual HMAC compared with === (PHP strict equality)
// in a Route closure. Strict equality is byte-by-byte short-circuit and
// leaks timing — use hash_equals() instead.
//
// Different shape than php-vanilla-bug: namespace use + Route facade +
// closure receiving Request object + response() helper. Proves the PHP
// WASM loader handles framework-shaped code, not just vanilla scripts.

use Illuminate\Support\Facades\Route;

Route::post('/webhooks/stripe', function (\Illuminate\Http\Request $request) {
    $sig = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';
    $secret = getenv('STRIPE_WEBHOOK_SECRET');
    $expected = hash_hmac('sha256', $request->getContent(), $secret);

    // THE BUG: === is constant-time-broken. Use hash_equals($expected, $sig).
    if ($expected === $sig) {
        return response('ok');
    }
    return response('forbidden', 403);
});
