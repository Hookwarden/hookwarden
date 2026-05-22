<?php
// Namespaced class with the webhook handler as a public method —
// the common shape in larger PHP/Laravel/Symfony codebases.
namespace App\Http\Controllers;

class StripeController {
    public function webhook() {
        $body = file_get_contents('php://input');
        $sig = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';
        $secret = getenv('STRIPE_WEBHOOK_SECRET');
        $expected = hash_hmac('sha256', $body, $secret);
        // THE BUG: strcmp is not constant-time.
        if (strcmp($expected, $sig) === 0) {
            return 'ok';
        }
        return 'forbidden';
    }
}
