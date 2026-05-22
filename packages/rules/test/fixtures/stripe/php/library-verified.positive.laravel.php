<?php
/**
 * framework: laravel
 * rule: stripe/library-verified
 * expected: verified
 * SAFE: \Stripe\Webhook::constructEvent handles signature verification internally.
 */

use Illuminate\Support\Facades\Route;
use Stripe\Webhook;

Route::post('/webhooks/stripe', function (\Illuminate\Http\Request $request) {
    $sig = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';
    $secret = getenv('STRIPE_WEBHOOK_SECRET');
    try {
        $event = \Stripe\Webhook::constructEvent($request->getContent(), $sig, $secret);
        return response()->json(['received' => true]);
    } catch (\UnexpectedValueException $e) {
        return response('invalid payload', 400);
    } catch (\Stripe\Exception\SignatureVerificationException $e) {
        return response('invalid signature', 400);
    }
});
