import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const TITLE_PATTERNS = [
    /^(第\s*[0-9零一二三四五六七八九十百千万两]+\s*章[\s\u3000]*.+)$/,
    /^(第\s*[0-9零一二三四五六七八九十百千万两]+\s*章)$/,
    /^(楔子|序章|前言|引子|序幕|终章|尾声)$/
];

export function hashText(text) {
    return crypto.createHash('sha256').update(text || '', 'utf8').digest('hex');
}

export function loadText(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

export function saveText(filePath, text) {
    fs.writeFileSync(filePath, text, 'utf8');
}

export function sanitizeFileName(name) {
    return (name || '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
}

export function parseChapterTitleAndBody(text, scanLines = 20) {
    const lines = (text || '').split(/\r?\n/);
    const matched = [];

    for (let i = 0; i < Math.min(lines.length, scanLines); i++) {
        const line = lines[i].trim();
        if (!line) continue;

        for (const pattern of TITLE_PATTERNS) {
            if (pattern.test(line)) {
                matched.push({ lineIndex: i, title: normalizeTitle(line) });
                break;
            }
        }
    }

    if (matched.length === 0) {
        return {
            title: '',
            body: text.trim(),
            multiTitleDetected: false,
            ignoredTitles: []
        };
    }

    const first = matched[0];
    const ignoredTitles = matched.slice(1).map((m) => m.title);
    const bodyLines = lines.slice(first.lineIndex + 1);
    const body = bodyLines.join('\n').trim();

    return {
        title: first.title,
        body,
        multiTitleDetected: ignoredTitles.length > 0,
        ignoredTitles
    };
}

function normalizeTitle(raw) {
    return (raw || '')
        .replace(/\s+/g, ' ')
        .replace(/第\s*/g, '第')
        .replace(/\s*章\s*/g, '章 ')
        .trim();
}

export function getUniqueTargetPath(dir, desiredNameWithExt) {
    const ext = path.extname(desiredNameWithExt);
    const stem = desiredNameWithExt.slice(0, desiredNameWithExt.length - ext.length);
    let candidate = path.resolve(dir, desiredNameWithExt);
    let index = 2;

    while (fs.existsSync(candidate)) {
        candidate = path.resolve(dir, `${stem}_${index}${ext}`);
        index += 1;
    }

    return candidate;
}

export function sanitizeOptimizedBody(text) {
    const lines = (text || '').split(/\r?\n/);
    const cleaned = [];
    const junkLineRegex = /^(本章|本章节|章节|说明|备注|总结|已完成|优化完成|以上|以下|改写说明|我已|我已经|希望这版|如需|可以继续|继续上传)/;

    for (const raw of lines) {
        const line = raw.trim();
        if (!line) {
            cleaned.push('');
            continue;
        }

        if (line.startsWith('【') && line.endsWith('】')) continue;
        if (line.startsWith('- ') || line.startsWith('* ')) continue;
        if (junkLineRegex.test(line)) continue;
        cleaned.push(raw.trimEnd());
    }

    return stripLeadingTitleLine(cleaned.join('\n').trim());
}

function stripLeadingTitleLine(text) {
    const lines = (text || '').split(/\r?\n/);
    while (lines.length > 0) {
        const first = lines[0].trim();
        if (!first) {
            lines.shift();
            continue;
        }

        let hit = false;
        for (const pattern of TITLE_PATTERNS) {
            if (pattern.test(first)) {
                hit = true;
                break;
            }
        }
        if (hit) {
            lines.shift();
            continue;
        }
        break;
    }

    return lines.join('\n').trim();
}
