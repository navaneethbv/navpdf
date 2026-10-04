/** Maximum number of earlier views kept for Previous View. */
export const VIEW_HISTORY_LIMIT = 100;

/**
 * Previous View and Next View for page jumps made through links, bookmarks, thumbnails,
 * search results and page commands. Ordinary scrolling is not recorded.
 */
export class ViewHistory {
  private readonly back: number[] = [];
  private readonly forward: number[] = [];

  /** Records the page being left by a jump. A new jump clears Next View. */
  record(from: number) {
    if (!Number.isInteger(from) || from < 1) return;
    if (this.back.at(-1) !== from) this.back.push(from);
    if (this.back.length > VIEW_HISTORY_LIMIT) this.back.shift();
    this.forward.length = 0;
  }

  /** The page to show for Previous View, or null when there is none. */
  previous(current: number, pageCount: number): number | null {
    return this.step(this.back, this.forward, current, pageCount);
  }

  /** The page to show for Next View, or null when there is none. */
  next(current: number, pageCount: number): number | null {
    return this.step(this.forward, this.back, current, pageCount);
  }

  get canGoBack() {
    return this.back.length > 0;
  }

  get canGoForward() {
    return this.forward.length > 0;
  }

  clear() {
    this.back.length = 0;
    this.forward.length = 0;
  }

  private step(from: number[], to: number[], current: number, pageCount: number): number | null {
    for (let page = from.pop(); page !== undefined; page = from.pop()) {
      // Pages removed by an edit, and the page already shown, are skipped.
      if (page > pageCount || page === current) continue;
      to.push(current);
      return page;
    }
    return null;
  }
}
