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
// The example website "Sutra Sample Shop": its own sign-in, and SutraFlow's chat button for the signed-in person.
require __DIR__ . '/config.php';
session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax', 'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off']);
session_start();

$error = '';
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $name = strtolower(trim($_POST['user'] ?? ''));
    $known = USERS[$name] ?? null;
    if ($known && hash_equals($known['password'], (string)($_POST['password'] ?? ''))) {
        session_regenerate_id(true);
        $_SESSION['user'] = ['sub' => $known['sub'], 'name' => $known['name'], 'role' => $known['role']];
        header('Location: index.php');
        exit;
    }
    $error = 'That user name and password do not match.';
}
$user = $_SESSION['user'] ?? null;
$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
$https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
$mixed = $https && str_starts_with(SUTRAFLOW_URL, 'http://');
$skills = [
    ['Order status', 'Where is A-1001?'],
    ['Tracking a parcel', 'Track my order'],
    ['Returns and refunds', 'I want to return A-0988'],
    ['Invoices', 'Send the invoice for A-1001'],
    ['Delivery address', 'Change the address of A-1002'],
    ['Products, prices and stock', 'Do you have green tea?'],
    ['A person from the support desk', 'Talk to a person'],
];
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= $h(SHOP_NAME) ?></title>
<style>
  :root { --bg: #f6f7f9; --card: #fff; --ink: #16202a; --muted: #5d6b78; --line: #dde3e8; --brand: #0d6e5f; --warn: #9a6200; }
  @media (prefers-color-scheme: dark) { :root { --bg: #121619; --card: #1b2126; --ink: #e6edf2; --muted: #93a1ad; --line: #2a333b; --brand: #2fb39a; --warn: #e0a640; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; justify-content: space-between; padding: 14px 20px; background: var(--card); border-bottom: 1px solid var(--line); }
  header b { font-size: 18px; } a { color: var(--brand); }
  main { max-width: 760px; margin: 0 auto; padding: 24px 16px 120px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; margin: 0 0 16px; }
  .card h2 { margin-top: 0; font-size: 20px; }
  label { display: block; margin: 10px 0 4px; font-weight: 600; }
  input { width: 100%; padding: 9px 11px; border: 1px solid var(--line); border-radius: 8px; font: inherit; background: var(--bg); color: var(--ink); }
  button { margin-top: 14px; border: 0; border-radius: 8px; padding: 10px 18px; background: var(--brand); color: #fff; font: inherit; cursor: pointer; }
  .muted { color: var(--muted); font-size: 14px; } .err { color: #c0392b; } .warn { border-color: var(--warn); } .warn h2 { color: var(--warn); }
  ul.skills { margin: 8px 0 0; padding-left: 20px; } ul.skills li { margin: 4px 0; } ul.skills i { color: var(--muted); }
  code { font-size: 14px; overflow-wrap: anywhere; }
</style>
</head>
<body>
<header>
  <b><?= $h(SHOP_NAME) ?></b>
  <span><?php if ($user): ?>Signed in as <?= $h($user['name']) ?> (<?= $h($user['role']) ?>) · <a href="logout.php">Sign out</a><?php else: ?>Not signed in<?php endif; ?></span>
</header>
<main>
<?php if (!chat_ready()): ?>
  <div class="card warn">
    <h2>Set up the chat first</h2>
    <p>The shared secret is not set. Copy <code>config.local.example.php</code> to <code>config.local.php</code> and set <code>CHAT_SECRET</code> to the same text as the Secret property <code>CHAT_SITE_SECRET</code> of the SutraFlow project (at least 32 characters). <a href="check.php">Check the setup</a>.</p>
  </div>
<?php endif; ?>
<?php if ($mixed): ?>
  <div class="card warn">
    <h2>The chat needs HTTPS</h2>
    <p>This page is on HTTPS but SutraFlow is set as <code><?= $h(SUTRAFLOW_URL) ?></code>; browsers block that. Give SutraFlow's gateway an HTTPS address and set it as <code>SUTRAFLOW_URL</code>.</p>
  </div>
<?php endif; ?>
<?php if (!$user): ?>
  <div class="card">
    <h2>Sign in</h2>
    <p class="muted">Demo accounts: <code>asha</code> / <code>asha-demo</code> (a customer with orders A-1001, A-1002 and A-0988) and <code>ravi</code> / <code>ravi-demo</code> (the support desk, every order).</p>
    <?php if ($error): ?><p class="err"><?= $h($error) ?></p><?php endif; ?>
    <form method="post">
      <label for="user">User name</label><input id="user" name="user" autocomplete="username" required>
      <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
      <button>Sign in</button>
    </form>
  </div>
<?php else: ?>
  <div class="card">
    <h2>Welcome, <?= $h($user['name']) ?></h2>
    <p>Open the <b><?= $h(SHOP_NAME) ?> help</b> button at the bottom right. Ask, for example:</p>
    <ul class="skills">
      <?php foreach ($skills as [$skill, $example]): ?><li><?= $h($skill) ?>: <i><?= $h($example) ?></i></li><?php endforeach; ?>
      <?php if ($user['role'] === 'support'): ?><li>Every order of a customer: <i>Orders of C-9</i></li><?php endif; ?>
    </ul>
    <p class="muted"><?= $user['role'] === 'support' ? 'As the support desk you see every order.' : 'As a customer you see only your own orders: try A-2001, which is someone else\'s.' ?></p>
  </div>
  <div class="card">
    <h2>How it works</h2>
    <p class="muted">The chat comes from SutraFlow at <code><?= $h(SUTRAFLOW_URL) ?></code>. Before each message it asks this website for a token (<code>token.php</code>): signed with the shared secret, it says who you are (<?= $h($user['sub']) ?>) and your role (<?= $h($user['role']) ?>), and lasts <?= CHAT_TOKEN_MINUTES ?> minutes. SutraFlow checks it and answers only for you.</p>
  </div>
  <script>
    // SutraFlow's chat button asks for the current login token; this page gets a fresh one from token.php.
    window.SutraChat = { token: () => fetch('token.php', { credentials: 'same-origin', cache: 'no-store' }).then(r => r.ok ? r.text() : '') };
  </script>
  <script src="<?= $h(SUTRAFLOW_URL) ?>/chat/<?= $h(rawurlencode(CHAT_AGENT)) ?>/widget.js" async></script>
<?php endif; ?>
</main>
</body>
</html>
