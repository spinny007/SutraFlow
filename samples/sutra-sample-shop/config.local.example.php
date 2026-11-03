<?php
// Copy this file to config.local.php and set your values. config.local.php is never shipped or committed
// (see .gitignore), so updating the website does not overwrite it. Environment variables with the same
// names win over this file.
return [
    // SutraFlow on this computer:
    'SUTRAFLOW_URL' => 'http://127.0.0.1:8080',
    // SutraFlow on another server (use HTTPS when this website is on HTTPS):
    // 'SUTRAFLOW_URL' => 'https://sutra.example.com',

    // The same text as the Secret property CHAT_SITE_SECRET of the SutraFlow project, at least 32 characters.
    // Make one with: php -r "echo bin2hex(random_bytes(32));"
    'CHAT_SECRET' => '',

    // Only change these when you changed the agent or its policy in SutraFlow.
    // 'CHAT_AGENT' => 'shop-help',
    // 'CHAT_ISSUER' => 'sutra-sample-shop',
    // 'CHAT_AUDIENCE' => 'shop-help',
    // 'CHAT_TOKEN_MINUTES' => 15,
    // 'SHOP_NAME' => 'Sutra Sample Shop',
];
