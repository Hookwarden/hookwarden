<?php
/**
 * framework: laravel
 * rule: stripe/timing-unsafe-comparison
 * expected: not-verified
 * BUG: $expected === $sig leaks timing. Use hash_equals() instead.
 */

use Illuminate\Support\Facades\Route;

Route::post('/webhooks/stripe', function (\Illuminate\Http\Request $request) {
    $sig = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';
    $secret = getenv('STRIPE_WEBHOOK_SECRET');
    $expected = hash_hmac('sha256', $request->getContent(), $secret);
    if ($expected === $sig) {
        return response('ok');
    }
    return response('forbidden', 403);
});
