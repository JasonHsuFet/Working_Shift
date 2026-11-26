// Sizing rules for web/css/style.css (see the comment at its top).
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../web/css/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// Innermost { … } blocks hold the declarations, also inside @media and @keyframes.
const declarations = [...css.matchAll(/\{([^{}]*)\}/g)].flatMap(([, block]) => block.split(';')
    .map(part => part.trim()).filter(Boolean)
    .map(part => {
        const colon = part.indexOf(':');
        return { property: part.slice(0, colon).trim(), value: part.slice(colon + 1).trim() };
    }));
const where = ({ property, value }) => `${property}: ${value}`;

// px only for border* (including border-radius) and *shadow.
const strayPx = declarations.filter(({ property, value }) => /\dpx\b/.test(value) && !/^border(-|$)|shadow$/.test(property));
assert.deepEqual(strayPx.map(where), [], 'px outside border/shadow');
for (const [, query] of css.matchAll(/@media([^{]+)\{/g)) assert.ok(!/\dpx\b/.test(query), `px in @media${query}`);

// No em: it compounds through nested elements. rem or ch instead.
assert.deepEqual(declarations.filter(({ value }) => /\d(?:\.\d+)?em\b/.test(value)).map(where), [], 'em units');

// font-size, padding, margin and gap: tokens or an explicit rem (0, auto and safe-area env() also allowed).
const spacing = /^(font-size|padding(-\w+)?|margin(-\w+)?|gap|row-gap|column-gap|inset)$/;
const allowed = /var\(--(space|text)-[\w-]+\)|env\([^)]*\)|-?\d*\.?\d+rem\b|\b(calc|max|min|clamp|auto|inherit)\b|\b0\b|[\s()+*/,-]/g;
const offScale = declarations.filter(({ property, value }) => spacing.test(property) && value.replace(allowed, '') !== '');
assert.deepEqual(offScale.map(where), [], 'sizes off the token scale');

// Every token used is defined; tokens are rem or clamp().
const defined = new Map([...css.matchAll(/(--(?:space|text)-[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
for (const [, name] of css.matchAll(/var\((--(?:space|text)-[\w-]+)\)/g)) assert.ok(defined.has(name), `undefined token ${name}`);
for (const [name, value] of defined) assert.match(value, /^(-?\d*\.?\d+rem|clamp\(.*\))$/, `${name} is not rem or clamp()`);

// Headings use the clamp() tokens.
for (const tag of ['h1', 'h2', 'h3']) {
    const size = new RegExp(`(?:^|\\})\\s*${tag}\\s*\\{[^}]*font-size:\\s*var\\((--text-[\\w-]+)\\)`).exec(css)?.[1];
    assert.ok(size && defined.get(size).startsWith('clamp('), `${tag} font-size should be a clamp() token`);
}

console.log(`ok (${declarations.length} declarations, ${defined.size} tokens)`);
