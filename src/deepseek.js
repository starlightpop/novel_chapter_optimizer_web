import fs from 'fs';
import path from 'path';
import { log, randomWait, pasteLikeHuman, colors } from './utils.js';

const INPUT_SELECTOR = 'textarea, [contenteditable="true"]';
const MESSAGE_SELECTOR = '.ds-markdown, .markdown-body, [class*="message-content"], [class*="message_content"], [class*="chat-message"], [class*="chat_message"]';
const ASSISTANT_BLOCK_SELECTOR = '.ds-markdown, .markdown-body';

const TIMEOUT_PROFILES = {
    short: { maxWaitMs: 180_000, minStableMs: 8_000, diagnoseAfterMs: 60_000 },
    default: { maxWaitMs: 300_000, minStableMs: 12_000, diagnoseAfterMs: 90_000 },
    long: { maxWaitMs: 600_000, minStableMs: 20_000, diagnoseAfterMs: 180_000 }
};

const STOP_CANDIDATES = [
    'button:has-text("停止")',
    'button:has-text("Stop")',
    'button[aria-label*="停止"]',
    'button[aria-label*="Stop"]',
    '[role="button"]:has-text("停止")',
    '[role="button"][aria-label*="停止"]'
];

function getProfile(label) {
    if (label.includes('反馈学习') || label.includes('深度分析')) return TIMEOUT_PROFILES.long;
    if (label.includes('段落优化') || label.includes('章节优化')) return TIMEOUT_PROFILES.long;
    if (label.includes('系统角色')) return TIMEOUT_PROFILES.short;
    return TIMEOUT_PROFILES.default;
}

function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
}

function hasMeaningfulChange(beforeText, afterText) {
    const before = normalizeText(beforeText);
    const after = normalizeText(afterText);
    return after.length > 5 && after !== before && after.length >= Math.max(8, before.length + 3);
}

async function getInputText(input) {
    try {
        return await input.inputValue();
    } catch (_) {
        try {
            return await input.evaluate((el) => el.innerText || el.textContent || '');
        } catch (_) {
            return '';
        }
    }
}

async function getMessageSnapshot(page) {
    return await page.evaluate(({ genericSelector, assistantSelector }) => {
        const nodes = Array.from(document.querySelectorAll(genericSelector));
        const texts = nodes
            .map((node) => (node.innerText || node.textContent || '').trim())
            .filter(Boolean);

        const assistantNodes = Array.from(document.querySelectorAll(assistantSelector));
        const assistantTexts = assistantNodes
            .map((node) => (node.innerText || node.textContent || '').trim())
            .filter(Boolean);

        return {
            count: nodes.length,
            lastText: texts[texts.length - 1] || '',
            longestText: texts.reduce((best, text) => (text.length > best.length ? text : best), ''),
            combinedTail: texts.slice(-3).join('\n\n---\n\n'),
            assistantCount: assistantTexts.length,
            lastAssistantText: assistantTexts[assistantTexts.length - 1] || '',
            assistantTail: assistantTexts.slice(-3).join('\n\n---\n\n')
        };
    }, { genericSelector: MESSAGE_SELECTOR, assistantSelector: ASSISTANT_BLOCK_SELECTOR }).catch(() => ({
        count: 0,
        lastText: '',
        longestText: '',
        combinedTail: '',
        assistantCount: 0,
        lastAssistantText: '',
        assistantTail: ''
    }));
}

async function isStillGenerating(page) {
    for (const selector of STOP_CANDIDATES) {
        const candidate = page.locator(selector).first();
        const visible = await candidate.isVisible().catch(() => false);
        if (!visible) continue;

        const disabled = await candidate.isDisabled().catch(async () => {
            const attr = await candidate.getAttribute('disabled').catch(() => null);
            return attr !== null;
        });

        if (!disabled) return true;
    }
    return false;
}

async function waitUntilIdle(page, label, maxWaitMs = 120_000) {
    const startedAt = Date.now();
    let stableIdleTicks = 0;

    while (true) {
        const generating = await isStillGenerating(page);
        if (!generating) {
            stableIdleTicks += 1;
            if (stableIdleTicks >= 3) return;
        } else {
            stableIdleTicks = 0;
        }

        if (Date.now() - startedAt >= maxWaitMs) {
            throw new Error(`[${label}] 页面长时间处于生成中，未进入可发送状态`);
        }

        await randomWait(700, 900);
    }
}

async function diagnoseWait(page, label, baselineSnapshot, currentSnapshot, elapsedMs) {
    const safeLabel = label.replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
    const stamp = Date.now();
    const screenshotPath = path.resolve('screenshots', `diag_${safeLabel}_${stamp}.png`);
    const textPath = path.resolve('screenshots', `diag_${safeLabel}_${stamp}.txt`);

    if (!fs.existsSync('screenshots')) fs.mkdirSync('screenshots');

    try {
        await page.screenshot({ path: screenshotPath, fullPage: false });
    } catch (_) {}

    const report = [
        `label: ${label}`,
        `elapsedMs: ${elapsedMs}`,
        `selector: ${MESSAGE_SELECTOR}`,
        `baseline.count: ${baselineSnapshot.count}`,
        `current.count: ${currentSnapshot.count}`,
        `baseline.assistantCount: ${baselineSnapshot.assistantCount}`,
        `current.assistantCount: ${currentSnapshot.assistantCount}`,
        `baseline.lastAssistantText.length: ${baselineSnapshot.lastAssistantText.length}`,
        `current.lastAssistantText.length: ${currentSnapshot.lastAssistantText.length}`,
        '',
        '[current.lastAssistantText.head]',
        currentSnapshot.lastAssistantText.slice(0, 800)
    ].join('\n');

    fs.writeFileSync(textPath, report, 'utf8');
    log(`[${label}] 诊断截图: ${screenshotPath}`, colors.yellow);
    log(`[${label}] 诊断文本: ${textPath}`, colors.yellow);
}

async function clickSendButton(page) {
    const candidates = 'button[type="submit"], button:has-text("发送"), button:has-text("Send"), button[aria-label*="Send"], button[aria-label*="发送"], button[class*="ds-icon-button"]';
    const buttons = await page.locator(candidates).all();

    for (let index = buttons.length - 1; index >= 0; index--) {
        const button = buttons[index];
        const visible = await button.isVisible().catch(() => false);
        const disabled = (await button.getAttribute('disabled').catch(() => null)) !== null;
        if (visible && !disabled) {
            await button.click();
            return true;
        }
    }
    return false;
}

async function sendPrompt(page, input, prompt, baselineSnapshot) {
    await input.click();
    await pasteLikeHuman(input, prompt);

    const baselineInputLength = (await getInputText(input)).length;
    const attempts = [
        async () => page.keyboard.press('Enter'),
        async () => page.keyboard.press('Control+Enter'),
        async () => clickSendButton(page)
    ];

    for (const attempt of attempts) {
        await attempt();
        for (let i = 0; i < 6; i++) {
            await randomWait(300, 300);
            const inputLength = (await getInputText(input)).length;
            const snapshot = await getMessageSnapshot(page);
            const inputCleared = inputLength < Math.max(3, Math.floor(baselineInputLength * 0.2));
            const messageChanged =
                snapshot.count > baselineSnapshot.count ||
                snapshot.assistantCount > baselineSnapshot.assistantCount ||
                hasMeaningfulChange(baselineSnapshot.lastText, snapshot.lastText) ||
                hasMeaningfulChange(baselineSnapshot.assistantTail, snapshot.assistantTail);

            if (inputCleared || messageChanged) return true;
        }
    }

    return false;
}

export async function sendAndWaitResponse(page, prompt, label = 'AI') {
    const profile = getProfile(label);
    log(`[${label}] 发送提示词 (${prompt.length} 字符)...`, colors.cyan);

    const input = page.locator(INPUT_SELECTOR).first();
    await input.waitFor({ state: 'visible', timeout: 30000 });

    await waitUntilIdle(page, `${label}-发送前检查`, Math.min(120_000, profile.maxWaitMs));

    const baselineSnapshot = await getMessageSnapshot(page);
    const sent = await sendPrompt(page, input, prompt, baselineSnapshot);
    if (!sent) {
        const inputText = await getInputText(input);
        const currentSnapshot = await getMessageSnapshot(page);
        await diagnoseWait(page, label, baselineSnapshot, currentSnapshot, 0);
        throw new Error(`[${label}] 消息可能未发送成功, 输入框字符: ${inputText.length}`);
    }

    log(`[${label}] 等待响应 (最长 ${Math.round(profile.maxWaitMs / 1000)} 秒)...`, colors.blue);

    const startedAt = Date.now();
    let diagnosed = false;
    let bestText = '';
    let lastObservedText = '';
    let lastGrowthTime = Date.now();
    let lastLength = 0;
    let stableIdleTicks = 0;
    let responseStarted = false;
    let sawGenerating = false;

    while (true) {
        await randomWait(1600, 2200);
        const elapsedMs = Date.now() - startedAt;
        const snapshot = await getMessageSnapshot(page);
        const generating = await isStillGenerating(page);

        if (generating) sawGenerating = true;

        const hasNewAssistantBlock = snapshot.assistantCount > baselineSnapshot.assistantCount;
        const assistantTextChanged = (snapshot.lastAssistantText || '') !== (baselineSnapshot.lastAssistantText || '');
        if (hasNewAssistantBlock || assistantTextChanged || sawGenerating) {
            responseStarted = true;
        }

        // 关键改动: 仅使用“本次新增 assistant 内容”，不再 fallback 到历史最长消息。
        const currentText = responseStarted ? (snapshot.lastAssistantText || '') : '';

        if (currentText !== lastObservedText) {
            const lengthDiff = currentText.length - lastLength;

            if (lengthDiff > 0) {
                bestText = currentText;
                lastObservedText = currentText;
                lastLength = currentText.length;
                lastGrowthTime = Date.now();
                process.stdout.write(colors.cyan + '+' + colors.reset);
            } else if (lengthDiff < 0) {
                bestText = currentText;
                lastObservedText = currentText;
                lastLength = currentText.length;
                lastGrowthTime = Date.now();
                process.stdout.write(colors.yellow + '!' + colors.reset);
            }
        } else {
            process.stdout.write(colors.dim + '.' + colors.reset);
        }

        const idleTime = Date.now() - lastGrowthTime;
        const minStable = profile.minStableMs;

        let requiredIdleTime = minStable;
        if (bestText.length > 2000) {
            requiredIdleTime = minStable * 3;
        } else if (bestText.length > 500) {
            requiredIdleTime = minStable * 2;
        }

        stableIdleTicks = !generating ? stableIdleTicks + 1 : 0;

        if (responseStarted && !generating && stableIdleTicks >= 3 && idleTime >= requiredIdleTime && bestText.length > 10) {
            console.log();
            log(`[${label}] 响应完成 (${bestText.length} 字符, 稳定 ${Math.round(idleTime / 1000)} 秒)`, colors.green);
            return bestText;
        }

        const abnormalGeneratingIdleThreshold = bestText.length > 2000 ? 45_000 : (bestText.length > 500 ? 30_000 : 15_000);
        if (responseStarted && generating && bestText.length > 10 && idleTime >= abnormalGeneratingIdleThreshold) {
            console.log();
            log(`[${label}] 检测到生成状态异常（按钮未收敛），使用稳定文本兜底返回 (${bestText.length} 字符)`, colors.yellow);
            return bestText;
        }

        if (!diagnosed && elapsedMs >= profile.diagnoseAfterMs) {
            diagnosed = true;
            await diagnoseWait(page, label, baselineSnapshot, snapshot, elapsedMs);
        }

        if (elapsedMs >= profile.maxWaitMs) {
            console.log();
            await diagnoseWait(page, label, baselineSnapshot, snapshot, elapsedMs);
            const fallbackText = (snapshot.lastAssistantText || '').trim();
            if (responseStarted && fallbackText.length > 10) {
                log(`[${label}] 达到超时阈值，使用稳定响应兜底返回 (${fallbackText.length} 字符)`, colors.yellow);
                return fallbackText;
            }
            throw new Error(`[${label}] 等待响应超时 (${Math.round(profile.maxWaitMs / 1000)} 秒)，为避免串章已终止流程`);
        }
    }
}





