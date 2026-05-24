# @ank1015-app/ui

Shared React UI package used by the web and mobile app surfaces.

This package owns the product UI surface: cloud auth shell, `My Machines`,
machine workspace layout, filesystem browser, and agent chat/thread views.

## Responsibilities

- `CloudApp`: shared authenticated shell and machine selection flow.
- Cloud API client using bearer tokens.
- Login screen and machine inventory screens.
- Machine workspace with filesystem on the left and agent on the right.
- Filesystem WebSocket and agent REST/SSE client UI.
- Shared CSS exports for cloud and filesystem surfaces.

## Consumers

- `apps/web` renders `CloudApp`.
- `apps/mobile` uses the shared cloud client and product concepts.

## Commands

```sh
pnpm --filter @ank1015-app/ui typecheck
pnpm --filter @ank1015-app/ui build
```

## Notes

This package should stay runtime-agnostic. It should not directly import
Node, AWS, Docker, or cloud-server internals. Runtime-specific
behavior should be passed in through props.
