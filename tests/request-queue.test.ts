import { describe, expect, it, vi } from "vitest";
import { SequentialRequestQueue } from "@/lib/reverse-search/request-queue";

describe("SequentialRequestQueue", () => {
  it("runs tasks one at a time in enqueue order", async () => {
    const queue = new SequentialRequestQueue(0);
    const events: string[] = [];

    const first = queue.run(async () => {
      events.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push("first:end");
      return 1;
    });
    const second = queue.run(async () => {
      events.push("second:start");
      return 2;
    });

    expect(await first).toBe(1);
    expect(await second).toBe(2);
    // The second task must not start until the first has fully finished.
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("spaces consecutive task starts at least minIntervalMs apart under concurrency", async () => {
    vi.useFakeTimers();
    try {
      const queue = new SequentialRequestQueue(250);
      const starts: number[] = [];

      const all = Promise.all(
        Array.from({ length: 3 }, () =>
          queue.run(async () => {
            starts.push(Date.now());
          }),
        ),
      );
      await vi.advanceTimersByTimeAsync(1000);
      await all;

      expect(starts).toHaveLength(3);
      for (let i = 1; i < starts.length; i += 1) {
        expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(250);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects only the failing caller and keeps the queue usable", async () => {
    const queue = new SequentialRequestQueue(0);

    await expect(
      queue.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    let ran = false;
    await expect(
      queue.run(async () => {
        ran = true;
      }),
    ).resolves.toBeUndefined();
    expect(ran).toBe(true);
  });
});
