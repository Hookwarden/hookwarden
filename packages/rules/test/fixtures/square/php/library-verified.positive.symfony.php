<?php
/**
 * framework: symfony
 * rule: square/library-verified
 * expected: verified
 * SAFE: Square\Utils\WebhooksHelper::isValidWebhookEventSignature handles verification.
 */

namespace App\Controller;

use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\JsonResponse;
use Square\Utils\WebhooksHelper;

class SquareWebhookController
{
    #[Route('/webhooks/square', methods: ['POST'])]
    public function handle(Request $request): JsonResponse
    {
        $sig = $_SERVER['HTTP_X_SQUARE_HMACSHA256_SIGNATURE'] ?? '';
        $ok = \Square\Utils\WebhooksHelper::isValidWebhookEventSignature(
            $request->getContent(),
            $sig,
            getenv('SQUARE_WEBHOOK_SECRET'),
            $request->getUri(),
        );
        if (!$ok) {
            return new JsonResponse(['error' => 'forbidden'], 403);
        }
        return new JsonResponse(['received' => true]);
    }
}
