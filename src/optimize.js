import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawnSync } from 'child_process';
import { launchBrowser, prepareDeepSeek } from './browser.js';
import { sendAndWaitResponse } from './deepseek.js';
import { buildOptimizationPrompt, buildRulesLoadPrompt, buildSegmentPrompt } from './prompts.js';
import { syncRulesFromUpstream, loadLocalRuleFiles } from './ruleSync.js';
import {
    hashText,
    loadText,
    saveText,
    parseChapterTitleAndBody,
    sanitizeFileName,
    getUniqueTargetPath,
    sanitizeOptimizedBody
} from './chapterTools.js';
import { log, colors, alert } from './utils.js';

const WORKSPACE_ROOT = path.resolve('workspace');
const STATE_PATH = path.resolve('data', 'chapter_state.json');

function ensureDirs() {
    for (const dir of ['data', 'rules', 'screenshots', 'workspace']) {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    const seeds = [
        path.resolve(WORKSPACE_ROOT, '示例小说', '00_原稿'),
        path.resolve(WORKSPACE_ROOT, '示例小说', '01_优化稿'),
        path.resolve(WORKSPACE_ROOT, '新小说放这里', '00_原稿'),
        path.resolve(WORKSPACE_ROOT, '新小说放这里', '01_优化稿')
    ];
    for (const seedDir of seeds) {
        if (!fs.existsSync(seedDir)) fs.mkdirSync(seedDir, { recursive: true });
    }
}

function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve((answer || '').trim());
        });
    });
}

function readState() {
    if (!fs.existsSync(STATE_PATH)) return { chapters: {} };
    try {
        const data = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
        if (!data.chapters || typeof data.chapters !== 'object') return { chapters: {} };
        return data;
    } catch (_) {
        return { chapters: {} };
    }
}

function writeState(state) {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function listDirectories(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .map((name) => ({ name, fullPath: path.resolve(dir, name) }))
        .filter((x) => fs.existsSync(x.fullPath) && fs.statSync(x.fullPath).isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function resolveNovelDirs(novelDir) {
    const candidates = [
        { original: '00_原稿', optimized: '01_优化稿' },
        { original: '原稿', optimized: '优化稿' }
    ];

    for (const item of candidates) {
        const originalDir = path.resolve(novelDir, item.original);
        const optimizedDir = path.resolve(novelDir, item.optimized);
        if (fs.existsSync(originalDir) && fs.statSync(originalDir).isDirectory()) {
            if (!fs.existsSync(optimizedDir)) fs.mkdirSync(optimizedDir, { recursive: true });
            return { originalDir, optimizedDir };
        }
    }

    const originalDir = path.resolve(novelDir, '00_原稿');
    const optimizedDir = path.resolve(novelDir, '01_优化稿');
    fs.mkdirSync(originalDir, { recursive: true });
    fs.mkdirSync(optimizedDir, { recursive: true });
    return { originalDir, optimizedDir };
}

function getSourceFiles(originalDir) {
    const allowExt = new Set(['.md', '.txt']);
    const entries = fs.readdirSync(originalDir, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const subDir = path.resolve(originalDir, entry.name);
        const childCount = fs.readdirSync(subDir).length;
        if (childCount === 0) {
            log(`[SKIP] 检测到空文件夹，自动跳过: ${subDir}`, colors.dim);
        }
    }

    return entries
        .filter((entry) => entry.isFile())
        .map((entry) => ({
            name: entry.name,
            fullPath: path.resolve(originalDir, entry.name),
            ext: path.extname(entry.name).toLowerCase()
        }))
        .filter((item) => allowExt.has(item.ext))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function renameFileByTitle(filePath, title) {
    const dir = path.dirname(filePath);
    const safeTitle = sanitizeFileName(title);
    const targetName = `${safeTitle}.md`;
    const targetPath = path.resolve(dir, targetName);

    if (path.resolve(filePath) === targetPath) return filePath;
    if (!fs.existsSync(targetPath)) {
        fs.renameSync(filePath, targetPath);
        return targetPath;
    }

    const uniquePath = getUniqueTargetPath(dir, targetName);
    fs.renameSync(filePath, uniquePath);
    return uniquePath;
}

function copyToClipboard(text) {
    const result = spawnSync('cmd', ['/c', 'clip'], { input: text, encoding: 'utf8' });
    if (result.error || result.status !== 0) {
        const detail = result.error?.message || result.stderr || 'unknown error';
        throw new Error(`复制到剪贴板失败: ${detail}`);
    }
}

async function chooseNovelRoot() {
    const root = WORKSPACE_ROOT;

    const novelDirs = listDirectories(root);
    if (novelDirs.length === 0) {
        throw new Error(`目录下没有小说子目录: ${root}`);
    }

    log(`工作区目录: ${root}`, colors.dim);
    log('可选小说目录:', colors.cyan);
    for (let i = 0; i < novelDirs.length; i++) {
        log(`  ${i + 1}. ${novelDirs[i].name}`, colors.dim);
    }

    const indexInput = await ask(`选择编号(1-${novelDirs.length}) > `);
    const index = Number.parseInt(indexInput, 10);
    if (!Number.isInteger(index) || index < 1 || index > novelDirs.length) {
        throw new Error(`无效编号: ${indexInput}`);
    }

    return novelDirs[index - 1];
}

function buildJobs(originalDir, optimizedDir, state) {
    const files = getSourceFiles(originalDir);
    const jobs = [];

    if (files.length === 0) {
        log(`[SKIP] 00_原稿为空或无可处理文件，自动跳过: ${originalDir}`, colors.yellow);
        return jobs;
    }

    for (const item of files) {
        const raw = loadText(item.fullPath);
        if (!raw || !raw.trim()) {
            log(`[SKIP] 空文件，自动跳过: ${item.name}`, colors.yellow);
            continue;
        }

        const { title, body, multiTitleDetected, ignoredTitles } = parseChapterTitleAndBody(raw);

        if (!title) {
            log(`[SKIP] 未识别章节标题: ${item.name}`, colors.yellow);
            continue;
        }

        if (!body || !body.trim()) {
            log(`[SKIP] 标题已识别但正文为空，自动跳过: ${item.name}`, colors.yellow);
            continue;
        }

        let renamedPath = item.fullPath;
        if (path.basename(item.fullPath) !== `${sanitizeFileName(title)}.md`) {
            renamedPath = renameFileByTitle(item.fullPath, title);
            log(`重命名: ${path.basename(item.fullPath)} -> ${path.basename(renamedPath)}`, colors.green);
        }

        if (multiTitleDetected) {
            log(`[WARN] 检测到多个章节标题，采用首个: ${title}；忽略: ${ignoredTitles.join(' | ')}`, colors.yellow);
        }

        const bodyHash = hashText(body);
        const chapterKey = path.resolve(renamedPath);
        const prev = state.chapters[chapterKey];

        const outputName = `${sanitizeFileName(title)}.ai.md`;
        const outputPath = path.resolve(optimizedDir, outputName);
        const alreadyDone = prev && prev.body_hash === bodyHash && fs.existsSync(outputPath);

        if (alreadyDone) {
            log(`[SKIP] 未变化: ${path.basename(renamedPath)}`, colors.dim);
            continue;
        }

        jobs.push({
            chapterKey,
            title,
            body,
            bodyHash,
            sourcePath: renamedPath,
            outputPath
        });
    }

    return jobs;
}

async function main() {
    ensureDirs();
    log('系统启动: 小说单章优化系统（网页串行版）', colors.bright + colors.cyan);

    let context;
    let page;

    try {
        log('Phase 1: 扫描并同步规则库...', colors.blue);
        const syncResult = syncRulesFromUpstream();
        const syncText = syncResult.changed ? '检测到更新并已同步' : '无更新，保持本地规则';
        log(`规则同步: ${syncText}`, colors.green);

        log('Phase 2: 选择小说目录...', colors.blue);
        const selected = await chooseNovelRoot();
        log(`已选择: ${selected.fullPath}`, colors.green);

        const { originalDir, optimizedDir } = resolveNovelDirs(selected.fullPath);
        log(`原稿目录: ${originalDir}`, colors.dim);
        log(`优化目录: ${optimizedDir}`, colors.dim);

        const state = readState();
        const initialJobs = buildJobs(originalDir, optimizedDir, state);

        if (initialJobs.length === 0) {
            log('没有待处理章节（可能都已处理或未识别标题）', colors.yellow);
            return;
        }

        log(`初始待处理章节: ${initialJobs.length}`, colors.green);

        log('Phase 3: 启动浏览器并连接 DeepSeek...', colors.blue);
        ({ context, page } = await launchBrowser());
        await prepareDeepSeek(page);

        const { polishingRules, errorCases } = loadLocalRuleFiles();
        const rulesAck = await sendAndWaitResponse(page, buildRulesLoadPrompt(polishingRules, errorCases), '规则加载');

        const rulesReady = /(请上传待处理内容|请发送正文|已就绪)/.test((rulesAck || '').trim());
        if (rulesReady) {
            log('规则加载阶段已返回可处理信号，跳过独立角色激活步骤', colors.green);
        } else {
            log('规则加载未返回可处理信号，执行角色激活补偿步骤', colors.yellow);
            await sendAndWaitResponse(page, buildOptimizationPrompt(), '系统角色激活');
        }

        log('Phase 4: 严格串行逐章优化（动态重扫）...', colors.magenta + colors.bright);
        let processedCount = 0;

        while (true) {
            const jobs = buildJobs(originalDir, optimizedDir, state);
            if (jobs.length === 0) break;

            const job = jobs[0];
            processedCount += 1;

            log('='.repeat(60), colors.cyan);
            log(`章节 ${processedCount}（当前队列${jobs.length}）: ${job.title}`, colors.bright + colors.cyan);
            log(`只发送正文: ${job.body.length} 字符`, colors.dim);

            const response = await sendAndWaitResponse(page, buildSegmentPrompt(job.body), `章节优化_${job.title}`);
            const polishedBody = sanitizeOptimizedBody(response);

            if (!polishedBody || polishedBody.length < Math.max(50, Math.floor(job.body.length * 0.2))) {
                throw new Error(`章节【${job.title}】返回内容过短，已终止以避免串章`);
            }

            copyToClipboard(polishedBody);

            const formattedOutput = `# ${job.title}\n\n${polishedBody}\n`;
            saveText(job.outputPath, formattedOutput);

            state.chapters[job.chapterKey] = {
                title: job.title,
                source_path: job.sourcePath,
                output_path: job.outputPath,
                body_hash: job.bodyHash,
                output_hash: hashText(formattedOutput),
                updated_at: new Date().toISOString()
            };
            writeState(state);

            log(`已复制并保存: ${job.outputPath}`, colors.green);
            log('已完成当前章节，准备重扫目录获取下一章（可识别运行中新增文件）', colors.dim);
        }

        log('='.repeat(60), colors.cyan);
        log(`全部章节优化完成（共处理${processedCount}章，仅单章输出，不合并）`, colors.bright + colors.green);
    } catch (error) {
        log(`致命错误: ${error.message}`, colors.red);
        alert();

        if (page) {
            try {
                const errorPath = path.resolve('screenshots', `error_${Date.now()}.png`);
                await page.screenshot({ path: errorPath });
                log(`错误截图: ${errorPath}`, colors.dim);
            } catch (_) {
                // ignore screenshot errors
            }
        }

        process.exitCode = 1;
    } finally {
        if (context) await context.close();
    }
}

main();













