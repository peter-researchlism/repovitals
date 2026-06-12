# Healthy Fixture

A small, deliberately-healthy-looking Node/TypeScript repo used by RepoVitals tests.
It has:

- A `package.json` with a real `test` script.
- A `package-lock.json`.
- A `tests/` directory with one passing test.
- GitHub Actions workflow under `.github/workflows/`.
- Clean `src/` with a small, fully-connected module graph (no broken imports,
  no dead files, no TODO spam).
