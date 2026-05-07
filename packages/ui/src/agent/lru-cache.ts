export class LruCache<TValue> {
  private readonly values = new Map<string, { readonly value: TValue; readonly size: number }>();
  private totalSize = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxSize: number,
  ) {}

  get(key: string): TValue | null {
    const entry = this.values.get(key);
    if (entry === undefined) {
      return null;
    }

    this.values.delete(key);
    this.values.set(key, entry);
    return entry.value;
  }

  set(key: string, value: TValue, size: number): void {
    const previous = this.values.get(key);
    if (previous !== undefined) {
      this.totalSize -= previous.size;
      this.values.delete(key);
    }

    this.values.set(key, { value, size });
    this.totalSize += size;
    this.trim();
  }

  private trim(): void {
    while (this.values.size > this.maxEntries || this.totalSize > this.maxSize) {
      const oldestKey = this.values.keys().next().value as string | undefined;
      if (oldestKey === undefined) {
        return;
      }

      const oldest = this.values.get(oldestKey);
      this.values.delete(oldestKey);
      this.totalSize -= oldest?.size ?? 0;
    }
  }
}
