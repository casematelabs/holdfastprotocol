# Contributing to Holdfast Protocol

Thank you for your interest in contributing to Holdfast Protocol.

## Important: Devnet Only

Holdfast Protocol is currently in **devnet-only** pre-release. All development, testing, and integration work targets Solana devnet. There is no mainnet deployment.

## Getting Started

1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Follow the [Quickstart Guide](docs/dev/quickstart.md) for local development setup

## Development Workflow

1. Create a feature branch from `master`
2. Make your changes with clear, focused commits
3. Ensure tests pass: `npm test`
4. Submit a pull request with a clear description of what changed and why

## Code Standards

- TypeScript for all SDK, indexer, oracle, keeper, and plugin code
- Rust for Solana programs (Anchor framework)
- Run `npm run typecheck` before submitting
- Follow existing code conventions in the file you are editing

## What We Accept

- Bug fixes with reproduction steps
- Documentation improvements
- Test coverage improvements
- SDK usability enhancements
- Eliza plugin improvements

## What Requires Discussion First

- New Solana program instructions or account layouts
- Breaking changes to SDK public API
- New runtime dependencies
- Architecture changes

Please open an issue to discuss before submitting a PR for these.

## Security

If you discover a security vulnerability, **do not open a public issue**. See [SECURITY.md](holdfast/SECURITY.md) for responsible disclosure instructions.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
