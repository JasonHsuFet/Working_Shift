// Finds the cells filled with the leader orange straight from the .xlsx package, because SheetJS community edition does not expose cell fills.
import fs from 'node:fs';
import zlib from 'node:zlib';

const LEADER_FILL = 'FFFFC000';
const cache = new Map();

// Minimal ZIP reader: name -> bytes, via the central directory (no ZIP64, deflate or stored only).
function unzip(buffer) {
    let end = buffer.length - 22;
    while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
    if (end < 0) throw new Error('不是有效的 xlsx（找不到 ZIP 目錄）');
    const files = new Map();
    let offset = buffer.readUInt32LE(end + 16);
    for (let count = buffer.readUInt16LE(end + 10); count > 0; count--) {
        const method = buffer.readUInt16LE(offset + 10);
        const size = buffer.readUInt32LE(offset + 20);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const local = buffer.readUInt32LE(offset + 42);
        const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
        const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
        const data = buffer.subarray(start, start + size);
        files.set(name, () => (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8'));
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return files;
}

const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

// style index (cellXfs) -> true when its fill is the leader orange.
function leaderStyles(styles) {
    const fills = [...(/<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(styles)?.[1] ?? '').matchAll(/<fill>([\s\S]*?)<\/fill>/g)]
        .map(([, fill]) => /<patternFill[^>]*patternType="solid"/.test(fill) && /<fgColor[^>]*rgb="([0-9A-Fa-f]{8})"/.exec(fill)?.[1].toUpperCase() === LEADER_FILL);
    const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
    return [...xfs.matchAll(/<xf\b[^>]*>/g)].map(([tag]) => fills[Number(attr(tag, 'fillId'))] === true);
}

// Sheet name -> Set of "row,col" (0-based, absolute sheet coordinates) of leader-filled cells.
export function leaderCells(file) {
    if (cache.has(file)) return cache.get(file);
    const zip = unzip(fs.readFileSync(file));
    const read = name => zip.get(name)?.() ?? '';
    const styled = leaderStyles(read('xl/styles.xml'));
    const targets = new Map([...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)]
        .map(([tag]) => [attr(tag, 'Id'), attr(tag, 'Target').replace(/^\/?(xl\/)?/, 'xl/')]));
    const sheets = new Map();
    for (const [tag] of read('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
        const cells = new Set();
        const xml = read(targets.get(attr(tag, 'r:id')));
        for (const [cell] of xml.matchAll(/<c\b[^>]*>/g)) {
            if (!styled[Number(attr(cell, 's'))]) continue;
            const [, letters, row] = /^([A-Z]+)(\d+)$/.exec(attr(cell, 'r'));
            const col = [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
            cells.add(`${Number(row) - 1},${col}`);
        }
        sheets.set(attr(tag, 'name').replaceAll('&amp;', '&'), cells);
    }
    cache.set(file, sheets);
    return sheets;
}
