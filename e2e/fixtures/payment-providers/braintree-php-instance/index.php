<?php
// Laravel Braintree handler using the current PHP SDK instance form
// $gateway->webhookNotification()->parse(...) — must be recognized as verified.

use Braintree\Gateway;
use Illuminate\Support\Facades\Route;

Route::post('/webhooks/braintree', function (\Illuminate\Http\Request $request) {
    $gateway = new Gateway([
        'environment' => 'production',
        'merchantId' => getenv('BRAINTREE_MERCHANT_ID'),
        'publicKey' => getenv('BRAINTREE_PUBLIC_KEY'),
        'privateKey' => getenv('BRAINTREE_PRIVATE_KEY'),
    ]);
    $notification = $gateway->webhookNotification()->parse(
        $request->input('bt_signature'),
        $request->input('bt_payload')
    );
    return response('ok:' . $notification->kind);
});
