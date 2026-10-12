# Contributing to NomadMovie

Thanks for helping! Bug reports, ideas and pull requests are all welcome.

## Reporting a bug or asking for a feature

Open an [issue](https://github.com/faridmasjedi/NomadMovie/issues/new/choose). For bugs, say what you did, what you expected and what happened, plus your system and app version. A sample file or screen recording helps a lot.

Security problems: please report them privately — see [SECURITY.md](SECURITY.md).

## Making a change

Nobody pushes to `main` directly. Every change goes through a pull request:

1. **Fork** the repository and create a branch: `git checkout -b fix-audio-fade`.
2. Install and run it:
   ```bash
   npm install
   npm run dev      # http://localhost:5173, reloads as you edit
   ```
3. Make your change. Keep it focused — one fix or feature per pull request is easier to review.
4. Check it:
   ```bash
   npm run typecheck
   npm run build
   ```
5. Push your branch and **open a pull request** against `main`. Fill in the template: what changed, why, and how you tested it.

The CI checks run automatically on your pull request. The maintainer reviews it and may ask for changes; once it's approved and the checks pass, it gets merged.

## Code style

- TypeScript everywhere; keep `npm run typecheck` clean.
- Match the style of the code around your change: naming, comment density, small focused functions.
- UI text is in English, short and friendly.
- Rendering code must give identical results in the preview and the exported video — export uses the same `renderFrame`.
- New AI features should work with every provider (see `server/ai.ts`), or degrade gracefully when no AI is connected.

## For maintainers

Building test versions and publishing releases is described in [RELEASING.md](RELEASING.md).

## Project layout

See ["How it's built"](README.md#how-its-built) in the README.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
