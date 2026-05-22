<?php
/**
 * framework: symfony
 * rule: square/library-verified
 * expected: manual-review
 * INCONCLUSIVE: verification call lives behind a parameter check.
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
        $skipVerify = $this->shouldSkipVerify();
        if ($skipVerify) {
            return new JsonResponse(['ok' => true, 'verified' => false]);
        }
        $ok = \Square\Utils\WebhooksHelper::isValidWebhookEventSignature(
            $request->getContent(),
            $_SERVER['HTTP_X_SQUARE_HMACSHA256_SIGNATURE'] ?? '',
            getenv('SQUARE_WEBHOOK_SECRET'),
            $request->getUri(),
        );
        return $ok ? new JsonResponse(['received' => true]) : new JsonResponse(['error' => 'forbidden'], 403);
    }

    private function shouldSkipVerify(): bool
    {
        // Runtime call — engine can't statically resolve.
        return method_exists($this, 'isLocalDev') && $this->isLocalDev();
    }
}
