<?php
/**
 * framework: laravel
 * rule: shopify/timing-unsafe-comparison
 * expected: not-verified
 * BUG: == comparison on HMAC leaks timing.
 */

use Illuminate\Support\Facades\Route;

Route::post('/webhooks/shopify', function (\Illuminate\Http\Request $request) {
    $sig = $_SERVER['HTTP_X_SHOPIFY_HMAC_SHA256'] ?? '';
    $secret = getenv('SHOPIFY_WEBHOOK_SECRET');
    $expected = base64_encode(hash_hmac('sha256', $request->getContent(), $secret, true));
    if ($expected == $sig) {
        return response('ok');
    }
    return response('forbidden', 403);
});
