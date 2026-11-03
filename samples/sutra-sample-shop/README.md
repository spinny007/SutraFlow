# Sutra Sample Shop

An example shop website in PHP with its own sign-in and a **SutraFlow chat button** for the person signed in. It goes with the SutraFlow sample **Chat for customers and support** (agent `shop-help`).

Version 2.1.5, for SutraFlow 2.1.5 or later.

## What the chat can do

| Skill | Ask, for example |
|---|---|
| Order status | *Where is A-1001?* |
| Tracking a parcel | *Track my order* |
| Returns and refunds | *I want to return A-0988* |
| Invoices | *Send the invoice for A-1001* |
| Delivery address | *Change the address of A-1002* |
| Products, prices and stock | *Do you have green tea?* |
| A person from the support desk | *Talk to a person* |

Customers see only their own orders; asking about someone else's order is refused. The support desk sees every order and every order of a customer (*Orders of C-9*). Demo accounts:

- `asha` / `asha-demo`: a customer with orders A-1001 (shipped), A-1002 (packing) and A-0988 (delivered, can be returned)
- `ravi` / `ravi-demo`: the support desk

## How it works

1. A person signs in on the website (here: the two demo accounts in `config.php`; on a real site, its own login or single sign-on).
2. Before each chat message, SutraFlow's chat button asks the page for a token. The page gets one from `token.php`: a JWT signed with HMAC-SHA256 and a secret shared with SutraFlow, valid for 15 minutes, saying who the person is (`sub`, `name`) and their role (`customer` or `support`).
3. The agent's security policy (*Sample chat website sign-in*) checks the signature, issuer, audience, scope and expiry. A missing or wrong token is refused, so only the website's signed-in people can chat.
4. The agent reads the person and the role from the token, never from the message text, chooses a skill and answers.
5. Each answer carries a conversation token that continues the conversation for that person only, for 8 hours.

The chat button and the chat come straight from SutraFlow to the visitor's browser; this website only issues the tokens. SutraFlow can run on the same computer or on another server.

## Requirements

- PHP 8.0 or later with any web server (Laragon, XAMPP, Apache, nginx with PHP-FPM, IIS with PHP). No database, no Composer packages.
- SutraFlow 2.1.5 or later, reachable from the visitors' browsers.

## Install

### 1. In SutraFlow

1. Open a project (or make one, such as *Chat example*), choose **New Sutra**, **Samples**, tick **Chat for customers and support** and add it.
2. Make a long random secret, at least 32 characters, for example with `php -r "echo bin2hex(random_bytes(32));"`.
3. In the project, **Configuration**, **Project variables**, set the value of the Secret property `CHAT_SITE_SECRET` to that secret.
4. Deploy **Sample: Customer and support chat**. The chat is now at `<gateway address>/chat/shop-help`, and refuses everyone without a website token.

### 2. The website

1. Unzip `sutra-sample-shop.zip` into the web server's folder, for example:
   - Laragon: `C:\laragon\www\sutra-sample-shop`
   - XAMPP: `C:\xampp\htdocs\sutra-sample-shop`
   - Linux: `/var/www/html/sutra-sample-shop`
2. Copy `config.local.example.php` to `config.local.php` and set:
   - `CHAT_SECRET`: the same secret as `CHAT_SITE_SECRET` in SutraFlow;
   - `SUTRAFLOW_URL`: SutraFlow's gateway address as the visitors' browsers reach it (see below).

   Instead of the file, you can set environment variables with the same names on the web server; they win over `config.local.php`.
3. Open `http://localhost/sutra-sample-shop/check.php`: every line should show a tick.
4. Open `http://localhost/sutra-sample-shop/`, sign in as `asha` / `asha-demo` or `ravi` / `ravi-demo`, and use the chat button at the bottom right.

## SutraFlow on this computer or on another server

`SUTRAFLOW_URL` decides which SutraFlow the chat uses:

| SutraFlow runs | `SUTRAFLOW_URL` |
|---|---|
| On this computer | `http://127.0.0.1:8080` (the default gateway port) |
| On another server | its gateway address, such as `https://sutra.example.com` |

For a SutraFlow on another server:

- Add the sample and set `CHAT_SITE_SECRET` **in that SutraFlow**, and deploy the agent there.
- Its gateway must be reachable from the visitors' browsers (a firewall, a reverse proxy or a load balancer in front is fine). `check.php` tests from the web server; an address such as `127.0.0.1` works only on the same computer.
- When the website runs on HTTPS, SutraFlow's gateway must have an HTTPS address too, or browsers block the chat. Then turn **Require HTTPS** on in the policy *Sample chat website sign-in*.
- Nothing else changes: the token is made by this website and checked by that SutraFlow with the shared secret.

## For a real website

- Keep the secret in an environment variable or `config.local.php`, never in version control; change it in both places at once.
- Issue tokens only to signed-in people, with a short life (minutes), and only from your own pages.
- With an identity provider (Microsoft Entra ID, Okta, Auth0, Keycloak, Cognito), skip `token.php`: give the chat button the access token the provider issued, and set the policy to JWT with the provider's JWKS address, issuer and audience instead of a shared secret.
- Replace the demo orders and products in the Sutra (step *Shop data*) with SQL queries or HTTP requests to your shop, and each skill with your own logic or an AI tool Sutra.
- Remove `check.php` once the chat works.

## Troubleshooting

| What you see | What to do |
|---|---|
| No chat button | `SUTRAFLOW_URL` is wrong, SutraFlow is not running, or the agent is not deployed: open `check.php`. |
| "Please sign in" in the chat, or 401 | The secret differs between `config.local.php` and `CHAT_SITE_SECRET`, or the issuer or audience was changed on one side only. |
| "Set up the chat first" on the page | `CHAT_SECRET` is not set or is shorter than 32 characters. |
| The chat is blocked on an HTTPS page | Give SutraFlow's gateway an HTTPS address and use it as `SUTRAFLOW_URL`. |

## Files

| File | What it does |
|---|---|
| `index.php` | The shop page: sign-in, the chat button for the signed-in person |
| `token.php` | Issues the signed chat token for the person signed in |
| `logout.php` | Signs out |
| `config.php` | Reads the settings (do not edit) |
| `config.local.example.php` | Copy to `config.local.php` and set your values |
| `check.php` | Setup check |

## Licence

GNU Affero General Public License v3.0 only (AGPL-3.0-only); see `LICENSE`. A commercial licence is available from the author of SutraFlow (MixAgile.com).
