export class AsyncLock {
  static #tails = new Map();

  static async run(key, task) {
    const lockKey = String(key || "default");
    const previous = this.#tails.get(lockKey) ?? Promise.resolve();

    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.#tails.set(lockKey, tail);

    await previous.catch(() => undefined);

    try {
      return await task();
    } finally {
      release();
      if (this.#tails.get(lockKey) === tail) this.#tails.delete(lockKey);
    }
  }
}
