export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A clock the tests move by hand. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  set(to: Date): void {
    this.current = new Date(to.getTime());
  }
  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}
