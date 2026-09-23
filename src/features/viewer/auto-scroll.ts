export const AUTO_SCROLL_SPEEDS = [20, 40, 70, 110, 160, 240] as const;
const DEFAULT_SPEED = 1;

export interface AutoScrollHost {
  container: HTMLElement;
  /** Advances a single-page view; returns false at the last page. */
  nextPage(): boolean;
  onChange(active: boolean): void;
}

type Frame = (callback: (time: number) => void) => number;
type CancelFrame = (handle: number) => void;

/** Automatically scrolls the document at a steady, adjustable speed in pixels per second. */
export class AutoScroll {
  private handle: number | null = null;
  private last: number | null = null;
  private speed: number = DEFAULT_SPEED;
  private carry = 0;

  constructor(
    private readonly host: AutoScrollHost,
    private readonly frame: Frame = (callback) => requestAnimationFrame(callback),
    private readonly cancelFrame: CancelFrame = (handle) => cancelAnimationFrame(handle),
  ) {}

  get active() {
    return this.handle !== null;
  }

  get pixelsPerSecond() {
    return AUTO_SCROLL_SPEEDS[this.speed];
  }

  toggle() {
    if (this.active) this.stop();
    else this.start();
  }

  start() {
    if (this.active) return;
    this.last = null;
    this.carry = 0;
    this.handle = this.frame(this.tick);
    this.host.onChange(true);
  }

  stop() {
    if (this.handle === null) return;
    this.cancelFrame(this.handle);
    this.handle = null;
    this.host.onChange(false);
  }

  faster() {
    this.speed = Math.min(AUTO_SCROLL_SPEEDS.length - 1, this.speed + 1);
  }

  slower() {
    this.speed = Math.max(0, this.speed - 1);
  }

  private readonly tick = (time: number) => {
    if (this.handle === null) return;
    const elapsed = this.last === null ? 0 : Math.min(time - this.last, 100);
    this.last = time;
    const { container } = this.host;
    const bottom = container.scrollHeight - container.clientHeight;
    if (container.scrollTop >= bottom - 1) {
      if (!this.host.nextPage()) {
        this.stop();
        return;
      }
      container.scrollTop = 0;
    } else {
      // Scroll positions are whole pixels in WebKit, so fractional progress carries over.
      this.carry += (this.pixelsPerSecond * elapsed) / 1000;
      const step = Math.floor(this.carry);
      this.carry -= step;
      container.scrollTop = Math.min(bottom, container.scrollTop + step);
    }
    this.handle = this.frame(this.tick);
  };
}
