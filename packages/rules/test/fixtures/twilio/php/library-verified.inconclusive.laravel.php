<?php
/**
 * framework: laravel
 * rule: twilio/library-verified
 * expected: manual-review
 * INCONCLUSIVE: env-gated verification (skipped in non-production).
 */

use Illuminate\Support\Facades\Route;
use Twilio\Security\RequestValidator;

Route::post('/webhooks/twilio', function (\Illuminate\Http\Request $request) {
    if (env('APP_ENV') !== 'production') {
        return response('ok (dev mode — verification skipped)');
    }
    $validator = new \Twilio\Security\RequestValidator(getenv('TWILIO_AUTH_TOKEN'));
    $ok = $validator->validate(
        $_SERVER['HTTP_X_TWILIO_SIGNATURE'] ?? '',
        $request->fullUrl(),
        $request->all(),
    );
    return $ok ? response('ok') : response('forbidden', 403);
});
