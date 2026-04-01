# Contributing to DevClaw

Thank you for your interest in contributing to DevClaw!

## How to Contribute

### Reporting Issues

- [Open an issue](https://github.com/bsci83/devclaw-oss/issues/new) for bugs or feature requests
- Include steps to reproduce for bugs
- Check existing issues before creating duplicates

### Code Contributions

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes following the coding guidelines below
4. Run the type checker: `npm run compile-check-ts-native`
5. Run relevant tests: `scripts/test.sh --grep "your test pattern"` (or `scripts\test.bat` on Windows)
6. Commit with a clear message
7. Open a pull request

### Coding Guidelines

DevClaw inherits the VS Code coding standards:

- **Indentation**: Tabs, not spaces
- **Naming**: PascalCase for types/enums, camelCase for functions/variables
- **Strings**: Double quotes for user-facing (localized) strings, single quotes otherwise
- **Style**: Arrow functions over anonymous functions, always use curly braces for blocks
- **Disposables**: Register immediately after creation using `DisposableStore` or `MutableDisposable`
- **Imports**: No duplicates, no `any`/`unknown` unless absolutely necessary

See [.github/copilot-instructions.md](.github/copilot-instructions.md) for the full guide.

### DevTeam Contribution Area

The DevClaw-specific code lives in `src/vs/workbench/contrib/devteam/`. When working in this area:

- Follow the existing editor pattern (see `editors/*.ts` for examples)
- Use VS Code's dependency injection — services go in constructor parameters
- Register contributions via `registerWorkbenchContribution2`
- All user-facing strings must be localized with `nls.localize()`

## Code of Conduct

Be respectful. We're building tools for developers, by developers. Constructive feedback is welcome; hostility is not.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE.txt).
