---
name: dev-add-adapter
description: Add or grow a teamrig adapter (connector, AI CLI host, terminal) behind its interface, nothing tied to one machine, every user choice supported, with conformance specs and docs.
---

# Add or grow an adapter

An adapter is how teamrig reaches an outside tool: a connector (an issue tracker or code host such as GitHub or Jira),
a host (an AI CLI such as Claude Code or Codex CLI) or a terminal (Windows Terminal, tmux). Every user of that tool
gets it, so it is generic by its nature (CONTRIBUTING.md, Where a change lives), and three rules hold it:

- **Behind the interface.** The adapter answers teamrig's ports and nothing else: the rest of teamrig never imports
  it, and it imports only its own folder and the plugin API (`src/plugin-api/index.ts`). A need the ports lack is a
  change to the port, its feature rows and its conformance contract first, in its own commit, never a side door.
- **Nothing tied to one environment.** No path, account, site, project, login, host name or tool version of one user
  in code, defaults, tests or docs: those come from the team config, the environment the deps hand in, or the tool's
  own answer at run time. Tests use the fakes' invented sites and accounts (`acme`, `someone@example.com`).
- **The user decides.** Support each way a user of that tool may choose to work, never only the one this team uses:
  every sign-in kind the tool offers (a Jira site takes a scoped token, a classic token or OAuth, each chosen per
  site), each permission mode, each layout. Pick a safe default that suits a team that never set it; a riskier
  choice stays the user's opt-in, with security's warning where it weakens a guard (the permission mode defaults to
  auto, bypass only when the user turns it on). A choice not built yet is a `partial` or `unsupported` row with its
  notice, never a refusal to let the user pick it.

1. Read the side's API and one adapter of it: a connector `src/plugin-api/connector.ts` (`defineConnector`) and
   `src/adapters/connectors/jira/`; a host `src/plugin-api/host.ts` (`defineHost`) and
   `src/adapters/hosts/codex-cli/`; a terminal `src/plugin-api/terminal.ts` and `src/adapters/terminals/tmux/`.
2. The folder `src/adapters/{connectors,hosts,terminals}/<id>/` with `declaration.ts` and an `index.ts` whose default
   export is the define call, and its row in `src/composition/adapters.ts`, the one table that names adapters: a new
   adapter is a folder and a row.
3. Every port of the side is answered. One not built yet answers `unsupported('not built for <tool> yet')`, as
   `src/adapters/hosts/codex-cli/index.ts` does; a host's ports are in `src/ports/host`.
4. The manifest in `declaration.ts` says each feature id of the side (`src/features`): `supported` with its proofs,
   `partial` with what is missing and its notice, or `unsupported` with its notice. A built row starts `supported`
   with no proofs; it names a proof only once a live run on the real tool is recorded under the feature id's
   heading in `docs/proofs` (`docs/proofs/codex-cli.md`). A new feature id goes in its group file under
   `src/features` first.
5. A connector's settings live in the team config's `connectors.<id>` section, owner-only. List each key with its
   one line in the declaration's `configKeys`, read and check them in `parseConfig` (example
   `src/adapters/connectors/jira/config.ts`), and give each a default a team that never set it gets: leaving a key out
   must work, and a default never floods (an import's default scope stays narrow). A setting every adapter of a side
   shares is a team config key instead, with `dev-add-config-key`.
6. Reach the outside only through the deps the define call hands in: `run` for a program (by its absolute path,
   capped), `http` (https only, no redirects), `credentials` for a secret, `env`. A secret is never read from a file
   path the adapter picks, printed, or put in a test.
7. Specs beside the code, over the fakes in `src/testing`: `connectorDeps`, `hostDeps` and `portsOf` in
   `src/testing/adapter-deps.ts`, `src/testing/fake-http.ts`, `src/testing/fake-credentials.ts`, and a world for the
   tool (`src/testing/jira-world.ts`). The adapter's `contracts.test.ts` runs the conformance kit (`src/conformance`)
   with `describeContracts` (`src/testing/contracts.ts`) and one `bind` per contract it serves; a case it cannot hold
   goes in `without` with the reason, which the manifest row says too (example
   `src/adapters/connectors/jira/contracts.test.ts`). Each user choice from the rules above gets its own case.
8. Docs: `npm run docs:parity` redraws `docs/parity.md` from the manifests; the adapter's proof page; the guide or
   README line naming the tools teamrig supports; `dev-update-docs` for the rest. An outside builder's terminal host
   follows `docs/guides/build-a-terminal-host.md`, which changes with any terminal contract change.
9. `npm run check`, then land it with `dev-ship-change` as a `feat` commit, the area its id. The pull request's
   `## Reach` says which users get it; the owner of that side's area reviews its part.

## Traps

- `tools/ci/boundaries.json` counts the boundary findings, and a count may never rise: an adapter importing outside
  its folder and the plugin API, shipped code importing an adapter, and a tool's name written outside `src/adapters`
  and `src/composition` each fail `npm run check`. Keep the tool's name in the adapter; the rest says the port.
- `tools/ci/provider-words.json` counts provider words per file the same way; `node tools/ci/provider-words-cli.ts
  --write` records a fall and refuses a rise.
- The dist smoke loads every adapter through the built loader (`tools/ci/adapter-smoke.ts`): an import the bundle
  cannot follow fails only there or live, so run the full check, not the specs alone.
- A row claimed `supported` with a proof that was never run on the real tool is a false claim users plan on; a port
  built while its contract cannot bind stays `unsupported` and names that port.
- An option that works only on this team's machine (one OS, one shell, one install path) is not built yet for the
  rest: say it in the row's notice, and prove it per OS before claiming it.

Last verified: 2026-11-28
