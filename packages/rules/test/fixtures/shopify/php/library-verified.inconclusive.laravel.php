<?php
/**
 * framework: laravel
 * rule: shopify/library-verified
 * expected: manual-review
 * INCONCLUSIVE: verify call is gated behind a runtime config flag.
 */

use Illuminate\Support\Facades\Route;

Route::post('/webhooks/shopify', function (\Illuminate\Http\Request $request) {
    if (!config('shopify.strict_verify')) {
        return response('ok');
    }
    $sig = $_SERVER['HTTP_X_SHOPIFY_HMAC_SHA256'] ?? '';
    if (!\Shopify\Utils::validateHmac($request->getContent(), $sig)) {
        return response('forbidden', 403);
    }
    return response()->json(['received' => true]);
});
