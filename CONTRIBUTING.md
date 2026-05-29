# Contributing

**Version:** v0.1
**Status:** Approved (v0.1)
**Last updated:** 2026-05-29

## Changelog

| Version | Date | Author | Changes |
|---|---|---|---|
| v0.1 | 2026-05-29 | Human Approved | Initial contributing guide stub |

---

Tokenmaxx is an early-stage project. Contributions are welcome — please read this first.

---

## Before you open a PR

- Check the existing issues to see if your change is already being tracked
- For anything beyond a small bug fix, open an issue first to discuss the approach
- The roadmap in [docs/ROADMAP.md](docs/ROADMAP.md) shows what's planned — check if your feature fits

---

## Code style

- TypeScript for all new scripts and Edge Functions
- `biome` for formatting and linting (`npx biome check .`)
- Run `npm test` before submitting — failing tests block merge

---

## Database migrations

- All schema changes go in `migrations/NNN_<slug>.sql`
- Number sequentially from the last migration
- Migrations must be idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, etc.)
- RLS policies go in a dedicated migration file, not inlined in schema migrations

---

## PR process

1. Fork the repo and create a branch from `main`
2. Make your changes with descriptive commits
3. Open a PR against `main`
4. Fill in the PR template — describe what changes and why
5. A maintainer will review; expect at least one round of feedback

---

## Issue templates

Use the GitHub issue templates for:
- Bug reports
- Feature requests
- Documentation gaps

---

## Security

Do not open public issues for security vulnerabilities. Email the maintainer directly (address in the GitHub profile). We aim to acknowledge security reports within 48 hours.

---

## License

By contributing, you agree that your contributions are licensed under the MIT license (see [LICENSE](LICENSE)).
