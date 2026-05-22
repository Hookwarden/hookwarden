<?php
/**
 * framework: slim
 * rule: slack/missing-signature-verification
 * expected: verified
 * SAFE: manual v0 signature verification before processing.
 */

use Slim\Factory\AppFactory;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Message\ResponseInterface;

$app = AppFactory::create();

$app->post('/webhooks/slack', function (ServerRequestInterface $req, ResponseInterface $res) {
    $body = (string) $req->getBody();
    $timestamp = $_SERVER['HTTP_X_SLACK_REQUEST_TIMESTAMP'] ?? '0';
    $sig = $_SERVER['HTTP_X_SLACK_SIGNATURE'] ?? '';
    $secret = getenv('SLACK_SIGNING_SECRET');
    $expected = 'v0=' . hash_hmac('sha256', 'v0:' . $timestamp . ':' . $body, $secret);
    if (!hash_equals($expected, $sig)) {
        return $res->withStatus(403);
    }
    $res->getBody()->write('ok');
    return $res;
});

$app->run();
