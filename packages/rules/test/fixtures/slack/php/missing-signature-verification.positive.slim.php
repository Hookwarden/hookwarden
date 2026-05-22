<?php
/**
 * framework: slim
 * rule: slack/missing-signature-verification
 * expected: not-verified
 * BUG: Slim handler reads body but never validates v0 signature.
 */

use Slim\Factory\AppFactory;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Message\ResponseInterface;

$app = AppFactory::create();

$app->post('/webhooks/slack', function (ServerRequestInterface $req, ResponseInterface $res) {
    // Reads body but skips X-Slack-Signature verification — anti-pattern.
    $payload = json_decode((string) $req->getBody(), true);
    $res->getBody()->write(json_encode(['received' => $payload['type'] ?? 'unknown']));
    return $res;
});

$app->run();
