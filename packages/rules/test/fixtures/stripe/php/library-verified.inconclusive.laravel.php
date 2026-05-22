<?php
/**
 * framework: laravel
 * rule: stripe/library-verified
 * expected: manual-review
 * INCONCLUSIVE: signature verification is gated behind a feature flag — the engine
 * cannot decide statically whether the verify call is reachable on every request.
 */

use Illuminate\Support\Facades\Route;
use Stripe\Webhook;

Route::post('/webhooks/stripe', function (\Illuminate\Http\Request $request) {
    if (!feature_flag('verify_stripe_webhooks')) {
        // Feature-flagged path — verification is conditionally skipped.
        return response('ok');
    }
    $sig = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';
    $secret = getenv('STRIPE_WEBHOOK_SECRET');
    $event = \Stripe\Webhook::constructEvent($request->getContent(), $sig, $secret);
    return response()->json(['received' => true]);
});
