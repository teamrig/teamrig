import { processDeps, routeChildCoverage } from './child-coverage.ts';

// Loaded by the coverage run's `--import` in the runner and every test-file process it starts (T5551).
routeChildCoverage(processDeps(process));
