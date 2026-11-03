<?php
/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.1.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Setup check of Sutra Sample Shop: the settings (never the secret itself) and whether SutraFlow answers.
// Remove this file from a public website once the chat works.
require __DIR__ . '/config.php';
header('Cache-Control: no-store');
$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');

/** GET or POST to SutraFlow from this server: [status, error]. */
function probe(string $url, string $method = 'GET'): array
{
    $ctx = stream_context_create(['http' => ['method' => $method, 'timeout' => 8, 'ignore_errors' => true, 'header' => "Content-Type: application/json\r\n", 'content' => $method === 'POST' ? '{"message":"setup check"}' : '']]);
    $body = @file_get_contents($url, false, $ctx);
    $status = 0;
    foreach ($http_response_header ?? [] as $line) if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) $status = (int)$m[1];
    return [$status, $body === false && !$status ? (error_get_last()['message'] ?? 'no answer') : ''];
}

$checks = [];
$checks[] = ['PHP 8 or later', PHP_VERSION_ID >= 80000, 'PHP ' . PHP_VERSION];
$checks[] = ['config.local.php', is_file(__DIR__ . '/config.local.php'), is_file(__DIR__ . '/config.local.php') ? 'found' : 'missing: copy config.local.example.php (or use environment variables)'];
$checks[] = ['Shared secret (CHAT_SECRET)', chat_ready(), chat_ready() ? strlen(CHAT_SECRET) . ' characters' : 'not set or shorter than 32 characters'];
$checks[] = ['SutraFlow address (SUTRAFLOW_URL)', (bool)preg_match('#^https?://#', SUTRAFLOW_URL), SUTRAFLOW_URL];
[$w, $we] = probe(SUTRAFLOW_URL . '/chat/' . rawurlencode(CHAT_AGENT) . '/widget.js');
$checks[] = ['Chat button (widget.js)', $w === 200, $w === 200 ? 'SutraFlow answers' : ($w ? "HTTP $w: is the agent " . CHAT_AGENT . ' deployed?' : "not reached: $we")];
[$a] = probe(SUTRAFLOW_URL . '/chat/' . rawurlencode(CHAT_AGENT) . '/api', 'POST');
$checks[] = ['Chat protected by the sign-in policy', $a === 401, $a === 401 ? 'a message without a token is refused, as it should be' : ($a ? "HTTP $a: choose the policy Sample chat website sign-in on the agent" : 'not reached')];
?><!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Setup check: <?= $h(SHOP_NAME) ?></title>
<style>body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:Canvas;color:CanvasText}main{max-width:760px;margin:0 auto;padding:24px 16px}
table{border-collapse:collapse;width:100%}td{padding:8px;border-bottom:1px solid color-mix(in srgb,CanvasText 18%,transparent);vertical-align:top}td:first-child{width:28px;font-weight:700}
.ok{color:#1e8a4c}.no{color:#c0392b}code{overflow-wrap:anywhere}p.n{opacity:.75;font-size:14px}</style></head>
<body><main><h1>Setup check</h1>
<table><?php foreach ($checks as [$what, $ok, $note]): ?><tr><td class="<?= $ok ? 'ok' : 'no' ?>"><?= $ok ? '✓' : '✗' ?></td><td><b><?= $h($what) ?></b><br><code><?= $h($note) ?></code></td></tr><?php endforeach; ?></table>
<p class="n">Agent <code><?= $h(CHAT_AGENT) ?></code>, issuer <code><?= $h(CHAT_ISSUER) ?></code>, audience <code><?= $h(CHAT_AUDIENCE) ?></code>: they must match the agent and the policy in SutraFlow. This page checks from the web server; visitors' browsers must reach the same address (an address such as 127.0.0.1 works only on this computer).</p>
<p class="n">Remove check.php from a public website once the chat works. <a href="index.php">Back to the shop</a></p>
</main></body></html>
