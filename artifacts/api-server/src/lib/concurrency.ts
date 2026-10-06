/**
 * At most `max` of something at once in this process, with up to `queue`
 * more allowed to wait their turn.
 *
 * Two things in this API are expensive enough that a crowd of them, rather
 * than any one, is the danger. An upload is held in memory whole -- up to
 * 50 MB -- before anything can look at it, so forty at once from one
 * forwarded family link could hold 2 GB and take the only API instance down
 * for every home. And a password check is about a quarter of a second of
 * one of the four threads Node keeps for slow work, so enough sign-in
 * attempts from enough addresses would queue every other user of those
 * threads behind them. A per-address rate limit answers neither: the crowd
 * can come from anywhere. A count kept for the whole process does.
 *
 * In memory, like the rate limiter, and for the same reason: there is one
 * instance. A second one would need its own, which is the right answer
 * anyway -- each instance's memory and threads are its own.
 */
export class Gate {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    readonly max: number,
    readonly queue = 0,
  ) {}

  /** Take a slot if one is free now. Never waits. */
  tryEnter(): boolean {
    if (this.running >= this.max) return false;
    this.running += 1;
    return true;
  }

  /**
   * Take a slot, waiting in line for one if need be. False, at once, when
   * the line is already as long as it is allowed to be.
   */
  async enter(): Promise<boolean> {
    if (this.tryEnter()) return true;
    if (this.waiting.length >= this.queue) return false;
    // `leave` hands its slot straight to the next in line, so the count
    // does not change on the way.
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    return true;
  }

  /** Give a slot back. Exactly once for each true from `enter` or `tryEnter`. */
  leave(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.running = Math.max(0, this.running - 1);
  }

  /** For the tests and the health of whoever is reading a log. */
  get inUse(): number {
    return this.running;
  }

  get inLine(): number {
    return this.waiting.length;
  }
}
