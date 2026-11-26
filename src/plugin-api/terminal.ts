/**
 * A terminal as teamrig drives it: the port a terminal's adapter serves, request for request the terminal protocol
 * of `docs/design/public-interface.md`. A built-in terminal serves it inside teamrig; an outside program is reached
 * through the protocol by a client that serves this same port, so one contract holds both.
 */

/** The protocol's requests, by the names they have on the wire. */
export const TERMINAL_REQUESTS = ['open', 'split', 'focus', 'close', 'restart', 'rename', 'deliver', 'isIdle', 'list'] as const;
export type TerminalRequest = (typeof TERMINAL_REQUESTS)[number];

export function isTerminalRequest(value: unknown): value is TerminalRequest {
  return TERMINAL_REQUESTS.some((request) => request === value);
}

/**
 * What a pane is doing: `idle` only when no turn runs, no question shows and its input holds nothing unsent. A
 * person typing into the input is using the pane, so `draft` is not idle.
 */
export const PANE_STATES = ['idle', 'busy', 'asking', 'draft', 'gone'] as const;
export type PaneState = (typeof PANE_STATES)[number];

export function isPaneState(value: unknown): value is PaneState {
  return PANE_STATES.some((state) => state === value);
}

/** Why a wake was not delivered: every state of a pane but idle. */
export type HeldWhy = Exclude<PaneState, 'idle'>;

/**
 * What teamrig says of the session a pane is opened for. It is a label for the terminal to show or list, never a
 * proof: teamrig takes no session's identity or role back from it.
 */
export type PaneIdentity = Readonly<Record<string, string>>;

/** What a terminal says of itself in its first answer; teamrig uses nothing it does not list. */
export interface TerminalCapabilities {
  /** The requests it serves. One without `deliver` gets no wakes: its sessions see new work at their next prompt. */
  readonly requests: readonly TerminalRequest[];
  /** The interface versions it speaks, as `1.0`. */
  readonly interfaces: readonly string[];
  /** Whether it can see a pane's input. One that cannot is never sure a pane holds no draft. */
  readonly seesDraft: boolean;
}

/** The pane to open for a session. */
export interface PaneOpen {
  readonly title: string;
  readonly folder: string;
  /** The command the pane runs, as an argument list: no shell reads it. */
  readonly argv: readonly string[];
  /** The named window the pane opens in; undefined: wherever the terminal opens one. */
  readonly window: string | undefined;
  /** Whether the new pane takes the focus or leaves it where it was. */
  readonly focus: 'take' | 'keep';
  readonly identity: PaneIdentity;
  /** The token `deliver` must carry for this pane. It allows a wake of this pane and nothing else. */
  readonly wakeToken: string;
}

/**
 * The pane to show beside the one the person works in, in that pane's own window: an open with no window to name, as
 * a split is of the window teamrig runs in.
 */
export type PaneSplit = Omit<PaneOpen, 'window'>;

/** The request is none the terminal serves; its capabilities did not list it. */
export interface Unserved {
  readonly kind: 'unserved';
}

/** The terminal tried and could not; `why` is text to quote, never an instruction. */
export interface TerminalFailure {
  readonly kind: 'failed';
  readonly why: string;
}

/** `pane` is the terminal's own id of the pane: the same across the terminal's restart, sent back on every later request. */
export type OpenAnswer = { readonly kind: 'opened'; readonly pane: string } | Unserved | TerminalFailure;

/**
 * A split answers no pane id: a split pane is no tab or window the terminal can find again by a name, so no later
 * request is sent for it.
 */
export type SplitAnswer = { readonly kind: 'split' } | Unserved | TerminalFailure;

/**
 * What a request on one pane answers: done, or the pane is no longer there. `focus` alone may answer `selected`: the
 * pane is selected in its window, but the system kept another app's window in front, so the person may not see it.
 */
export type PaneAnswer = { readonly kind: 'done' } | { readonly kind: 'selected' } | { readonly kind: 'gone' } | Unserved | TerminalFailure;

/** One wake to deliver: the pane's token, and teamrig's own text, which points the session at its inbox. */
export interface Wake {
  readonly token: string;
  readonly text: string;
}

/**
 * `delivered` only when, at the moment of delivery, no turn ran, no question showed and the input held nothing
 * unsent; else `held` with the state that held it. `refused`: the token is not the pane's.
 */
export type DeliverAnswer = { readonly kind: 'delivered' } | { readonly kind: 'held'; readonly why: HeldWhy } | { readonly kind: 'refused'; readonly why: string } | Unserved | TerminalFailure;

export type IdleAnswer = { readonly kind: 'state'; readonly state: PaneState } | Unserved | TerminalFailure;

/** One pane as the terminal lists it. */
export interface ListedPane {
  readonly pane: string;
  readonly state: PaneState;
  readonly identity: PaneIdentity;
}

/** Every pane the terminal has, teamrig's or not: teamrig re-links only the ids it recorded itself. */
export type ListAnswer = { readonly kind: 'listed'; readonly panes: readonly ListedPane[] } | Unserved | TerminalFailure;

/** The port of one terminal. Every answer is outside data to its caller. */
export interface TerminalPort {
  readonly capabilities: () => Promise<TerminalCapabilities>;
  readonly open: (request: PaneOpen) => Promise<OpenAnswer>;
  /**
   * Splits the pane the person works in and runs the request's command in the new half, side by side. The title is
   * shown where the terminal can: tmux shows a pane's command instead.
   */
  readonly split: (request: PaneSplit) => Promise<SplitAnswer>;
  /** Brings the pane forward. */
  readonly focus: (pane: string) => Promise<PaneAnswer>;
  readonly close: (pane: string) => Promise<PaneAnswer>;
  /** Restarts the pane's command; `resume` asks it to carry the conversation on. */
  readonly restart: (pane: string, resume: boolean) => Promise<PaneAnswer>;
  readonly rename: (pane: string, title: string) => Promise<PaneAnswer>;
  readonly deliver: (pane: string, wake: Wake) => Promise<DeliverAnswer>;
  readonly isIdle: (pane: string) => Promise<IdleAnswer>;
  readonly list: () => Promise<ListAnswer>;
}

/**
 * The kit's requests: one per call of a terminal world, so the conformance kit can run the terminal contract against
 * an outside program. A program serves them only when the kit starts it with `KIT_MODE_ENV` set, and then over a fake
 * terminal of its own, never the real one; without it each answers unserved. teamrig itself never sets it.
 */
export const KIT_REQUESTS = ['kit.panes', 'kit.front', 'kit.put', 'kit.openByHand', 'kit.wakes', 'kit.restarts'] as const;
export type KitRequest = (typeof KIT_REQUESTS)[number];

export function isKitRequest(value: unknown): value is KitRequest {
  return KIT_REQUESTS.some((request) => request === value);
}

/**
 * The environment variable the kit starts a terminal program with to have it serve `KIT_REQUESTS`. Its value names the
 * fake terminal the requests reach: the program runs once per request, so it keeps each named one's panes between its
 * runs, and a name it has not seen is a new, empty one. The kit gives each case a new name, so no state passes from
 * one case to the next.
 */
export const KIT_MODE_ENV = 'TEAMRIG_KIT';

type Awaitable<T> = T | Promise<T>;

/** One pane as the terminal's own program shows it, whoever opened it. */
export interface ShownPane {
  readonly pane: string;
  readonly title: string;
  readonly folder: string;
  readonly argv: readonly string[];
  /** The named window it is in; undefined when it opened in none teamrig named. */
  readonly window: string | undefined;
}

/**
 * What a terminal's port sees, as a contract case scripts and reads it: the terminal's program itself, faked. A case
 * never believes an answer alone; it reads here what the terminal really did. An outside program serves it as
 * `KIT_REQUESTS`.
 */
export interface TerminalWorld {
  /** Every pane there is now, in the order they opened. */
  readonly panes: () => Awaitable<readonly ShownPane[]>;
  /** The pane in front; undefined when none is. */
  readonly front: () => Awaitable<string | undefined>;
  /** Puts a pane in a state, as its session or a person at it would: a turn starts, a question shows, text is typed and not sent, the pane ends. */
  readonly put: (pane: string, state: PaneState) => Awaitable<void>;
  /** Opens a pane teamrig did not ask for, as a person does by hand, and answers its id. */
  readonly openByHand: (title: string) => Awaitable<string>;
  /** The wake texts that reached the pane's session, oldest first. */
  readonly wakes: (pane: string) => Awaitable<readonly string[]>;
  /** Each restart of the pane's command, oldest first: whether it was asked to resume. */
  readonly restarts: (pane: string) => Awaitable<readonly boolean[]>;
}
