# Security

Please **don't** open a public issue for security problems. Report them privately through
[GitHub's security advisories](https://github.com/faridmasjedi/NomadMovie/security/advisories/new) instead.
You'll get an answer within a few days.

## What NomadMovie does with your data

- Your media and projects stay on your computer. The app runs a local engine that only listens on `127.0.0.1`.
- AI keys are saved only on your computer, in the app's settings file (readable only by your user account), and are sent only to the AI service you choose.
- When you use the AI assistant, a description of your project (and, if you ask about the picture, the current frame) is sent to that AI service. Nothing is sent when you use a local model (Ollama / LM Studio).
- AI subject selection (masks) runs entirely on your computer. The model is downloaded once from Hugging Face.

## How the app protects you

- **Local engine locked to the app.** The engine refuses requests from other websites (checked with the `Origin`, `Sec-Fetch-Site` and `Host` headers), so a web page open in your browser can't use it, even through DNS rebinding. It can't be shown inside another page's frame either.
- **Safe file import.** Imported files are read as local media only: ffmpeg is limited to local files, and playlists or file lists that point at other files or web addresses are refused.
- **No code in animations.** Lottie files are played without expressions (JavaScript embedded in the file), and SVG graphics are drawn as images, so scripts inside them never run.
- **Keys stay put.** A saved API key is only sent to the service it was saved for. Testing a different address in Settings never sends the saved key there.
- **Locked-down window.** The app window has no Node.js access and runs sandboxed with context isolation. It only shows the editor: other links open in your browser, and only `http`/`https` links are opened.
- **Up-to-date engine.** Electron (and its Chromium) is kept on a supported version. Dependabot watches the dependencies.
