/**
 * `npm run pro:mock`: the mock backend on a fixed port for local work (`docs/onboarding/running-locally.md`).
 *   MOCK_PORT (default 8787), MOCK_HOST (default 127.0.0.1), MOCK_TOKEN (default dev-token),
 *   MOCK_SEED=demo to start with the demo recipe live (competitor `demo`, page type `product`), or
 *   MOCK_SEED=<file.json>[,<file.json>…] to start with those recipes live: `SeedRecipe`s (name, site, competitor,
 *   pageType, spec) or recipe files (`recipes/*.crawlpilot.json`).
 * Pro's Backend dialog takes its address and token; the crawler worker's `recipeStore` points at it too.
 */
import { readFileSync } from 'node:fs';
import { seedDemo, seedOf, seedRecipe, startMockServer } from './mockServer';

const port = Number(process.env.MOCK_PORT ?? 8787);
const host = process.env.MOCK_HOST ?? '127.0.0.1';
const token = process.env.MOCK_TOKEN ?? 'dev-token';

startMockServer({ port, host, token, onRequest: line => console.log(line) }).then(
    async s => {
        const seed = process.env.MOCK_SEED;
        if (seed === 'demo') {
            const { recipeId, digest } = await seedDemo(s.backend, token);
            console.log(`Seeded the demo recipe ${recipeId} (competitor demo, page type product), version 1 live, digest ${digest.slice(0, 12)}…`);
        } else if (seed) {
            for (const file of seed.split(',').map(f => f.trim()).filter(Boolean)) {
                const recipe = seedOf(JSON.parse(readFileSync(file, 'utf8')));
                const { recipeId, digest } = await seedRecipe(s.backend, recipe, token);
                console.log(`Seeded ${recipe.name} as ${recipeId} (competitor ${recipe.competitor}, page type ${recipe.pageType}), version 1 live, digest ${digest.slice(0, 12)}…`);
            }
        }
        console.log(`Mock backend on ${s.origin} (token "${token}"). State is in memory: it is gone when this stops. Ctrl-C to stop.`);
        const stop = () => { s.close(); process.exit(0); };
        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
    },
    e => { console.error(`Could not start the mock backend on ${host}:${port}: ${e instanceof Error ? e.message : e}`); process.exit(1); },
);
