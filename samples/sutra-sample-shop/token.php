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
// Issues a chat token for the person signed in on this website: a JWT signed with HMAC-SHA256 (HS256) and
// the shared secret, valid for a few minutes. The chat widget asks for it before each message and again when
// SutraFlow refuses an expired one. Only this website's own pages call it (same-site session cookie).
require __DIR__ . '/config.php';
session_start();
header('Cache-Control: no-store');
header('Content-Type: text/plain; charset=utf-8');

$user = $_SESSION['user'] ?? null;
if (!$user) { http_response_code(401); exit(''); }
// No secret set yet (config.local.php): no token, and the chat says the website is not set up.
if (!chat_ready()) { http_response_code(503); exit(''); }

function b64url(string $data): string { return rtrim(strtr(base64_encode($data), '+/', '-_'), '='); }

$now = time();
$header = ['alg' => 'HS256', 'typ' => 'JWT'];
$claims = [
    'iss' => CHAT_ISSUER, 'aud' => CHAT_AUDIENCE, 'sub' => $user['sub'],
    'name' => $user['name'], 'role' => $user['role'], 'scope' => 'chat',
    'iat' => $now, 'exp' => $now + CHAT_TOKEN_MINUTES * 60,
];
$body = b64url(json_encode($header)) . '.' . b64url(json_encode($claims));
echo $body . '.' . b64url(hash_hmac('sha256', $body, CHAT_SECRET, true));
