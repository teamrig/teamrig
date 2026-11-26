# Build your own terminal host

teamrig opens each session in a terminal pane, brings it forward, and wakes it when urgent work comes in. Six
terminals are built in. Any other terminal, editor or multiplexer (a VS Code or JetBrains extension, iTerm, WezTerm,
kitty, your own pane manager) can take their place with no change to teamrig's code: you write a small **host
program** that speaks the terminal protocol, and the team's owner pins it. This guide is for the author of such a
host. The full design, with its reasons, is [the public interface](../design/public-interface.md#terminals-as-a-protocol).

*Coming: pinning a host in the team config and the owner's re-pin after a host update. The protocol below is the one
teamrig's client speaks today, and [the kit](#testing-your-host) tests a host against it now; a host built to it works
once pinning lands.*

- [What a host does](#what-a-host-does)
- [One request per run](#one-request-per-run)
- [The first request: capabilities](#the-first-request-capabilities)
- [The requests](#the-requests)
- [The rules a host keeps](#the-rules-a-host-keeps)
- [How teamrig runs your host](#how-teamrig-runs-your-host)
- [Pinning your host](#pinning-your-host)
- [Testing your host](#testing-your-host)
- [A tool that shows the team instead](#a-tool-that-shows-the-team-instead)

## What a host does

A host only does what a terminal does: it opens, focuses, closes, restarts, renames and lists panes, says whether a
pane is free, and delivers one wake message into a free pane. Everything else stays teamrig's: which session runs
where, whether and when to wake it (its priority, the budget, quiet hours), and every rule and guard. A host loads no
teamrig code and teamrig loads none of the host's: they talk through the protocol only, so a host can be written in
any language and live in its own repository.

## One request per run

teamrig runs your host program once per request. It writes one [JSON-RPC 2.0](https://www.jsonrpc.org/specification)
request, one line ending in a newline, to the program's standard input, and reads one answer, one JSON object, from
its standard output. Then the program ends. A host that fronts a running app (an editor extension, a terminal with its
own server) is a thin program that forwards the request over the app's own channel and prints the app's answer.

```json
{"jsonrpc":"2.0","id":2,"method":"focus","params":{"pane":"w3.p1"}}
```

```json
{"jsonrpc":"2.0","id":2,"result":{"kind":"done","interface":"1.0"}}
```

Every result carries `interface`, the interface version your host speaks, of teamrig's major (`1.x`). An answer is
refused when it is not one JSON-RPC 2.0 object, answers another `id`, holds no `result`, names no `1.x` version, or
is over 1 MiB. A JSON-RPC `error` reads as your host's failure, its `message` quoted. Fields teamrig does not know are
ignored, so a host may add its own.

## The first request: capabilities

teamrig's first request asks what your host serves, and it uses nothing the answer does not list:

```json
{"jsonrpc":"2.0","id":1,"method":"capabilities","params":{"interface":"1.5"}}
```

```json
{"jsonrpc":"2.0","id":1,"result":{"requests":["open","focus","close","rename","isIdle","list"],"interfaces":["1.0"],"seesDraft":false,"interface":"1.0"}}
```

| Field | Meaning |
| --- | --- |
| `requests` | The requests you serve, by the names below. One you leave out is never sent: teamrig answers it as unserved itself. A host without `deliver` gets no wakes; its sessions see new work at their next prompt |
| `interfaces` | The interface versions you speak, as `1.0` |
| `seesDraft` | Whether you can see a pane's input box. With `false`, teamrig treats your panes as never sure to be free of a person's unsent text |

## The requests

Each request's `params` and the `result` it answers. Any request may also answer `{"kind":"unserved"}` or
`{"kind":"failed","why":"<one line>"}`.

| Request | `params` | `result` |
| --- | --- | --- |
| `open` | `title`, `folder`, `argv` (the command as a list, never read by a shell), `window` (a named window, or `null`), `focus` (`take` or `keep`), `identity` (strings only), `wakeToken` | `{"kind":"opened","pane":"<your id>"}` |
| `split` | `title`, `folder`, `argv`, `focus`, `identity`, `wakeToken`: as `open`, with no `window`, since the pane opens beside the one the person works in | `{"kind":"split"}`: no pane id, since a split pane is not one a host can find again |
| `focus` | `pane` | `{"kind":"done"}`, or `{"kind":"gone"}` when the pane ended |
| `close` | `pane` | `done` or `gone` |
| `restart` | `pane`, `resume` (true: carry the conversation on) | `done` or `gone` |
| `rename` | `pane`, `title` | `done` or `gone` |
| `deliver` | `pane`, `token`, `text` | `{"kind":"delivered"}`, `{"kind":"held","why":"busy"}` (or `asking`, `draft`, `gone`), or `{"kind":"refused","why":"..."}` for a wrong token |
| `isIdle` | `pane` | `{"kind":"state","state":"idle"}`: one of `idle`, `busy`, `asking`, `draft`, `gone` |
| `list` | none | `{"kind":"listed","panes":[{"pane":"...","state":"idle","identity":{...}}]}` |

The pane states:

| State | Meaning |
| --- | --- |
| `idle` | No turn runs, no question shows and the input holds nothing unsent |
| `busy` | A turn runs |
| `asking` | The pane shows a question |
| `draft` | Someone typed into the input and has not sent it |
| `gone` | The pane ended |

## The rules a host keeps

- **Pane ids last.** The id `open` answers stays the same across your host's own restart; teamrig sends it back on
  every later request for that pane.
- **`list` reports, it never adopts.** List every pane you have. teamrig re-links only the pane ids it recorded
  itself; one it did not record goes to the owner, never becomes a session.
- **Deliver only into a free pane.** Check, in one step at the moment of delivery, that no turn runs, no question
  shows and the input holds nothing unsent; else answer `held` with the state. A held wake is asked again later; never
  queue it yourself.
- **One token per pane.** `open` gives the pane's `wakeToken`. Deliver only when `token` is exactly that pane's,
  else answer `refused`. The token allows a wake of that pane and nothing else.
- **Deliver teamrig's text only.** Type `text` as it came, then send it: it is teamrig's fixed message pointing the
  session at its inbox. Take no wake text from anything else.
- **The identity bag is a label.** Show or list it as you like; teamrig never reads a session's identity or role back
  from it.
- **A channel to a running app stays local.** Bind it to `127.0.0.1`, or a pipe or socket only the user can open.
- **Answer within 10 seconds**, and keep `why` texts to one short line: teamrig cuts a quote at 300 characters.

## How teamrig runs your host

- **By the exact bytes the owner pinned.** teamrig reads your program, checks its sha256 against the pin, and runs a
  private copy of those bytes, so the file cannot change between the check and the start. Your program therefore
  runs from teamrig's own folder, not from where you installed it: it must not load files that sit beside it. Ship it
  as one self-contained executable, or as a small launcher that finds its app by an absolute path or its own channel.
- **A file that no longer matches is not run.** After you ship an update, its new sha256 waits for the owner's re-pin;
  until then the host gets no requests and its sessions see new work at their next prompt.
- **No shell, a short environment.** The program runs with its pinned arguments only, and an environment of `PATH`,
  `SystemRoot`, `TEMP`, `TMP`, `TMPDIR`, `HOME`, `USERPROFILE` and `LANG`: never the GitHub key or any other teamrig
  credential.
- **Your answers are outside data.** Each is size-capped and checked field by field against the protocol; a `held` or
  `failed` reason is quoted, never acted on.

## Pinning your host

*Coming.* The team's owner names your host in the team config by its absolute path, its sha256 and its arguments;
only the owner sets them. After an update, `teamrig check` names your host and its new sha256, and one command that
only the owner runs shows the old and new hash and pins the new one. Tell your users to give the owner the sha256 of
the release they install.

## Testing your host

`teamrig conformance terminal` runs teamrig's terminal contract, the same cases every built-in terminal passes,
against your program through the protocol, run the way teamrig runs it (a private copy of the pinned bytes, the short
environment):

```sh
teamrig conformance terminal --program /opt/myterm/teamrig-host --sha256 <its sha256> --args serve
```

It prints `PASS` or `FAIL <case>: <why>` per case, `SKIP` for a case your operating system lacks, and exits 0 only
when every case passed. A host passes only with the negative cases too: `deliver` held in a busy pane, in one that
shows a question and in one holding a draft, refused with a wrong token, and a pane teamrig did not open listed but
never adopted.

### Kit mode: a fake terminal of your own

A case never believes an answer alone: after each request it reads what your terminal really did, and it puts panes
into states (a turn running, a question showing) as a person at them would. Your program serves that through six
extra requests, over a **fake terminal of its own**, never the real one, and only when started with `TEAMRIG_KIT` set.

- **`TEAMRIG_KIT` names a world.** Your program runs once per request, so keep each named fake terminal's panes
  between runs (a file in a folder of your own is enough); a name you have not seen is a new, empty terminal. The kit
  gives every case a new name, so nothing passes from one case to the next.
- **The normal requests go to that fake too** in kit mode: `open` adds a pane to it, `deliver` records the text,
  `isIdle` answers the state `kit.put` set.
- **Without `TEAMRIG_KIT`, answer every `kit.*` request `{"kind":"unserved"}`.** The kit checks this last, and prints
  `LEAK <request>` for each one served (a JSON-RPC error counts as one too): a host in production that served them
  would let any caller fake what its panes are.

| Request | `params` | `result` |
| --- | --- | --- |
| `kit.panes` | none | `{"panes":[{"pane":"...","title":"...","folder":"...","argv":[...],"window":null}]}`: every pane, oldest first; `window` is the named window, or `null` |
| `kit.front` | none | `{"pane":"<id>"}` for the pane in front, or `{"pane":null}` |
| `kit.put` | `pane`, `state` (`idle`, `busy`, `asking`, `draft`, `gone`) | `{"kind":"done"}` |
| `kit.openByHand` | `title` | `{"pane":"<id>"}`: a pane opened as a person would, which teamrig did not ask for |
| `kit.wakes` | `pane` | `{"texts":[...]}`: the wake texts delivered to it, oldest first |
| `kit.restarts` | `pane` | `{"resumes":[...]}`: one boolean per restart, oldest first, whether it was asked to resume |

Each `kit.*` result carries `interface` like any other. Until your fake is done, a case whose reads it cannot serve
fails with the request's name, so the kit can guide the work.

## A tool that shows the team instead

A program that shows the team's tasks or reacts to them (a sidebar, a dashboard, a pane like
[teamrig-pane](https://github.com/GeneralA6/teamrig-pane)) is not a host: it reads with `teamrig read <document>
--json` ([Every command](../commands.md)), the same documents and interface version a host's answers carry. Events
and acts for such tools come next, in the order [the design](../design/public-interface.md#order-of-work) sets.
