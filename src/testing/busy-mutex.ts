import { LockBusyError, type Mutex } from '../core/lock.ts';

/** A `Mutex` another process holds past every wait: each run is refused with LockBusyError and never runs the task. */
export class BusyMutex implements Mutex {
  async run<T>(): Promise<T> {
    throw new LockBusyError('versions.lock', 0);
  }
}
