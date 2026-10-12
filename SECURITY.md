# Security

Please **don't** open a public issue for security problems. Report them privately through
[GitHub's security advisories](https://github.com/faridmasjedi/NomadMovie/security/advisories/new) instead.
You'll get an answer within a few days.

## What NomadMovie does with your data

- Your media and projects stay on your computer. The app runs a local engine that only listens on `127.0.0.1`.
- AI keys are saved only on your computer, in the app's settings file (readable only by your user account), and are sent only to the AI service you choose.
- When you use the AI assistant, a description of your project (and, if you ask about the picture, the current frame) is sent to that AI service. Nothing is sent when you use a local model (Ollama / LM Studio).
- AI subject selection (masks) runs entirely on your computer. The model is downloaded once from Hugging Face.
