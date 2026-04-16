import { chromium } from 'playwright';
import path from 'path';
import readline from 'readline';
import { log, colors, alert, randomWait } from './utils.js';

function ask(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

export async function launchBrowser() {
    const userDataDir = path.resolve('browser_data');
    log(`启动浏览器，用户数据目录: ${userDataDir}`);

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--window-size=900,700',
            '--window-position=100,100',  // 放在屏幕左上角，不抢焦点但可见
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding'
        ],
        viewport: null,
    });

    // 注入脚本，让页面始终认为自己是可见的（防止DeepSeek后台降频）
    await context.addInitScript(() => {
        Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    });

    const pages = context.pages();
    const deepSeekPage = pages.find((p) => (p.url() || '').includes('chat.deepseek.com'));
    const page = deepSeekPage || pages[pages.length - 1] || (await context.newPage());

    return { context, page };
}

export async function prepareDeepSeek(page) {
    log('导航到DeepSeek...', colors.blue);
    await page.goto('https://chat.deepseek.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 登录检测
    const loginButton = page.locator('text=登录').or(page.locator('text=Log In')).first();
    if (await loginButton.isVisible().catch(() => false)) {
        log('警告: 用户未登录，请在浏览器窗口中登录', colors.red);
        alert();
        console.log('\n' + colors.yellow + '='.repeat(60) + colors.reset);
        console.log(colors.yellow + '【请在浏览器窗口中登录 DeepSeek】' + colors.reset);
        console.log(colors.yellow + '登录完成后系统会自动检测并继续' + colors.reset);
        console.log(colors.yellow + '='.repeat(60) + colors.reset + '\n');
        
        while (await loginButton.isVisible().catch(() => false)) {
            await randomWait(2000, 2000);
        }
        log('检测到登录成功', colors.green);
    }

    await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 60000 });

    // 配置确认界面
    console.log('\n' + colors.cyan + '='.repeat(60) + colors.reset);
    console.log(colors.cyan + colors.bright + '【请在浏览器中完成 DeepSeek 配置】' + colors.reset);
    console.log(colors.dim + '1. 确认已登录' + colors.reset);
    console.log(colors.dim + '2. 新建一个对话（如需要）' + colors.reset);
    console.log(colors.dim + '3. 确认输入框可用' + colors.reset);
    console.log(colors.yellow + '='.repeat(60) + colors.reset);
    
    const answer = await ask(colors.bright + '配置完成? 输入 Y 继续 > ' + colors.reset);
    if (answer.toUpperCase() === 'Y') {
        log('用户确认配置完成，继续...', colors.green);
    } else {
        log('请先完成浏览器配置', colors.red);
        process.exit(1);
    }
}
