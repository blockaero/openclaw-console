# openclaw-console

Scaffolding for a tool-less OpenClaw `arm-ro` profile and an option B read-only smoke against ARM.

Nothing here calls ARM, mints a key, or talks to the Ops console. The guard starts halted. The smoke stays blocked until ARM ships a real read-only level whose `initialize` handshake writes at most one server-generated last-seen timestamp. The client does not send briefing or processing writes.

```bash
npm test
npm run smoke
```

How the smoke runs after that ARM level exists: [docs/smoke-after-arm.md](docs/smoke-after-arm.md).

Profile direction, not an applied config: [profiles/arm-ro/](profiles/arm-ro/README.md).
