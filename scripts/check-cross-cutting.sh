#!/usr/bin/env bash
# Cross-cutting cascade invariant guard (design spec §4.4 / 09-UNIFIED-PROGRAM §6).
#
# The RunEnvelope (kernel/envelope/run-envelope.ts) is the ONE run-wide carrier
# for the seven cross-cutting harness concerns (approvalPolicy, approvalDecision,
# interactionResponse, grounding, fabricationGuard, stallPolicy, taskContract).
# Before the cascade these were hand-declared on every strategy's own input
# interface and threaded by hand at N call sites — the exact "silently dropped
# wherever one is missed" defect class the cascade exists to end. Its integrity
# depends on four things holding at once:
#
#   1. No strategy input interface re-declares an envelope field — by name, via
#      `Pick<KernelInput, …>` / `Omit<KernelInput, …>`, or by `extends`-ing a
#      bundle that carries them.
#   2. No `KernelInput` is hand-authored outside the canonical assembly module
#      (kernel/state/build-kernel-input.ts) and the sanctioned sites below —
#      neither as an annotated literal nor via an `as KernelInput` cast, which
#      turns the compiler off for exactly the fields this gate protects.
#   3. RunEnvelope is provided at exactly the two sanctioned seams: production
#      (services/reasoning-service.ts) and test (provideTestEnvelope in
#      run-envelope.ts itself). A second provision site is two competing sources
#      of truth for one run.
#   4. Every `ReasoningService.execute` request carries an `envelope`, built by
#      the ONE config→envelope mapper (runtime/src/engine/run-envelope-config.ts).
#      A request without one runs with the harness disarmed.
#
# ── 2026-07-23 hardening #1 (review finding I2) ─────────────────────────────
# A review demonstrated all three original checks passing on an 18-line file
# that violated all three, and found one PRODUCTION site already evading check 2
# (`react-kernel.ts` — a hand-authored literal closed with `as KernelInput`,
# since rewritten to compose `buildKernelInput` + `mergeRunEnvelopeIntoKernelInput`
# so no cast remains). Every pattern below runs against COMMENT-STRIPPED source,
# so prose describing a violation no longer trips (or masks) the gate.
#
# ── 2026-07-23 hardening #2 (adversarial review of THIS script) ─────────────
# A second review got TWELVE violations past hardening #1. The root cause of
# five of them was that the checks matched LINE BY LINE, so the repo's own
# Prettier config (printWidth 80, singleQuote) was itself an evasion: wrapping
# `extends Pick<KernelInput, …>` across five lines, or `} as\n  KernelInput;`,
# made a violation the gate explicitly claims to catch invisible to it.
#
# Checks 1–3 therefore no longer see lines at all. Every pattern now runs
# against the WHOLE comment-stripped file with `\s` free to cross newlines —
# i.e. against whitespace-normalized source — and the offset of each match is
# converted back to a real line number for the report, with the matched text
# collapsed onto one line so the message stays readable. Formatting is no
# longer semantically significant to this gate.
#
# The other seven closures are recorded at each check.
#
# This script fails CI if any of the four break. Mirrors check-ledger-writes.sh
# / check-run-contract.sh; discovered + run by the CI "Enforce architectural
# invariants" step (`for s in scripts/check-*.sh`) and by
# packages/reasoning/tests/enforcement-scripts.test.ts.
#
# HONEST SCOPE: this is a shape gate, not a proof. It now matches on normalized
# source rather than on formatting, and keys check 4 on an imported TYPE rather
# than on an identifier's spelling, which removes whole classes of evasion
# rather than individual spellings — but a sufficiently novel shape (an envelope
# field re-declared under a computed key, a service reached through an untyped
# `unknown` cast) can still slip. The compile-enforced terminal mint
# (`JudgedReasoningResult`) is the load-bearing guarantee; this is the net that
# catches the shapes a type cannot.
#
# Usage: bash scripts/check-cross-cutting.sh
# Exit: 0 if all four invariants hold; 1 with the offending lines if violated.

set -euo pipefail
cd "$(dirname "$0")/.."
FAIL=0

STRATEGIES_DIR="packages/reasoning/src/strategies"
REASONING_SRC="packages/reasoning/src"
FIELDS='approvalPolicy|approvalDecision|interactionResponse|fabricationGuard|stallPolicy|grounding|taskContract'

# ── The scanner ─────────────────────────────────────────────────────────────
# One Perl program, selected by $SCAN_MODE, run over a list of production .ts
# files. Perl (not grep/awk) because every check here needs three things that
# are line-oriented tools' blind spots:
#   - matching ACROSS newlines (so Prettier's wrapping is not an evasion),
#   - brace-matching (so a check can be scoped to a declaration body or to one
#     call expression instead of to a fixed ± line window), and
#   - reporting a real file:line for a match that began N lines earlier.
# It prints `file:line: <collapsed match>` and always exits 0; the caller
# decides what an emitted line means.
SCAN_PL="$(
  cat <<'PERL'
use strict;
use warnings;

my $mode   = $ENV{SCAN_MODE}   // "";
my $fields = $ENV{SCAN_FIELDS} // "__no_such_field__";

# Strip comments while PRESERVING line numbering (block comments collapse to
# their own newlines), so every file:line printed below is real.
#
# Comment stripping is what makes these patterns non-evadable in the other
# direction too: an earlier check 2 false-positived on prose that merely quoted
# a `const x: KernelInput = {` line, and prose describing a violation must never
# be able to MASK one either.
sub strip_comments {
  my ($src) = @_;
  # Block comments, but only where one can actually begin — start of file, or
  # after whitespace/an opening delimiter. Without that guard a glob string
  # like "**/*.ts" opens a comment that swallows the rest of the file.
  $src =~ s#((?:\A|(?<=[\s(,{;=\[]))/\*.*?\*/)# (my $m = $1) =~ s/[^\n]//g; $m #gse;
  # Line comments, except the "//" of a URL inside a string literal.
  $src =~ s#(?<!:)//[^\n]*##g;
  return $src;
}

# Length- and newline-preserving blanking of string/template contents.
#
# Two jobs, both resting on the length preservation: every offset found in the
# skeleton indexes the un-blanked text identically, so matching happens on the
# skeleton and REPORTING happens on the real source.
#   1. brace matching — a `{` inside a string must not move the depth count;
#   2. false-positive suppression — a violation cannot LIVE inside a string
#      literal, so prose in a string (`"never write: const x: KernelInput = {}"`)
#      must not trip the gate any more than prose in a comment does.
# The one check that must read INSIDE strings is check 1's Pick/Omit rule: the
# field names it looks for are themselves string literals (`Pick<KernelInput,
# "approvalPolicy">`). That rule alone runs on the un-blanked source, so a
# prose string spelling out a complete Pick will trip it — a false positive
# traded for never missing the real shape.
sub blank_strings {
  my ($src) = @_;
  $src =~ s#("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)# (my $m = $1) =~ s/[^\n]/ /g; $m #gse;
  return $src;
}

sub lineno { my ($src, $off) = @_; return 1 + (substr($src, 0, $off) =~ tr/\n//); }

sub excerpt {
  my ($t) = @_;
  $t =~ s/\s+/ /g;
  $t =~ s/^\s+|\s+$//g;
  $t = substr($t, 0, 110) . " …" if length($t) > 110;
  return $t;
}

# Index of the "}" closing the "{" at $open, or -1.
sub match_brace {
  my ($skel, $open) = @_;
  my $depth = 0;
  for (my $i = $open; $i < length($skel); $i++) {
    my $c = substr($skel, $i, 1);
    if    ($c eq "{") { $depth++ }
    elsif ($c eq "}") { $depth--; return $i if $depth == 0 }
  }
  return -1;
}

for my $file (@ARGV) {
  open(my $fh, "<", $file) or next;
  my $raw = do { local $/; <$fh> };
  close($fh);
  next unless defined $raw;
  my $src  = strip_comments($raw);
  my $skel = blank_strings($src);

  if ($mode eq "decl-fields") {
    # Check 1 rule (a): a named envelope field on a declaration.
    my %seen;
    # (a1) the original line-anchored shape, kept verbatim so nothing this
    #      already caught can be lost.
    while ($skel =~ /^[ \t]*(?:readonly[ \t]+)?(?:$fields)[ \t]*\??[ \t]*:/mg) {
      $seen{ lineno($src, $-[0]) } = excerpt(substr($src, $-[0], $+[0] - $-[0]));
    }
    # (a2) ANY envelope field inside an interface / object-type-alias BODY,
    #      wherever it sits on the line. (a1) anchors at `^\s*field`, so
    #      `interface X { readonly approvalPolicy?: … }` — the field sharing a
    #      line with the brace — was invisible to it; the prior fix wave's own
    #      demo file contained exactly that shape and it was never reported.
    #      Scoping to a declaration body (not just to a `{`) is what keeps this
    #      off value positions like `redirectsSpent: { grounding: 0, … }`.
    while ($skel =~ /\b(?:export\s+)?(?:declare\s+)?(?:interface\s+[A-Za-z0-9_\$]+[^{;]*|type\s+[A-Za-z0-9_\$]+[^={;]*=\s*)\{/g) {
      my $open  = $+[0] - 1;
      my $close = match_brace($skel, $open);
      next if $close < 0;
      my $body = substr($skel, $open, $close - $open + 1);
      while ($body =~ /(?:^|[{;,])\s*(?:readonly\s+)?(?:$fields)\s*\??\s*:/g) {
        my $off = $open + $-[0];
        $seen{ lineno($src, $off) } = excerpt(substr($src, $off, $+[0] - $-[0]));
      }
    }
    print "$file:$_: $seen{$_}\n" for sort { $a <=> $b } keys %seen;
  }

  elsif ($mode eq "picks") {
    # Check 1 rule (b): a bundle carved out of KernelInput.
    #   - `Pick<KernelInput, … "field" …>` — now also single-quoted (the repo's
    #     Prettier writes singleQuote elsewhere), and `\s`/`[^>]` cross newlines
    #     so a wrapped Pick inside a `type` alias is caught too.
    #   - `Omit<KernelInput, …>` — ANY of them: an Omit re-declares every field
    #     it does not name, so all seven ride it, and it matched neither the
    #     Pick pattern nor `interface … extends`.
    my %seen;
    while ($src =~ /(?:\A|[^A-Za-z0-9_\$.])Pick\s*<\s*(?:[A-Za-z0-9_\$]+\.)?KernelInput\s*,[^>]*["'](?:$fields)["']/gs) {
      $seen{ lineno($src, $-[0]) } = excerpt(substr($src, $-[0], $+[0] - $-[0]));
    }
    while ($src =~ /(?:\A|[^A-Za-z0-9_\$.])Omit\s*<\s*(?:[A-Za-z0-9_\$]+\.)?KernelInput\b/gs) {
      $seen{ lineno($src, $-[0]) } = excerpt(substr($src, $-[0], $+[0] - $-[0]));
    }
    print "$file:$_: $seen{$_}\n" for sort { $a <=> $b } keys %seen;
  }

  elsif ($mode eq "extends") {
    # Check 1 rule (c): ANY `interface X extends Y` in strategies/. `\s+` before
    # `extends` crosses newlines, so Prettier's `export interface X\n  extends
    # Bundle {` no longer slips past a one-line-only pattern.
    while ($src =~ /^[ \t]*(?:export[ \t]+)?interface[ \t]+[A-Za-z0-9_\$]+\s+extends\s/mg) {
      my $end = $+[0];
      $end = $end + 60 > length($src) ? length($src) : $end + 60;
      print $file . ":" . lineno($src, $-[0]) . ": " . excerpt(substr($src, $-[0], $end - $-[0])) . "\n";
    }
  }

  elsif ($mode eq "kernel-input") {
    # Check 2: a hand-authored KernelInput. Resolves per-file ALIASES first —
    # `import type { KernelInput as KI }` followed by `as KI` defeated a
    # name-bound pattern completely. Namespace-qualified uses
    # (`import * as K` … `as K.KernelInput`) are covered by the optional
    # qualifier. `\s*` crosses newlines, so Prettier's `const n: KernelInput =\n
    # { … }` and `} as\n  KernelInput;` are both caught.
    my @names = ("KernelInput");
    while ($skel =~ /\bKernelInput\s+as\s+([A-Za-z0-9_\$]+)/g) { push @names, $1 }
    my $nm = join("|", map { quotemeta } @names);
    my %seen;
    while ($skel =~ /:\s*(?:[A-Za-z0-9_\$]+\.)?(?:$nm)\s*=\s*\{/gs) {
      $seen{ lineno($src, $-[0]) } = excerpt(substr($src, $-[0], $+[0] - $-[0]));
    }
    while ($skel =~ /\b(?:as|satisfies)\s+(?:[A-Za-z0-9_\$]+\.)?(?:$nm)\b/gs) {
      $seen{ lineno($src, $-[0]) } = excerpt(substr($src, $-[0], $+[0] - $-[0]));
    }
    print "$file:$_: $seen{$_}\n" for sort { $a <=> $b } keys %seen;
  }

  elsif ($mode eq "provide") {
    # Check 3: every way this codebase can bind RunEnvelope into a context.
    #   - provideService(…, RunEnvelope, …) — the argument scan is `[^;]` and
    #     not `[^)]`, because a `)` inside argument 1
    #     (`Effect.provideService(Effect.map(e, f), RunEnvelope, env)`) ended
    #     the old scan before it ever reached the tag.
    #   - Context.make / Context.add — `Effect.provide(e, Context.make(
    #     RunEnvelope, env))` provides just as hard as provideService.
    #   - Layer.sync / Layer.effect / Layer.scoped, not only Layer.succeed.
    #   - RunEnvelope.of(, and provideTestEnvelope( from production code.
    # `\s*` throughout replaces the old ±6-line awk fallback for the wrapped
    # `Layer.succeed(\n  RunEnvelope,` form.
    my %seen;
    my @pats = (
      qr/provideService\s*\([^;]{0,300}?\bRunEnvelope\b/s,
      qr/(?:[A-Za-z0-9_\$]+\.)?RunEnvelope\.of\s*\(/s,
      qr/Layer\.(?:succeed|sync|effect|scoped|effectDiscard|scopedDiscard)\s*\(\s*RunEnvelope\b/s,
      qr/Context\.(?:make|add|unsafeMake)\s*\(\s*RunEnvelope\b/s,
      qr/(?:\A|[^A-Za-z0-9_\$.])provideTestEnvelope\s*\(/s,
    );
    for my $p (@pats) {
      while ($skel =~ /$p/g) {
        $seen{ lineno($src, $-[0]) } = excerpt(substr($src, $-[0], $+[0] - $-[0]));
      }
    }
    print "$file:$_: $seen{$_}\n" for sort { $a <=> $b } keys %seen;
  }

  elsif ($mode eq "execute") {
    # Check 4. Rule (a) — file level.
    #
    # Keyed on the imported TYPE, not on the spelling of the identifier the
    # service is bound to. The old key was `[Rr]easoning[A-Za-z._]*\.execute\(`,
    # so `const svc = …; svc.execute({…})` — or `const { execute } = svc` —
    # made the ENTIRE file invisible, rule (b) included. A file that imports
    # `ReasoningServiceLike` / `ReasoningService` and calls `.execute(` at all
    # is now in scope however the callee is spelled — including the destructured
    # `const { execute } = svc; execute({…})` form, which has no dot at all, so
    # the call pattern is `\bexecute\s*\(` and not `\.execute\s*\(`.
    # The identifier pattern is retained alongside it so nothing it caught is lost.
    my $has_exec = $skel =~ /\bexecute\s*\(/s;
    my $named    = $skel =~ /[Rr]easoning[A-Za-z._]*\.execute\s*\(/s;
    my $typed    = $skel =~ /\bimport\b[^;]{0,400}?\bReasoningService(?:Like)?\b/s;
    my $in_scope = $named || ($typed && $has_exec);
    if ($in_scope && $raw !~ /buildRunEnvelopeFromConfig|ENVELOPE-EXEMPT/) {
      print "$file: calls a reasoning execute() without using buildRunEnvelopeFromConfig\n";
    }
    # Rule (b) applies only inside those files — `toolService.execute({…})` and
    # friends are not reasoning requests and must not be flagged.
    next unless $in_scope;

    # Rule (b) — each INLINE execute-request literal must carry `envelope:`.
    #
    # Scoped to the ENCLOSING call expression (brace-matched), not to a fixed
    # line window. The old window was `n-6 … n+95`, i.e. asymmetric: an
    # envelope-less `execute({…})` injected UPSTREAM of an existing `envelope:`
    # line borrowed that line and the gate reported OK, while the identical
    # injection downstream was caught. Any new continuation pass added within
    # ~95 lines above an existing one shipped with the harness disarmed and CI
    # green. The literal now answers for itself.
    #
    # An `ENVELOPE-EXEMPT:` marker is still honoured, read from the ORIGINAL
    # (un-stripped) text — it is a comment — either inside the literal or in
    # the 6 lines above the call.
    my @lines = split(/\n/, $raw, -1);
    while ($skel =~ /\bexecute\s*\(\s*\{/gs) {
      my $open  = $+[0] - 1;
      my $close = match_brace($skel, $open);
      $close = length($skel) - 1 if $close < 0;
      my $body  = substr($src, $open, $close - $open + 1);
      next if $body =~ /\benvelope\s*:/s;
      my $n     = lineno($src, $-[0]);
      my $endn  = lineno($src, $close);
      my $from  = $n - 6 < 1 ? 1 : $n - 6;
      my $exempt = 0;
      for my $i ($from .. $endn) {
        next if $i > scalar(@lines);
        if (defined $lines[$i - 1] && $lines[$i - 1] =~ /ENVELOPE-EXEMPT/) { $exempt = 1; last }
      }
      next if $exempt;
      print "$file:$n: inline execute request without an envelope\n";
    }
  }
}
exit 0;
PERL
)"

# Production .ts sources under the given roots — dist, node_modules and every
# test file excluded.
list_sources() {
  find "$@" -name '*.ts' \
    ! -path '*/dist/*' ! -path '*/node_modules/*' \
    ! -name '*.test.ts' ! -path '*__tests__*' ! -path '*/tests/*' \
    -print0 2>/dev/null
}

# scan <mode> <root>… — never fails; prints findings.
#
# Refuses to be vacuously green: a check whose roots match no file (a directory
# renamed, a find predicate typo) is a check that CANNOT fail, which is the
# exact degradation `enforcement-scripts.test.ts` exists to prevent one level up.
scan() {
  local mode="$1"
  shift
  local files=()
  mapfile -d '' -t files < <(list_sources "$@")
  if [ ${#files[@]} -eq 0 ]; then
    echo "SCAN-EMPTY: no source files under: $*" >&2
    exit 1
  fi
  SCAN_MODE="$mode" SCAN_FIELDS="$FIELDS" perl -e "$SCAN_PL" -- "${files[@]}"
}

# ── Check 1/4: strategy input interfaces must not re-declare envelope fields ──
# Three rules, because reviews evaded each of the earlier ones with the next:
#   (a) a named field — `readonly approvalPolicy?: …`, anywhere in an interface
#       or object-type-alias body (not only at the start of a line).
#   (b) a bundle carved out of KernelInput — `Pick<KernelInput, "approvalPolicy"
#       | …>` in either quote style, or ANY `Omit<KernelInput, …>`.
#   (c) ANY `interface X extends Y` — this is EXACTLY the pre-cascade
#       `StrategyHitlRails` pattern (a shared bundle a strategy still had to
#       remember to forward), and the extended name is arbitrary, so it cannot
#       be matched by name. No strategy interface extends anything today; if a
#       genuinely unrelated base is ever needed, add it to
#       ALLOWED_INTERFACE_BASES with a comment saying why it cannot carry a
#       cross-cutting field.
#
# SCOPE (reviewed 2026-07-23). Rules (a) and (c) stay scoped to
# `strategies/` and rule (b) is widened to all of `packages/reasoning/src`:
#   - (c) is only SOUND in strategies/. "Any interface that extends anything" is
#     a deliberate over-approximation that holds because no strategy input
#     interface extends anything; across reasoning/src it would flag dozens of
#     legitimate, unrelated inheritances, and a gate that cries wolf gets
#     `|| true`-d into a no-op — a strictly worse outcome than a narrow scope.
#   - (a) likewise: `KernelInput` itself, the envelope types and the builder
#     bundles all legitimately DECLARE these fields — declaring them is only a
#     violation on a strategy's own input type.
#   - (b) has no such conflict. There is no legitimate `Pick`/`Omit` of
#     `KernelInput` anywhere in the package (verified: zero outside comments),
#     and a bundle type is exactly the thing that would be declared in
#     `types/` and then `extends`-ed from `strategies/` — so widening (b) is
#     what covers the "the bundle moved out of the scanned directory" escape
#     that (c) alone could miss.
# Residual, stated plainly: a strategy input interface MOVED out of
# `strategies/` entirely would take rules (a)/(c) out of scope with it. What
# stops that silently is `scan`'s SCAN-EMPTY guard plus the fact that the file
# still has to be Pick/Omit-free (b) and still has to reach `runKernel`, which
# merges the envelope regardless.
ALLOWED_INTERFACE_BASES=()
DECLS="$(scan decl-fields "$STRATEGIES_DIR")"
PICKS="$(scan picks "$REASONING_SRC")"
EXTENDS="$(scan extends "$STRATEGIES_DIR")"
if [ ${#ALLOWED_INTERFACE_BASES[@]} -gt 0 ]; then
  BASES_RE="$(IFS='|'; echo "${ALLOWED_INTERFACE_BASES[*]}")"
  EXTENDS="$(printf '%s' "$EXTENDS" | grep -E -v "extends[[:space:]]+($BASES_RE)\b" || true)"
fi
CHECK1="$(printf '%s\n%s\n%s\n' "$DECLS" "$PICKS" "$EXTENDS" | grep -v '^$' | sort -u || true)"
if [ -n "$CHECK1" ]; then
  echo "FAIL (1/9): strategy input interface re-declares (or re-bundles) a cross-cutting field"
  echo "(the RunEnvelope is the only carrier):"
  echo ""
  echo "$CHECK1"
  echo ""
  echo "Remove the field from the strategy's input interface — it rides RunEnvelope"
  echo "(packages/reasoning/src/kernel/envelope/run-envelope.ts) and is merged onto"
  echo "KernelInput by runKernel. A re-declared field — named, Pick-ed, Omit-ed, or"
  echo "inherited from a shared 'rails' bundle — is exactly the 'silently dropped at"
  echo "one of N boundaries' defect class this gate exists to end."
  FAIL=1
else
  echo "OK (1/9): no strategy re-declares, Pick-s, Omit-s or inherits a cross-cutting field."
fi

# ── Check 2/4: no hand-authored KernelInput outside sanctioned sites ──
# Sanctioned:
#   - kernel/state/build-kernel-input.ts — the canonical assembly module
#     (buildKernelInput; returns a KernelInput, doesn't match these shapes
#     today, but stays listed so it can never accidentally be flagged).
#   - strategies/reactive.ts / strategies/direct.ts — reference strategies
#     that assemble the ReAct-kernel's first-pass KernelInput directly.
#   - kernel/loop/runner-helpers/strategy-switch.ts — strategy-switch handoff:
#     spreads an ALREADY-assembled `priorInput` (envelope fields already merged
#     by runKernel) with two field overrides (priorContext, requiredTools). It
#     never hand-authors a cross-cutting field.
#
# `as KernelInput` / `satisfies KernelInput` are flagged alongside the annotated
# literal: a cast is strictly WORSE than the literal this check was written for,
# because it silences the compiler on the very fields at issue. react-kernel.ts
# was that site on the real tree until 2026-07-23; it now composes
# `buildKernelInput` + `mergeRunEnvelopeIntoKernelInput` and needs no exemption.
#
# Import ALIASES are resolved per file (2026-07-23): `import type { KernelInput
# as KI }` + `as KI` defeated the name-bound pattern outright.
ALLOWED_KERNEL_INPUT_SITES=(
  "kernel/state/build-kernel-input.ts"
  "strategies/reactive.ts"
  "strategies/direct.ts"
  "kernel/loop/runner-helpers/strategy-switch.ts"
)
EXCLUDE=""
for f in "${ALLOWED_KERNEL_INPUT_SITES[@]}"; do
  EXCLUDE+="${EXCLUDE:+|}$f"
done
LITERALS="$(scan kernel-input "$REASONING_SRC" | grep -E -v "$EXCLUDE" || true)"
if [ -n "$LITERALS" ]; then
  echo "FAIL (2/9): hand-authored KernelInput outside the sanctioned assembly sites:"
  echo ""
  echo "$LITERALS"
  echo ""
  echo "Assemble via buildKernelInput() (kernel/state/build-kernel-input.ts) instead"
  echo "of hand-building a KernelInput literal, and never close one with"
  echo "'as KernelInput' — a hand-built literal can omit a cross-cutting field with"
  echo "no compiler signal, and the cast removes the signal entirely. If this is a"
  echo "genuinely sanctioned site, add it to ALLOWED_KERNEL_INPUT_SITES in this"
  echo "script WITH a comment explaining why it cannot silently drop an envelope field."
  FAIL=1
else
  echo "OK (2/9): no hand-authored KernelInput outside the sanctioned sites."
fi

# ── Check 3/4: RunEnvelope provided at exactly the two sanctioned seams ──
# Sanctioned:
#   - kernel/envelope/run-envelope.ts — provideTestEnvelope (the test seam).
#   - services/reasoning-service.ts — the ONE production provision site, at the
#     strategy-dispatch boundary.
# Shapes matched are listed at the `provide` mode above. `apps/` is scanned too:
# a provision site there was previously invisible.
PROVIDE_ROOTS=(packages apps)
PROVIDES="$(scan provide "${PROVIDE_ROOTS[@]}" \
  | grep -v '^$' \
  | grep -v 'kernel/envelope/run-envelope.ts' \
  | grep -v 'services/reasoning-service.ts' || true)"

if [ -n "$PROVIDES" ]; then
  echo "FAIL (3/9): RunEnvelope provided outside the two sanctioned seams:"
  echo ""
  echo "$PROVIDES"
  echo ""
  echo "RunEnvelope must be provided at exactly one production site"
  echo "(services/reasoning-service.ts, the strategy-dispatch boundary) plus the"
  echo "test seam (provideTestEnvelope in kernel/envelope/run-envelope.ts). A"
  echo "second provision site is two competing sources of truth for the same run."
  FAIL=1
else
  echo "OK (3/9): RunEnvelope provided only at the two sanctioned seams."
fi

# ── Check 4/4: every reasoning execute request carries an envelope ──
# The cascade moved the drop site UP, it did not delete it: three runtime
# builders each re-enumerated the config→envelope mapping by hand, and each
# ended in `as unknown as ReasoningExecuteRequest`, so the compiler checked
# nothing about `envelope` (review I3). They now all call
# `buildRunEnvelopeFromConfig` (runtime/src/engine/run-envelope-config.ts).
#
# Two rules, both re-scoped 2026-07-23 — see the `execute` mode above:
#   (a) a file that imports the ReasoningService TYPE and calls `.execute(`
#       (however the callee identifier is spelled) must reference the canonical
#       mapper, or be entirely exempt;
#   (b) each INLINE execute-request literal must carry `envelope:` within its
#       OWN braces — or an `ENVELOPE-EXEMPT:` marker at the call site naming why
#       not. The one exemption today is the verify JUDGE pass, whose "task" is a
#       verdict prompt, not the user's deliverable.
EXECUTE_ROOTS=(packages/runtime/src apps)
EXEC_FAILS="$(scan execute "${EXECUTE_ROOTS[@]}" | grep -v '^$' || true)"
if [ -n "$EXEC_FAILS" ]; then
  echo "FAIL (4/9): a ReasoningService.execute request is built without a RunEnvelope:"
  echo ""
  echo "$EXEC_FAILS"
  echo ""
  echo "Build it with buildRunEnvelopeFromConfig(config, extras) from"
  echo "runtime/src/engine/run-envelope-config.ts — the ONE config→envelope mapping."
  echo "A request with no envelope runs with .withApprovalPolicy() / .withContract()"
  echo "/ .withGrounding() / .withFabricationGuard() / .withStallPolicy() DISARMED."
  echo "If the pass genuinely must not carry one (a judge pass, whose output is a"
  echo "verdict and not the user's deliverable), put an 'ENVELOPE-EXEMPT:' comment"
  echo "at the call site saying why."
  FAIL=1
else
  echo "OK (4/9): every reasoning execute request carries an envelope."
fi

# ── Check 5/5: sub-agents inherit the parent's judgment + safety constraints ──
# A TRUE sub-agent runs under the same contract / fabrication guard / grounding /
# approval policy as its parent — its answer is judged, not rubber-stamped, and a
# gated tool it calls is refused rather than executed unattended (DEBT-REGISTER
# §3, 2026-07-23). The child is built by `buildLightRuntimeConfig` (runtime.ts)
# from options threaded through `SubAgentExecutorDeps`. This is the SAME defect
# class one process boundary out: a new cross-cutting policy field added to the
# envelope but NOT threaded here silently drops on every sub-agent.
#
# Guard both ends of the seam: the child config helper must MAP each inheritable
# policy field, and the executor deps must DECLARE the parent-side carrier. The
# three detach-only rails (approvalDecision / interactionResponse, plus the
# durable-pause half of approvalPolicy) are deliberately NOT child-inheritable —
# a light runtime has no durable store — so only the policy-half + approval are
# checked. If you add a new inheritable field, add it here too.
SUBAGENT_FAIL=""
LIGHT_CONFIG_FILE="packages/runtime/src/runtime.ts"
EXECUTOR_DEPS_FILE="packages/runtime/src/builder/build-effect/sub-agent-executor.ts"
# Scope to the buildLightRuntimeConfig body ONLY. `createRuntime` (the FULL
# runtime) in the same file maps the same fields for the PARENT, so a whole-file
# grep would pass vacuously even if the child mapping were deleted. Extract from
# the helper's declaration to its `return config;`.
LIGHT_CONFIG_BODY="$(awk '/export const buildLightRuntimeConfig = /{f=1} f{print} f&&/^  return config;/{exit}' "$LIGHT_CONFIG_FILE")"
if [ -z "$LIGHT_CONFIG_BODY" ]; then
  SUBAGENT_FAIL="${SUBAGENT_FAIL}\n  could not locate buildLightRuntimeConfig body (runtime.ts) — did it move or get renamed?"
fi
for pair in \
  "taskContract:parentTaskContract" \
  "fabricationGuard:parentFabricationGuard" \
  "grounding:parentGrounding" \
  "approvalPolicy:parentApprovalPolicy"; do
  child_field="${pair%%:*}"
  parent_field="${pair##*:}"
  # taskContract/fabricationGuard/grounding map directly (`X: options.X`);
  # approvalPolicy is a block-coercion literal keyed on `options.approvalPolicy`.
  if [ "$child_field" = "approvalPolicy" ]; then
    child_pattern="options.approvalPolicy"
  else
    child_pattern="${child_field}: options.${child_field}"
  fi
  if ! printf '%s' "$LIGHT_CONFIG_BODY" | grep -qF "$child_pattern"; then
    SUBAGENT_FAIL="${SUBAGENT_FAIL}\n  buildLightRuntimeConfig does not map '${child_field}' (runtime.ts)"
  fi
  if ! grep -qF "$parent_field" "$EXECUTOR_DEPS_FILE"; then
    SUBAGENT_FAIL="${SUBAGENT_FAIL}\n  SubAgentExecutorDeps does not thread '${parent_field}' (sub-agent-executor.ts)"
  fi
done
if [ -n "$SUBAGENT_FAIL" ]; then
  echo "FAIL (5/9): a sub-agent does NOT inherit a cross-cutting policy field:"
  echo -e "$SUBAGENT_FAIL"
  echo ""
  echo "Thread it: add the field to LightRuntimeOptions + map it in"
  echo "buildLightRuntimeConfig (runtime.ts), declare parent<Field> on"
  echo "SubAgentExecutorDeps, and pass it through tool-mcp-registrations + builder.ts."
  echo "A dropped field means a child runs UNJUDGED / UNGATED where the parent does not."
  FAIL=1
else
  echo "OK (5/9): sub-agents inherit the parent's judgment + safety constraints."
fi

# ── Check 6: the approval policy is declared ONCE ────────────────────────────
#
# Same defect class as the cascade itself, one level up: the approval policy's
# shape was hand-copied at FOUR sites (KernelInput, ReactiveAgentsConfig,
# RuntimeOptions, ApprovalPolicyConfig). Adding block mode's `onApprove` had to
# touch all four, and a site that misses a field silently drops it — which is
# how `mode: "block"` shipped as an inert safety switch in the first place.
#
# The stage shapes now derive from one canonical declaration in approval-gate.ts
# (resolved → configured → authored). The `"detach" | "block"` union is the
# fingerprint of a hand-rolled copy: it appears exactly where the shape is
# DECLARED. So it must occur in that one file and nowhere else in src.
#
# Tests are excluded — a test may legitimately spell a mode literal inline.
APPROVAL_OWNER="packages/reasoning/src/kernel/capabilities/act/approval-gate.ts"
APPROVAL_SITES="$(grep -rlF '"detach" | "block"' --include='*.ts' packages/*/src 2>/dev/null \
  | grep -v '\.test\.ts$' | sort -u)"
APPROVAL_STRAY="$(printf '%s\n' "$APPROVAL_SITES" | grep -v "^${APPROVAL_OWNER}$" | grep -v '^$' || true)"
if [ ! -f "$APPROVAL_OWNER" ]; then
  echo "FAIL (6/9): the canonical approval-policy declaration is missing:"
  echo "  expected $APPROVAL_OWNER"
  FAIL=1
elif ! grep -qF 'export type ApprovalMode = "detach" | "block";' "$APPROVAL_OWNER"; then
  echo "FAIL (6/9): $APPROVAL_OWNER no longer declares the canonical ApprovalMode union."
  echo "  If it moved, update APPROVAL_OWNER here — do not delete the check."
  FAIL=1
elif [ -n "$APPROVAL_STRAY" ]; then
  echo "FAIL (6/9): the approval-policy shape is re-declared outside its owner:"
  echo "$APPROVAL_STRAY" | sed 's/^/  /'
  echo ""
  echo "Type these from the canonical stage shapes in approval-gate.ts instead:"
  echo "  ResolvedApprovalPolicy   — kernel/envelope rails (tools Set, Effect decide)"
  echo "  ConfiguredApprovalPolicy — agent config / RuntimeOptions (tools array, onApprove)"
  echo "  AuthoredApprovalPolicy   — the public .withApprovalPolicy() argument"
  echo "A hand-copied shape drops the next field added to it — that is how"
  echo "mode:\"block\" shipped as a safety switch that gated nothing."
  FAIL=1
else
  echo "OK (6/9): the approval policy is declared once, and each stage derives from it."
fi

# ── Check 7: every reasoning pass absorbs its ledger ─────────────────────────
#
# Wave C.2: a run executes reasoning up to three ways (terminal pass,
# verification retry, post-think continuation), each a separate kernel execution
# whose ledger starts at seq 0, and each auxiliary pass OVERWRITES
# `ctx.metadata.reasoningResult`. A pass site that stores a result without
# absorbing its ledger into the run-scoped one (engine/run-ledger-scope.ts)
# silently discards every fact that pass recorded — the cascade's own defect
# class, on the ledger.
#
# The fingerprint of a pass site is BOTH normalizing a reasoning result and
# storing it as `reasoningResult:`. Every file that does both must also name one
# of the two absorbers, so adding a fourth pass site fails here instead of
# quietly losing a pass's evidence.
#
# Normalizing is what distinguishes a real pass from `cache-check.ts`, which
# stores a SYNTHETIC result for a semantic-cache hit: no kernel pass ran, so
# there is no ledger to absorb (and none to show — a cache hit returns an answer
# with no run evidence at all, noted in DEBT-REGISTER §3).
#
# HONEST SCOPE: a future site that stores a raw, un-normalized result would slip
# past this — but such a site is already broken for the other reasons
# `normalizeReasoningResult` exists (it is the whitelist boundary that every
# metadata field crosses).
LEDGER_ABSORB_FAIL=""
PASS_SITE_FILES="$(grep -rlE '^\s*reasoningResult: ' --include='*.ts' \
  packages/runtime/src/engine 2>/dev/null | grep -v '\.test\.ts$' | sort -u \
  | xargs -r grep -lF 'normalizeReasoningResult(' | sort -u)"
if [ -z "$PASS_SITE_FILES" ]; then
  LEDGER_ABSORB_FAIL="\n  found NO reasoning pass sites at all — did 'reasoningResult:' get renamed?"
else
  for f in $PASS_SITE_FILES; do
    if ! grep -qE 'absorbedLedgerMetadata|seedRunLedger' "$f"; then
      LEDGER_ABSORB_FAIL="${LEDGER_ABSORB_FAIL}\n  ${f} stores a reasoning result but never absorbs its ledger"
    fi
  done
fi
if [ -n "$LEDGER_ABSORB_FAIL" ]; then
  echo "FAIL (7/9): a reasoning pass drops its RunLedger:"
  echo -e "$LEDGER_ABSORB_FAIL"
  echo ""
  echo "Spread the absorber into the metadata the pass site returns:"
  echo "  ...absorbedLedgerMetadata(ctx.metadata, <result>, \"continuation\")"
  echo "(the run's PRIMARY pass seeds instead: [RUN_LEDGER_METADATA_KEY]: seedRunLedger(result))"
  echo "A pass that is not absorbed loses every fact it recorded — its tool calls,"
  echo "artifacts and verdicts never reach the receipt."
  FAIL=1
else
  echo "OK (7/9): every reasoning pass absorbs its ledger into the run-scoped one."
fi

# ── Check 8: volatile content does not render into the cached system prompt ──
#
# F10: per-iteration content (the standing frame, the `Remaining steps:` line)
# sitting in the system prompt invalidates Anthropic's cache prefix every turn
# — measured cacheRead 0 on the default kernel path before this was fixed.
# Delegates to check-volatile-placement.sh, which lives in its own script for
# the same reason check-ledger-writes.sh and check-run-contract.sh do: a
# narrowly-scoped invariant with its own red-on-cut proof is easier to keep
# honest than one more branch bolted onto this file.
VOLATILE_OUT="$(mktemp)"
if ! ./scripts/check-volatile-placement.sh > "$VOLATILE_OUT" 2>&1; then
  echo "FAIL (8/9): volatile content is rendered into the cached system prompt:"
  sed 's/^/  /' "$VOLATILE_OUT"
  FAIL=1
else
  echo "OK (8/9): volatile content renders in the message tail, not the cached prefix."
fi
rm -f "$VOLATILE_OUT"

# ── Check 9: every default-on mechanism is independently ablatable ──────────
#
# Task 15 (A-tier gap-closure gate 3, ablatability audit, 2026-07-28):
# `RA_LAZY_TOOLS` gated three independent mechanisms at three call sites in
# two directions, which is exactly why F3 ("the kernel spends model calls
# discovering tools the inline path simply uses") could not be measured for
# months — there was no way to turn discovery off while leaving the pruning
# that creates the need for discovery in place. Delegates to
# check-ablatable.sh, which lives in its own script for the same reason
# check-volatile-placement.sh does: a narrowly-scoped invariant with its own
# red-on-cut proof is easier to keep honest than one more branch bolted onto
# this file. See wiki/Research/Audit-Reports-2026-07-28/ablatability.md for
# the full mechanism-by-mechanism inventory this check protects.
ABLATABLE_OUT="$(mktemp)"
if ! ./scripts/check-ablatable.sh > "$ABLATABLE_OUT" 2>&1; then
  echo "FAIL (9/9): a RA_* mechanism flag is read outside a named resolver:"
  sed 's/^/  /' "$ABLATABLE_OUT"
  FAIL=1
else
  echo "OK (9/9): every RA_* mechanism flag resolves through a named resolver."
fi
rm -f "$ABLATABLE_OUT"

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "Cross-cutting cascade invariant VIOLATED — see failures above."
  exit 1
fi

echo ""
echo "Cross-cutting cascade invariants hold."
exit 0
