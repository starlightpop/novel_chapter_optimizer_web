import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const UPSTREAM_RULES_DIR = path.resolve('D:\\AAA~test\\ds_ai_optimize\\rules');
const LOCAL_RULES_DIR = path.resolve('rules');
const SYNC_STATE_PATH = path.resolve('data', 'sync_state.json');

function ensureDirs() {
    for (const dir of [LOCAL_RULES_DIR, path.dirname(SYNC_STATE_PATH)]) {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
}

function hashText(text) {
    return crypto.createHash('sha256').update(text || '', 'utf8').digest('hex');
}

function readSyncState() {
    if (!fs.existsSync(SYNC_STATE_PATH)) return {};
    try {
        return JSON.parse(fs.readFileSync(SYNC_STATE_PATH, 'utf8'));
    } catch (_) {
        return {};
    }
}

function writeSyncState(state) {
    fs.writeFileSync(SYNC_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function syncFile(fileName) {
    const sourcePath = path.resolve(UPSTREAM_RULES_DIR, fileName);
    const targetPath = path.resolve(LOCAL_RULES_DIR, fileName);

    if (!fs.existsSync(sourcePath)) {
        if (!fs.existsSync(targetPath)) {
            fs.writeFileSync(targetPath, `# ${fileName}\n\n(上游规则文件不存在)\n`, 'utf8');
        }
        return { fileName, changed: false, hash: hashText(fs.readFileSync(targetPath, 'utf8')), note: 'missing_upstream' };
    }

    const sourceContent = fs.readFileSync(sourcePath, 'utf8');
    const sourceHash = hashText(sourceContent);

    if (!fs.existsSync(targetPath)) {
        fs.writeFileSync(targetPath, sourceContent, 'utf8');
        return { fileName, changed: true, hash: sourceHash, note: 'created' };
    }

    const targetContent = fs.readFileSync(targetPath, 'utf8');
    const targetHash = hashText(targetContent);
    if (targetHash === sourceHash) {
        return { fileName, changed: false, hash: sourceHash, note: 'unchanged' };
    }

    fs.writeFileSync(targetPath, sourceContent, 'utf8');
    return { fileName, changed: true, hash: sourceHash, note: 'updated' };
}

export function syncRulesFromUpstream() {
    ensureDirs();

    const files = ['polishing_rules.md', 'error_cases.md'];
    const result = files.map(syncFile);
    const previousState = readSyncState();
    const nextState = {
        updated_at: new Date().toISOString(),
        upstream_rules_dir: UPSTREAM_RULES_DIR,
        files: {}
    };

    for (const item of result) {
        nextState.files[item.fileName] = { hash: item.hash, note: item.note };
    }

    const changed = result.some((item) => {
        const prev = previousState.files?.[item.fileName]?.hash;
        return prev !== item.hash;
    });

    writeSyncState(nextState);

    return {
        changed,
        details: result,
        localRulesDir: LOCAL_RULES_DIR,
        upstreamRulesDir: UPSTREAM_RULES_DIR
    };
}

export function loadLocalRuleFiles() {
    const polishingPath = path.resolve(LOCAL_RULES_DIR, 'polishing_rules.md');
    const errorCasesPath = path.resolve(LOCAL_RULES_DIR, 'error_cases.md');

    const polishingRules = fs.existsSync(polishingPath) ? fs.readFileSync(polishingPath, 'utf8') : '';
    const errorCases = fs.existsSync(errorCasesPath) ? fs.readFileSync(errorCasesPath, 'utf8') : '';

    return { polishingRules, errorCases, polishingPath, errorCasesPath };
}
