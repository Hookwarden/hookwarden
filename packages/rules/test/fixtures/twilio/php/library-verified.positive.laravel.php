<?php
/**
 * framework: laravel
 * rule: twilio/library-verified
 * expected: verified
 * SAFE: Twilio\Security\RequestValidator handles verification (instance API).
 */

use Illuminate\Support\Facades\Route;
use Twilio\Security\RequestValidator;

Route::post('/webhooks/twilio', function (\Illuminate\Http\Request $request) {
    $validator = new \Twilio\Security\RequestValidator(getenv('TWILIO_AUTH_TOKEN'));
    $sig = $_SERVER['HTTP_X_TWILIO_SIGNATURE'] ?? '';
    $ok = $validator->validate($sig, $request->fullUrl(), $request->all());
    if (!$ok) {
        return response('forbidden', 403);
    }
    return response()->json(['received' => true]);
});
