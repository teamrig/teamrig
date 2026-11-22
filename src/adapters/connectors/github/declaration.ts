import type { ConnectorDeclaration, Support } from '../../../plugin-api/index.ts';

/**
 * What runs on GitHub today. A row with no proof yet shows unproved on the parity page until a live run on the
 * operating system it names is recorded.
 */
const SUPPORTED: Support = { kind: 'supported', proofs: [] };

/**
 * A feature proved on Windows by the runs of 2026-11-23 (gh 2.101.0), its record under the feature id's heading in
 * docs/proofs/github.md (a heading's anchor drops the id's dot).
 */
function provedOnWindows(feature: string): Support {
  return {
    kind: 'supported',
    proofs: [{ os: 'windows', toolVersion: '2.101.0', date: '2026-11-23', evidence: `proofs/github.md#${feature.replaceAll('.', '')}` }],
  };
}

export const declaration: ConnectorDeclaration = {
  apiVersion: '0.1.0',
  id: 'github',
  name: 'GitHub',
  kinds: ['tracker', 'codehost'],
  refPrefix: 'gh:',
  terms: ['GitHub', 'gh', 'pull request'],
  // GitHub's keys are still the team config's own `github` section, which the commands read.
  configKeys: {},
  manifest: {
    'tracker.issue-import': provedOnWindows('tracker.issue-import'),
    'tracker.accept-label': SUPPORTED,
    'tracker.watch': provedOnWindows('tracker.watch'),
    'tracker.issue-open': SUPPORTED,
    'tracker.comment': SUPPORTED,
    'tracker.edit-body': SUPPORTED,
    'tracker.close': SUPPORTED,
    'tracker.labels': SUPPORTED,
    'tracker.status-push': SUPPORTED,
    'tracker.assign': SUPPORTED,
    'tracker.claims': SUPPORTED,
    'tracker.clocks': provedOnWindows('tracker.clocks'),
    'tracker.mentions': provedOnWindows('tracker.mentions'),
    'tracker.follow': SUPPORTED,
    'tracker.links': SUPPORTED,
    'tracker.fields': SUPPORTED,
    'tracker.similar': SUPPORTED,
    'tracker.security-alert': SUPPORTED,
    'tracker.stamp': SUPPORTED,
    'tracker.hidden-mark': { kind: 'unsupported', notice: 'GitHub shows every mark on an issue to its readers: a mark there is a label or a comment' },
    'codehost.pull-news': provedOnWindows('codehost.pull-news'),
    'codehost.ci-excerpt': provedOnWindows('codehost.ci-excerpt'),
    'codehost.pr-conflicts': SUPPORTED,
    'codehost.pr-land': SUPPORTED,
    'codehost.review-posts': SUPPORTED,
    'codehost.linked-pulls': SUPPORTED,
  },
};
