/*
 * The getopt options of the programs the push guard reads past, as each program's source declares them
 * (util-linux 52c7e966, coreutils 0a61f3ea, findutils 71d158fd, sudo 49e4b24b, systemd cac05a9e, strace ec439c54,
 * ltrace 3f9b64ac). A wrong table lets a value word pass for the program a wrapper runs, so each one is copied
 * from the program's own option table, not from its manual.
 */

/**
 * A program's options: `short` is its getopt optstring (a letter followed by `:` takes a value, by `::` takes one
 * only attached; a leading `+` stops at the first operand); `long` lists its long options, a name ending in `=`
 * takes a value (attached with `=` or the next word), one ending in `?` takes one only attached with `=`.
 */
export interface OptionTable {
  readonly short: string;
  readonly long: string;
}

/** What an option takes: nothing, a value (attached or the next word), or a value only when attached. */
export type OptionArgument = 'none' | 'required' | 'optional';

/** A long option as getopt reads it: its full name and argument, or why getopt would not take it. */
export type LongOption = { readonly kind: 'known'; readonly name: string; readonly argument: OptionArgument } | { readonly kind: 'unknown' | 'ambiguous' };

export const OPTION_TABLES: ReadonlyMap<string, OptionTable> = new Map<string, OptionTable>([
  [
    'nsenter',
    {
      short: '+ahVt:m::u::i::n::N:p::C::U::T::S:G:r::w::W::ecFZ',
      long: [
        'all help version target= mount? uts? ipc? net? net-socket= pid? user? cgroup? time? setuid= setgid= root? wd?',
        'wdns? env no-fork join-cgroup preserve-credentials keep-caps user-parent follow-context',
      ].join(' '),
    },
  ],
  [
    'unshare',
    {
      short: '+fhVmuinpCTUrR:w:S:G:cl:',
      long: [
        'help version mount? uts? ipc? net? pid? user? cgroup? time? fork kill-child? forward-signals mount-proc?',
        'mount-binfmt? map-user= map-users= map-group= map-groups= map-root-user map-current-user map-auto map-subids',
        'owner= propagation= setgroups= keep-caps setuid= setgid= root= wd= monotonic= boottime= load-interp= clear-env',
        'whitelist-env=',
      ].join(' '),
    },
  ],
  [
    'setpriv',
    {
      short: '+dhV',
      long: [
        'dump nnp no-new-privs inh-caps= ambient-caps= list-caps ruid= euid= rgid= egid= reuid= regid= clear-groups',
        'keep-groups init-groups groups= bounding-set= securebits= pdeathsig= ptracer= selinux-label= apparmor-profile=',
        'landlock-access= landlock-rule= landlock-support list-landlock-access list-landlock-rights= seccomp-filter=',
        'help reset-env version',
      ].join(' '),
    },
  ],
  [
    'flock',
    {
      short: '+:sexnoFuw:E:hV?',
      long: [
        'shared exclusive unlock nonblocking nb timeout= wait= conflict-exit-code= close no-fork verbose fcntl start=',
        'length= fd= help version',
      ].join(' '),
    },
  ],
  [
    'su',
    {
      short: 'c:fg:G:lmpPTs:u:hVw:',
      long: [
        'command= session-command= fast login preserve-environment pty no-pty shell= group= supp-group=',
        'whitelist-environment= help version',
      ].join(' '),
    },
  ],
  [
    'runuser',
    {
      short: 'c:fg:G:lmpPTs:u:hVw:',
      long: [
        'command= session-command= fast login preserve-environment pty no-pty shell= group= supp-group= user=',
        'whitelist-environment= help version',
      ].join(' '),
    },
  ],
  [
    'script',
    {
      short: 'aB:c:eE:fI:O:o:qm:T:t::Vh',
      long: [
        'append command= echo= return flush force log-in= log-out= log-io= log-timing= logging-format= output-limit=',
        'quiet timing? version help',
      ].join(' '),
    },
  ],
  ['taskset', { short: '+apchV', long: 'all-tasks pid cpu-list help version' }],
  [
    'chrt',
    {
      short: '+abdD:efiphmoOP:T:rRU:X:GvV',
      long: [
        'all-tasks batch clamp-min= clamp-max= deadline deadline-overrun ext fifo idle pid help max other rr',
        'sched-runtime= sched-period= sched-deadline= reset-on-fork reclaim-grub verbose version',
      ].join(' '),
    },
  ],
  ['ionice', { short: '+n:c:p:P:u:tVh', long: 'classdata= class= help ignore pid= pgid= uid= version' }],
  ['chroot', { short: '+', long: 'groups= userspec= skip-chdir help version' }],
  ['timeout', { short: '+fk:ps:v', long: 'foreground kill-after= preserve-status signal= verbose help version' }],
  [
    'env',
    {
      short: '+a:C:iS:u:v0',
      long: [
        'argv0= ignore-environment env0-from= null unset= chdir= default-signal? ignore-signal? block-signal?',
        'list-signal-handling debug quoting-style= split-string= help version',
      ].join(' '),
    },
  ],
  ['nice', { short: '+n:', long: 'adjustment= help version' }],
  ['stdbuf', { short: '+i:o:e:', long: 'input= output= error= help version' }],
  [
    'xargs',
    {
      short: '+0a:E:e::i::I:l::L:n:oprs:txP:d:',
      long: [
        'null arg-file= delimiter= eof? replace? max-lines? max-args= open-tty interactive no-run-if-empty max-chars=',
        'verbose show-limits exit max-procs= process-slot-var= version help',
      ].join(' '),
    },
  ],
  [
    'sudo',
    {
      short: '+Aa:BbC:c:D:Eeg:Hh::iKklNnPp:R:r:SsT:t:U:u:Vv',
      long: [
        'background preserve-env? edit set-home login remove-timestamp list preserve-groups shell other-user= validate',
        'askpass auth-type= bell close-from= login-class= chdir= group= help host= reset-timestamp no-update',
        'non-interactive prompt= chroot= role= stdin command-timeout= type= user= version',
      ].join(' '),
    },
  ],
  [
    'strace',
    {
      short: '+a:Ab:cCdDe:E:fFhiI:knNo:O:p:P:qrs:S:tTu:U:vVwxX:yYzZ',
      long: [
        'columns= output-append-mode detach-on= summary-only summary debug daemonize? daemonised? daemonized? env=',
        'follow-forks output-separately help instruction-pointer interruptible= kill-on-exit stack-trace? stack-traces?',
        'stack-trace-frame-limit= syscall-limit= syscall-number arg-names output= summary-syscall-overhead= attach=',
        'trace-path= relative-timestamps? string-limit= summary-sort-by= absolute-timestamps? timestamps?',
        'syscall-times? user= summary-columns= no-abbrev version summary-wall-clock strings-in-hex? const-print-style=',
        'pidns-translation successful-only failed-only failing-only seccomp-bpf tips? argv0= always-show-pid color=',
        'hyperlink? trace= trace-fds= abbrev= verbose= raw= signals= status= read= write= fault= inject= kvm=',
        'namespace? quiet? silent? silence? decode-fds? decode-pids= secontext?',
      ].join(' '),
    },
  ],
  ['ltrace', { short: '+Cw:cfhiLrStTVba:A:d:D:e:F:l:n:o:p:s:u:x:', long: 'align= config= debug= demangle indent= help library= max-depth= output= version no-signals where=' }],
  [
    'systemd-run',
    {
      short: '+hH:M:C:u:p:rdRE:tTPqvGS',
      long: [
        'help version no-ask-password user system host= machine= capsule= scope unit= property= description= slice=',
        'slice-inherit expand-environment= no-block remain-after-exit wait send-sighup service-type= uid= gid= nice=',
        'working-directory= same-dir root-directory= same-root-dir setenv= tty pty pty-late pipe quiet verbose output=',
        'json= collect shell job-mode= ignore-failure background= no-pager path-property= socket-property= on-active=',
        'on-boot= on-startup= on-unit-active= on-unit-inactive= on-calendar= on-timezone-change on-clock-change',
        'timer-property= introspect-cli',
      ].join(' '),
    },
  ],
]);

/** What the short option `letter` takes in `table`, or undefined when the program has no such option. */
export function shortArgument(table: OptionTable, letter: string): OptionArgument | undefined {
  const at = letter === ':' || letter === '+' ? -1 : table.short.indexOf(letter);
  if (at === -1) {
    return undefined;
  }
  if (table.short.charAt(at + 1) !== ':') {
    return 'none';
  }
  return table.short.charAt(at + 2) === ':' ? 'optional' : 'required';
}

/** The long option `name` (without `--` or `=value`) as getopt reads it: an exact name, else a unique prefix of one. */
export function longOption(table: OptionTable, name: string): LongOption {
  const entries = table.long.split(' ').map((entry): { readonly name: string; readonly argument: OptionArgument } => {
    const last = entry.charAt(entry.length - 1);
    return last === '=' || last === '?' ? { name: entry.slice(0, -1), argument: last === '=' ? 'required' : 'optional' } : { name: entry, argument: 'none' };
  });
  const exact = entries.find((entry) => entry.name === name);
  const matches = exact === undefined ? entries.filter((entry) => name !== '' && entry.name.startsWith(name)) : [exact];
  const [match] = matches;
  if (match === undefined) {
    return { kind: 'unknown' };
  }
  return matches.length > 1 ? { kind: 'ambiguous' } : { kind: 'known', name: match.name, argument: match.argument };
}
