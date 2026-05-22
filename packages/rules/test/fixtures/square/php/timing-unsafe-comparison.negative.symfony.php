<?php
/**
 * framework: symfony
 * rule: square/timing-unsafe-comparison
 * expected: verified
 * SAFE: hash_equals() constant-time comparison.
 */

namespace App\Controller;

use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\JsonResponse;

class SquareWebhookController
{
    #[Route('/webhooks/square', methods: ['POST'])]
    public function handle(Request $request): JsonResponse
    {
        $sig = $_SERVER['HTTP_X_SQUARE_HMACSHA256_SIGNATURE'] ?? '';
        $secret = getenv('SQUARE_WEBHOOK_SECRET');
        $url = $request->getUri();
        $body = $request->getContent();
        $expected = base64_encode(hash_hmac('sha256', $url . $body, $secret, true));
        if (hash_equals($expected, $sig)) {
            return new JsonResponse(['ok' => true]);
        }
        return new JsonResponse(['error' => 'forbidden'], 403);
    }
}
