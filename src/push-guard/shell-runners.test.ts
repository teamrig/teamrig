import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { findGitInvocations } from './invocations.ts';

// Programs that run a command where the guard cannot read it (another host, a container, a terminal or
// multiplexer, later, in parallel), and code a later shell runs.

const CWD = resolve('/work/app');
const unset = { config: () => ({ kind: 'unset' as const }) };

/** `PUSH` when a push is found, `DOUBT` when the guard doubts, `pass` otherwise. */
function outcome(command: string): string {
  const found = findGitInvocations(command, { cwd: CWD, home: '/u', dialect: 'bash', git: unset });
  return found.invocations.some((invocation) => invocation.subcommand === 'push') ? 'PUSH' : found.doubts.length > 0 ? 'DOUBT' : 'pass';
}

const X = "'git push origin main'";

/** Each shape that hands X to a program the guard cannot read into: a doubt. */
const HANDS_X: readonly string[] = [
  'ssh host X',
  'ssh -p 22 host X',
  'watch -n1 X',
  'tmux new -d X',
  'tmux new-session -d X',
  'tmux send-keys X Enter',
  'screen -dm sh -c X',
  'xterm -e X',
  'gnome-terminal -- sh -c X',
  'parallel ::: X',
  'docker exec c sh -c X',
  'podman run img sh -c X',
  'kubectl exec p -- sh -c X',
  'awk \'BEGIN{system("git push")}\'',
  'at now <<< X',
  'echo X | at now',
  'crontab <<< X',
  'make -f /dev/stdin <<< X',
  'ssh host <<< X',
  'echo X >> ~/.bashrc',
  'echo X > /u/.profile',
  'tee -a ~/.zshrc <<< X',
  'PROMPT_COMMAND=X',
  'export BASH_ENV=X',
  'alias g=X',
  // the receiving shell puts a split word back together
  `ssh host 'git pu""sh origin main'`,
  `ssh host 'git p\\ush origin main'`,
  `ssh host 'x=pu; git \${x}sh origin main'`,
  `watch 'git pu""sh origin main'`,
  `tmux new -d 'git pu""sh origin main'`,
  `at now <<< 'git pu""sh origin main'`,
  `echo 'git pu""sh origin main' >> ~/.bashrc`,
  `alias g='git pu""sh origin main'`,
  `PROMPT_COMMAND='git pu""sh origin main'`,
  // later code beyond the classic startup files
  'echo X >> ~/.bash_aliases',
  'echo X > ~/.bashrc.d/x.sh',
  'echo X > /etc/profile.d/x.sh',
  'echo X >> ~/.config/fish/config.fish',
  'echo X > .git/hooks/pre-commit',
  'echo X > .envrc',
  // more runners
  'sshpass -p x ssh host X',
  'mosh host -- sh -c X',
  'toolbox run sh -c X',
  'distrobox enter box -- sh -c X',
  'podman machine ssh X',
  "make -E 'all:; git push origin main'",
  `awk '{system($0)}' <<< X`,
  // ssh config lines that name a command, run on this host or the other end
  'ssh -o ProxyCommand=X localhost true',
  `ssh -o 'ProxyCommand git pu""sh origin main' localhost true`,
  'ssh -oLocalCommand=X -o PermitLocalCommand=yes localhost true',
  'ssh -vo KnownHostsCommand=X host',
  'ssh host -o RemoteCommand=X',
  `ssh -o 'Match exec "git push origin main"' host`,
  'scp -o ProxyCommand=X a host:b',
  // a crontab's schedule is not its command
  `crontab - <<< '* * * * * git pu""sh origin main'`,
  `crontab <<< '@reboot git push origin main'`,
  // expect's script is Tcl
  `expect -c 'spawn git pu""sh origin main; interact'`,
  `expect <<< 'spawn git push origin main'`,
  // a static echo piped into a runner hands it that text
  `echo 'git pu""sh origin main' | at now`,
  `echo 'git pu""sh origin main' | ssh localhost`,
  // a value with a variable in it
  'export PROMPT_COMMAND="$PROMPT_COMMAND; git push origin main"',
  'alias g="git push origin main $Y"',
  'echo X > .husky/pre-push',
  'echo X > ~/.config/fish/functions/git.fish',
  'echo X > /srv/repo.git/hooks/post-receive',
  'echo X >> /etc/profile',
  // make reads a makefile from stdin only by -f -, docker and podman run stdin only in a container command
  'make -f - <<< X',
  'echo X | make --file=-',
  'make --makefile /dev/stdin <<< X',
  'docker exec -i c sh <<< X',
  'echo X | podman run -i img sh',
  // stdin by another name, or -f inside a bundle of short options
  'echo X | make -f /dev/fd/0',
  'echo X | make -f /proc/self/fd/0',
  'echo X | make -sf -',
  'echo X | make -sf/dev/stdin',
  'echo X | make --fil=-',
  'echo X | make -f "$F"',
  // a compose, stack or build file on stdin names the commands docker or podman runs
  'echo X | docker compose -f - up',
  'echo X | podman compose -f - up',
  'echo X | docker stack deploy -c - s',
  'echo X | docker -H tcp://h:2375 compose -f - up',
  'echo X | docker build -',
  'echo X | podman build -f - .',
];

/** Files in a language of docker's own on stdin, which name a push somewhere in their text. */
const CONTAINER_FILES: readonly string[] = [
  "echo 'RUN git push origin main' | docker build --ssh default -",
  "echo 'RUN git push origin main' | docker buildx build --ssh default -",
  "echo 'RUN git push origin main' | podman build -f - .",
  "printf 'services:\\n  a:\\n    command: [git, push, origin, main]\\n' | docker compose -f - up",
];

/** Shapes that stay as they were: X is data, or the program runs something else. */
const UNCHANGED: readonly (readonly [string, string])[] = [
  ['docker push registry/app:1', 'pass'],
  ['podman push app', 'pass'],
  ['kubectl get pods -o name', 'pass'],
  ["awk '/push/ {print $1}' notes.md", 'pass'],
  ['ssh host uptime', 'pass'],
  ['tmux new-session -d htop', 'pass'],
  ['watch -n1 git status', 'pass'],
  ['make push-docs', 'pass'],
  ['echo hi >> ~/.bashrc', 'pass'],
  ['echo X >> notes.md', 'pass'],
  ['PROMPT_COMMAND="history -a"', 'pass'],
  ["alias ll='ls -l'", 'pass'],
  ['gh issue create --body X', 'pass'],
  ['git commit -m X', 'pass'],
  ['export A=X', 'pass'],
  // the handed command is read, not searched for the word
  ["tmux send-keys -t lead 'echo push done' Enter", 'pass'],
  ["kubectl exec p -- cat /var/log/push.log", 'pass'],
  ["ssh host 'cat push-notes.md'", 'pass'],
  ["echo 'export PATH=$HOME/bin:$PATH' >> ~/.bashrc", 'pass'],
  ["ssh -o ProxyCommand='ssh -W %h:%p bastion' host uptime", 'pass'],
  ["crontab <<< '0 3 * * * /usr/bin/backup'", 'pass'],
  ["expect -c 'spawn ssh host; interact'", 'pass'],
  ["echo uptime | ssh localhost", 'pass'],
  // a project's own hooks folder is data
  ["cat > src/hooks/x.test.ts <<'EOF'\ngit push origin main\nEOF", 'pass'],
  // a file that is only named profile is data
  ['echo X > docs/profile', 'pass'],
  // a pipe into make, or into docker or podman outside a container command, runs no stdin
  ['echo X | make', 'pass'],
  ['cat image.tar | docker load', 'pass'],
  ['echo X | docker login --password-stdin registry', 'pass'],
  ['echo X | podman load', 'pass'],
  ['cat image.tar | docker image load', 'pass'],
  ['cat image.tar | docker --context prod load', 'pass'],
  ['tar c . | docker cp - c:/app', 'pass'],
  ['echo X | docker secret create s -', 'pass'],
  ['echo X | make -C sub', 'pass'],
  ['echo X | make -sf Makefile', 'pass'],
];

describe('findGitInvocations: programs that run a command the guard cannot read', () => {
  it('doubts each shape that hands such a program a push', () => {
    for (const shape of HANDS_X) {
      assert.equal(outcome(shape.replaceAll('X', X)), 'DOUBT', shape);
    }
  });

  it('doubts a compose, stack or build file on stdin that names a push', () => {
    for (const shape of CONTAINER_FILES) {
      assert.equal(outcome(shape), 'DOUBT', shape);
    }
  });

  it('leaves data and other commands as they were', () => {
    for (const [shape, expected] of UNCHANGED) {
      assert.equal(outcome(shape.replaceAll('X', X)), expected, shape);
    }
  });

  it('refuses quickly a line that nests runners past the read budget, and reads a few nested runners', () => {
    const nested = `${Array.from({ length: 8 }, (_, level) => `watch a${level}`).join(' ')} true`;
    const started = performance.now();
    const found = findGitInvocations(nested, { cwd: CWD, home: '/u', dialect: 'bash', git: unset });
    assert.ok(performance.now() - started < 5000, 'took too long');
    assert.ok(found.doubts.some((doubt) => doubt.reason === 'it nests more commands than the guard reads in one line' && !doubt.gated), JSON.stringify(found.doubts));
    assert.equal(outcome('ssh h1 ssh h2 watch -n1 git status'), 'pass');
    assert.equal(outcome(`ssh h1 ssh h2 watch -n1 ${X}`), 'DOUBT');
  });

  it('asks always when the command names a push, and only on a push line when a pipe feeds it', () => {
    const named = findGitInvocations(`ssh host ${X}`, { cwd: CWD, home: '/u', dialect: 'bash', git: unset });
    assert.deepEqual(named.doubts, [{ reason: 'it hands ssh a command that pushes, which ssh runs where the guard cannot read it', gated: false }]);
    const piped = findGitInvocations('cat jobs.txt | at now', { cwd: CWD, home: '/u', dialect: 'bash', git: unset });
    assert.deepEqual(piped.doubts, [{ reason: 'it pipes commands into at, which runs them where the guard cannot read them', gated: true }]);
  });
});
