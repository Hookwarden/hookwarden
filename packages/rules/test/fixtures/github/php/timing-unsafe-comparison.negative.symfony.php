<?php
/**
 * framework: symfony
 * rule: github/timing-unsafe-comparison
 * expected: verified
 * SAFE: hash_equals() constant-time comparison.
 */

namespace App\Controller;

use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\JsonResponse;

class GithubWebhookController
{
    #[Route('/webhooks/github', methods: ['POST'])]
    public function handle(Request $request): JsonResponse
    {
        $sig = $_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '';
        $secret = getenv('GITHUB_WEBHOOK_SECRET');
        $expected = 'sha256=' . hash_hmac('sha256', $request->getContent(), $secret);
        if (hash_equals($expected, $sig)) {
            return new JsonResponse(['ok' => true]);
        }
        return new JsonResponse(['error' => 'forbidden'], 403);
    }
}
