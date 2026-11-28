function provedWin(heading, date) {
    return {
        kind: 'supported',
        proofs: [
            {
                os: 'windows',
                toolVersion: '1.5.14',
                date,
                evidence: `proofs/antigravity-cli.md#${heading}`,
            },
        ],
    };
}
const WIN_PERM_PROOF = {
    os: 'windows',
    toolVersion: '1.5.14',
    date: '2026-11-24',
    evidence: 'proofs/antigravity-cli.md#permissionsdeny-lines',
};
const WIN_TRANSCRIPT_PROOF = {
    os: 'windows',
    toolVersion: '1.5.14',
    date: '2026-11-24',
    evidence: 'proofs/antigravity-cli.md#budgettranscripts',
};
const WIN_USAGE_PROOF = {
    os: 'windows',
    toolVersion: '1.5.14',
    date: '2026-11-24',
    evidence: 'proofs/antigravity-cli.md#budgetusage',
};
const UNPROVED = {
    kind: 'partial',
    missing: 'no live run yet',
    notice: 'built against Antigravity docs; no live agy run has proved it yet',
    proofs: [],
};
const PROMPT_SECRET = {
    kind: 'partial',
    missing: 'PreInvocation cannot take back a prompt that was already typed',
    notice: 'blocks the turn before the model runs, but cannot remove the prompt from history',
    proofs: [],
};
const NOT_YET = (what) => ({ kind: 'unsupported', notice: `${what} is not built yet` });
const NO_HOST_SUPPORT = (what) => ({ kind: 'unsupported', notice: `Antigravity has no ${what}` });
export const declaration = {
    apiVersion: '0.2.0',
    id: 'antigravity-cli',
    name: 'Antigravity CLI',
    steps: ['host.hooks-file'],
    sessionVariables: {
        marks: ['ANTIGRAVITY_CONVERSATION_ID'],
        identity: ['ANTIGRAVITY_CONVERSATION_ID'],
    },
    manifest: {
        'rules.session-start': UNPROVED,
        'rules.instruction-files': UNPROVED,
        'rules.rules-folder': UNPROVED,
        'rules.memory': NO_HOST_SUPPORT('per-project memory index'),
        'rules.start-size': UNPROVED,
        'inbox.prompt-line': UNPROVED,
        'context.compact-hold': NO_HOST_SUPPORT('PreCompact hook'),
        'context.size': NOT_YET('transcript context sizing'),
        'context.refresh': NO_HOST_SUPPORT('in-tab /clear mod'),
        'hooks.pretool-guard': UNPROVED,
        'hooks.file-guard': UNPROVED,
        'hooks.exec-review': UNPROVED,
        'hooks.readonly-allow': UNPROVED,
        'hooks.ask-refuse': UNPROVED,
        'hooks.permission-refuse': NO_HOST_SUPPORT('PermissionRequest hook'),
        'hooks.output-redact': NOT_YET('PreToolUse overwrite redact-exec wrapper'),
        'hooks.prompt-secret': PROMPT_SECRET,
        'hooks.tool-failure': UNPROVED,
        'permissions.deny-lines': {
            kind: 'partial',
            missing: 'pattern wildcards in read_file() and command(), subfolder globbing, ~ expansion in read_file(), and prefix allow rules',
            notice: 'agy 1.5.14 blocks root/full-path read_file(<file>) and exact command(<cmd>); bare command(*) matches in allow, but path/pattern wildcards (*, **), ~, and trailing-* rules do not fire on 1.5.14',
            proofs: [WIN_PERM_PROOF],
        },
        'permissions.auto-mode-routes': NO_HOST_SUPPORT('Claude Code auto-mode routes'),
        'sessions.open': NO_HOST_SUPPORT('terminal tab launching'),
        'sessions.resume': NO_HOST_SUPPORT('terminal tab resume'),
        'sessions.identity': UNPROVED,
        'sessions.wake': NO_HOST_SUPPORT('in-tab wake mod'),
        'sessions.turn-end': UNPROVED,
        'sessions.process': NO_HOST_SUPPORT('tab process tracking'),
        'sessions.in-tab': NO_HOST_SUPPORT('in-tab JS mod'),
        'sessions.carry': NO_HOST_SUPPORT('in-tab refresh carry'),
        'sessions.effort-writeback': NO_HOST_SUPPORT('effort level hook field'),
        'tabs.title-status': NO_HOST_SUPPORT('terminal tab title sequences'),
        'tabs.waiting-state': NO_HOST_SUPPORT('terminal tab waiting circles'),
        'tabs.memory': NO_HOST_SUPPORT('terminal tab memory tracking'),
        'wake.api-retry': NO_HOST_SUPPORT('StopFailure hook'),
        'wake.cost': NO_HOST_SUPPORT('in-tab wake cost tracking'),
        'skills.plugin': UNPROVED,
        'skills.team': UNPROVED,
        'skills.session-listing': UNPROVED,
        'helpers.start-rules': UNPROVED,
        'helpers.agent-types': UNPROVED,
        'plugin.hooks-file': provedWin('pluginhooks-file', '2026-11-25'),
        'plugin.hook-trust': UNPROVED,
        'plugin.install-update': NO_HOST_SUPPORT('in-tab plugin reload mod'),
        'plugin.cli-on-path': UNPROVED,
        'budget.transcripts': {
            kind: 'partial',
            missing: 'helper/subagent thread split and disk discovery outside hook transcriptPath',
            notice: 'reads agy transcript_full.jsonl steps (USER_INPUT, PLANNER_RESPONSE, GENERIC); helper threads are not split yet',
            proofs: [WIN_TRANSCRIPT_PROOF],
        },
        'budget.usage': {
            kind: 'partial',
            missing: 'published Antigravity token weights',
            notice: 'meters input_tokens, cache_read_tokens, and output_tokens with estimated weights',
            proofs: [WIN_USAGE_PROOF],
        },
        'budget.model-share': NOT_YET('Antigravity usage meter'),
        'budget.week-reading': NOT_YET('Antigravity usage meter'),
        'budget.five-hour': NOT_YET('Antigravity usage meter'),
        'budget.status-line': UNPROVED,
        'budget.helper-weight': NOT_YET('Antigravity usage meter'),
        'budget.pools': NOT_YET('Antigravity usage meter'),
        'budget.windows': NOT_YET('Antigravity usage meter'),
        'budget.tuning': NO_HOST_SUPPORT('model tuning'),
        'errors.kinds': NO_HOST_SUPPORT('StopFailure error kinds'),
        'os.windows-sessions': UNPROVED,
        'os.windows-hooks': UNPROVED,
        'os.linux': UNPROVED,
    },
};
