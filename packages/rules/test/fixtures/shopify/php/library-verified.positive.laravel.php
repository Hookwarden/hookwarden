<?php
/**
 * framework: laravel
 * rule: shopify/library-verified
 * expected: verified
 * SAFE: Shopify\Utils::validateHmac handles verification internally.
 */

use Illuminate\Support\Facades\Route;
use Shopify\Utils;

Route::post('/webhooks/shopify', function (\Illuminate\Http\Request $request) {
    $sig = $_SERVER['HTTP_X_SHOPIFY_HMAC_SHA256'] ?? '';
    if (!\Shopify\Utils::validateHmac($request->getContent(), $sig)) {
        return response('forbidden', 403);
    }
    return response()->json(['received' => true]);
});
