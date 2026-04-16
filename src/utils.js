/**
 * 工具函数
 */

export const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
};

export async function randomWait(min = 1000, max = 3000) {
    const duration = Math.floor(Math.random() * (max - min + 1) + min);
    return new Promise(resolve => setTimeout(resolve, duration));
}

export async function pasteLikeHuman(locator, text) {
    await randomWait(500, 1000);
    await locator.fill(text);
    log(`${colors.dim}已粘贴内容 (${text.length} 字符)${colors.reset}`);
}

export function log(message, color = colors.reset) {
    const now = new Date().toLocaleString('zh-CN', { hour12: false });
    console.log(`${color}[${now}] ${message}${colors.reset}`);
}

export function alert() {
    process.stdout.write('\u0007');
}

export async function heavyAlert(count = 3) {
    for (let i = 0; i < count; i++) {
        alert();
        if (i < count - 1) await new Promise(r => setTimeout(r, 200));
    }
}
