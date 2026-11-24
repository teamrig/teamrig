import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './launchers.ts';
import { perlCodeOf, readPerl, type PerlReading } from './perl-code.ts';
import { parseShell } from './tokenizer.ts';

function expectReadings(reading: PerlReading, codes: readonly string[]): void {
  for (const code of codes) {
    assert.equal(readPerl(code), reading, code);
  }
}

/** The reading of the perl call a bash line runs, or undefined when it holds no inline code. */
function readingOf(line: string): PerlReading | undefined {
  const command = parseShell(line, 'bash').commands.at(-1);
  assert.ok(command !== undefined, line);
  const launched = launch(command.words, 'bash');
  assert.equal(launched.kind, 'program', line);
  return launched.kind === 'program' ? perlCodeOf(launched, command.stdin)?.reading : undefined;
}

describe('readPerl', () => {
  it('reads backticks in strings, patterns, quoted bodies and comments as text', () => {
    expectReadings('none', [
      'print if /x/',
      's/a/b/g',
      's{`x`}{`y`}g',
      's/`x`/`y`/; tr/a-z/A-Z/; y/a/b/',
      'print q{`x`}, qw(`a` `b`)',
      'my $s = "`x`"; print $s',
      "print '`x`'",
      '# `x`\nprint 1',
      'print $1 while /`(x[^`]+)`/g',
      'print $_ =~ m{a/`b`}',
      's/\\$\\{x\\}/y/',
      '/x/ and print $`, $\'',
      'say for 1..3',
      'print join(",", sort keys %h)',
      'print 10 % 3, 2**3, $a & 1, $a && $b',
      '$_ = uc; print $F[0], $x->{a}, $x->[1], "a" x 3',
      'print "$.: $_" if $. == 3',
      'while (<STDIN>) { print } print <$fh>, <<>>',
      'print STDERR "x"',
      'my %h = (s => 1, y => 2); print 1 / 2 / 3, $x // 0',
    ]);
  });

  it('finds what runs a command, loads code or reaches what it cannot see', () => {
    expectReadings('runs', [
      'print `x`',
      'system("x")',
      'exec "x"',
      'print qx{x}',
      'print CORE::system("x")',
      'open(F, "x |")',
      'eval "x"',
      'require X',
      'use X',
      'do "x.pl"',
      '@ARGV = ("x |"); print while <>',
      '&$f()',
      '&f',
      '$f->()',
      '$o->$m',
      '@{"x"} = 1',
      '${\\ 1}',
      '*{"x"} = 1',
      'print @$x',
      'print $$x',
      '@ {"x"} = 1',
      'print & $f',
    ]);
  });

  it('cannot tell where perl may read code in a string or a pattern, or reads a token two ways', () => {
    expectReadings('unknown', [
      's/x/`y`/e',
      'print "@{[ `x` ]}"',
      'print "${\\ `x`}"',
      'print "$h{`x`}"',
      '/(?{ `x` })/',
      'print <<EOF',
      'print STDERR /x/',
      'print -s "f"',
      'print $h{s}',
      'sub s { 1 }',
      "print 'x",
      's/x/',
      '=pod\n`x`',
      "print Foo'bar",
      "$x'y; print 'z'",
      "$o->m'x",
      'print length < 3',
      'print ?`x`?',
      '/(*{ `x` })/',
    ]);
  });
});

describe('perlCodeOf', () => {
  it('cannot tell modulo or multiply after a bare word or a subscript from a sigil', () => {
    expectReadings('unknown', [
      'print time % `x #`',
      'print time *`x #`',
      'print wantarray % `x #`',
      'print __LINE__ %`x #`',
      'print __FILE__ %`x #`',
      'print $x{a} %`x #`',
      'print $a->{x} *`x #`',
      'print %`x #`',
      'print *`x #`',
    ]);
  });

  it('reads a subscript after a punctuation or caret variable in a string or pattern as code', () => {
    expectReadings('unknown', [
      'print "$-[`x`]"',
      'print "$+[`x`]"',
      'print "$+{`x`}"',
      'print "$-{`x`}"',
      'print "$![`x`]"',
      'print "$$[`x`]"',
      'print "$&[`x`]"',
      'print "@-[`x`]"',
      'print "$^W[`x`]"',
      'print "$;[`x`]"',
      'print "$,[`x`]"',
      'print "$.[`x`]"',
      'print "$/[`x`]"',
      'print "$-->[`x`]"',
      'print qq{$-[`x`]}',
      'print if /$+{`x`}/',
      'say "$x->@[`x`]"',
      'say qq{$x->@[`x`]}',
      'say "$x->%{`x`}"',
      'print if /$x->@[`x`]/',
      'print "$x\'y[`x`]"',
      'print qq{$x\'y[`x`]}',
    ]);
  });

  it('reads every -e and -E word of a perl call as one program', () => {
    assert.equal(readingOf("perl -ne 'print if /`x`/' f"), 'none');
    assert.equal(readingOf("perl -e '# `x`' -e 'print 1'"), 'none');
    assert.equal(readingOf("/usr/bin/perl -lE 'say q{`x`}'"), 'none');
    assert.equal(readingOf("perl -e 'print 1' -e 'print `x`'"), 'runs');
    assert.equal(readingOf("perl <<'EOF'\nprint `x`\nEOF"), 'runs');
    assert.equal(readingOf("perl x.pl '`x`'"), undefined);
    assert.equal(readingOf("ruby -e 'puts 1'"), undefined);
  });

  it('cannot tell when an option or variable loads other code, or a word may be no code at all', () => {
    for (const line of [
      "perl -Mx -e 'print 1'",
      "perl -d -e 'print 1'",
      "perl -e 'print 1' -mx",
      "PERL5OPT=-Mx perl -e 'print 1'",
      "perl -pie 'print 1' f",
      "perl -e 1 f -e 'print 1'",
      "perl -e 1 -- -e 'print 1'",
      'perl -e "print $X"',
    ]) {
      assert.equal(readingOf(line), 'unknown', line);
    }
  });
});
