# Contributing to SutraFlow

Thank you for helping. Bug reports, ideas, documentation and code are all welcome.

## Licence and the CLA

SutraFlow is free under the [AGPL-3.0](LICENSE) and also offered under commercial licences ([COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)). So that every contribution can be offered both ways, code and documentation contributions need the [Contributor License Agreement](CLA.md): you keep your copyright, and your contribution is always published under the AGPL as well. Agree once, in your first pull request, with the comment given in the CLA. Pull requests without it cannot be merged.

## Reporting problems and ideas

- Search the issues first.
- For a bug: the SutraFlow version (shown in the top bar), the operating system, the database (SQLite or PostgreSQL), what you did, what you expected, and what happened, with the run id and the error message. Leave out secrets and personal data.
- Security problems: do not open a public issue; see [SECURITY.md](SECURITY.md).

## Making a change

1. Open or pick an issue, and say there that you are working on it.
2. Fork, then create a branch from `main` (`fix/sftp-timeout`, `feature/discord-threads`).
3. Set up: `npm install`, then `npm run dev` (studio with hot reload on http://localhost:5173).
4. Make the change with tests, then run:

   ```bash
   npm run typecheck
   npm test
   ```

5. Keep the documentation in step; the builds tell you what is missing:
   - a new activity needs its guide text in `tools/guide/activities.ts` (and a sample where it helps);
   - a new source file or database table needs a description for the architecture page (`tools/build-architecture.ts`, `tools/guide/tables.ts`);
   - user-facing changes go in the guide chapters (`tools/guide/chapters.ts`); rebuild with `npm run guide` and `npm run architecture`.
6. Open a pull request that says what changed, why, and how you tested it.

## Conventions

- TypeScript, in the style of the surrounding code; small functions with a comment where the reason is not obvious.
- Labels and messages in plain, short words; no product names of other vendors' integration tools.
- Every activity has an error output, a description, settings with help text, and a test.
- New connectors: activities register in `server/src/palettes/index.ts`, connection kinds in `server/src/resources.ts`; secrets are named, never stored in settings.
- Commit messages: a short summary line, then what and why.

## Code of conduct

Be kind and constructive. Disagree with ideas, not people.
