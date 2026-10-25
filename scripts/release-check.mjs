/**
 * Checks the extension zip before a release: only the built extension goes out. No docs, plans,
 * source, tests or source maps, and every script minified without comments, so the shipped code
 * can't be read back into the project or rebuilt from it.
 *
 * Usage: node scripts/release-check.mjs chrome-extension.zip
 */
import { execFileSync } from 'node:child_process';

const zip = process.argv[2] ?? 'chrome-extension.zip';
const files = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter(f => f && !f.endsWith('/'));

/** Paths that must never ship. */
const FORBIDDEN = [
    [/\.map$/i, 'source map'],
    [/\.(md|mdx|markdown)$/i, 'document'],
    [/\.(ts|tsx|jsx)$/i, 'source file'],
    [/(^|\/)(docs|src|e2e|test|tests|scripts|node_modules|\.vite|\.git)\//i, 'project folder'],
    [/(^|\/)(README|CHANGELOG|DEVELOPMENT|CLAUDE)(\.|$)/i, 'project document'],
    [/(^|\/)(package(-lock)?\.json|tsconfig[^/]*\.json|vite\.config\.[jt]s|knip\.json)$/i, 'project config'],
    [/\.(zip|crx|pem|env|log|html\.gz)$/i, 'stray file'],
];
/** Plain text is allowed only for the fonts' licenses (their license requires them with the fonts). */
const TEXT_ALLOWED = /^licenses\/[^/]+\.txt$/;

const problems = [];
for (const f of files) {
    for (const [re, what] of FORBIDDEN) if (re.test(f)) problems.push(`${what}: ${f}`);
    if (/\.txt$/i.test(f) && !TEXT_ALLOWED.test(f)) problems.push(`text file: ${f}`);
}

for (const f of files.filter(f => /\.(js|mjs|css|html)$/i.test(f))) {
    const code = execFileSync('unzip', ['-p', zip, f], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (/sourceMappingURL=/.test(code)) problems.push(`source map link: ${f}`);
    // A doc comment or a commented line means the file wasn't minified.
    if (/\/\*\*[\s\S]*?\*\//.test(code) || /^\s*\/\/ /m.test(code)) problems.push(`comments left in: ${f}`);
    if (/docs\/plans\//.test(code)) problems.push(`reference to the project's docs: ${f}`);
    if (/\.js$/.test(f) && code.split('\n').length > 50 && code.length / code.split('\n').length < 200) problems.push(`not minified: ${f}`);
}

if (problems.length) {
    console.error(`✗ ${zip}: ${problems.length} problem${problems.length === 1 ? '' : 's'}\n  ${problems.join('\n  ')}`);
    process.exit(1);
}
console.log(`✓ ${zip}: ${files.length} files, nothing but the built extension, every script minified.`);
