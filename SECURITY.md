# Security policy

## Reporting a vulnerability

Please report security problems **privately**, not in a public issue: use GitHub's **Report a vulnerability** (Security tab of the repository, private vulnerability reporting), or contact the maintainer through [mixagile.com](https://mixagile.com).

Include what is affected (version, component), how to reproduce it, and the impact you see. You will get an answer within a few working days; once a fix is released, the report can be made public with credit to you if you wish.

## Supported versions

Security fixes go into the latest release. Commercial licence holders receive fixes for the versions their agreement covers.

## How SutraFlow protects data

- Secrets are encrypted with AES-256-GCM using the master key (`data/master.key` or `SUTRA_MASTER_KEY`), never returned by the API, and masked in outputs and logs.
- The studio listens on 127.0.0.1 by default, with HttpOnly SameSite cookies, a CSRF guard, throttled sign-in, roles per project and an audit log of every change.
- Services on the gateway are protected by API security policies (API keys, gateway apps, JWT, mutual TLS, WS-Security, IP allow lists, rate limits) and TLS.
- Script activities are off until an administrator allows them; values reach scripts as data, never as script text.

See the user guide's *Secrets and studio security*, *The API gateway* and *Exposing APIs* chapters for configuration.
