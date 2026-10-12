# Building and releasing

These steps need write access to the repository, so only maintainers can run them.

## Test builds (no release)

**Actions → Build app → Run workflow.** It builds macOS (Apple Silicon and Intel), Windows and Linux.
When it finishes, the run's page has one download per system (`NomadMovie-mac-arm64`, `NomadMovie-windows-x64`, …),
each containing the installer and a plain zip. Downloads need a GitHub login and are kept for 30 days, which makes
them good for testing but not for sharing with users. Use a release for that.

## Publishing a release

1. **Actions → Release → Run workflow**, enter the new version (for example `1.2.0`) and run it.
   Or push a tag: `git tag v1.2.0 && git push origin v1.2.0`.
2. The workflow tags the commit, builds every system and publishes a GitHub Release with:
   - macOS: `.dmg` and `.zip` for Apple Silicon (`arm64`) and Intel (`x64`)
   - Windows: `setup.exe` installer and a portable `.zip`
   - Linux: `.AppImage`, `.deb` and `.zip`
   - release notes generated from the merged pull requests
3. Versions with a suffix (`1.3.0-beta.1`) are marked as pre-releases.

Anyone can download release files without a GitHub account, from
<https://github.com/faridmasjedi/NomadMovie/releases/latest>.

## Signing (optional)

Without signing, macOS asks users to right-click → **Open** the first time, and Windows shows a SmartScreen warning.
To sign, add these repository secrets (**Settings → Secrets and variables → Actions**). Both workflows use them
automatically:

| Secret | What it is |
| --- | --- |
| `MAC_CSC_LINK` | Apple "Developer ID Application" certificate, exported as .p12 and base64-encoded |
| `MAC_CSC_KEY_PASSWORD` | Password of that .p12 |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | For notarization, so macOS opens the app without any warning |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows code-signing certificate (.pfx, base64) and its password |

Secret values are encrypted by GitHub and never shown in logs or to people who open pull requests.
