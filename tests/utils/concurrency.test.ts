import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '../../src/utils/concurrency';

describe('utils/concurrency — mapWithConcurrency', () => {
  it("conserve l'ordre des entrées quel que soit l'ordre d'achèvement", async () => {
    const items = [30, 5, 20, 1];
    const out = await mapWithConcurrency(items, 4, async ms => {
      await new Promise(r => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual(items);
  });

  it('ne dépasse jamais la limite de parallélisme', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      3,
      async () => {
        peak = Math.max(peak, ++inFlight);
        await new Promise(r => setTimeout(r, 1));
        inFlight--;
        return null;
      },
    );

    expect(peak).toBe(3);
  });

  it('accepte une liste vide', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});
