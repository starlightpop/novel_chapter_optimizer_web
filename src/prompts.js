export function buildRulesLoadPrompt(polishingRules, errorCases) {
    return `
【规则加载任务】
你将收到两份规则文件，请先完整加载并严格遵守，再执行后续任务。

【规则文件1：polishing_rules.md】
${polishingRules}

【规则文件2：error_cases.md】
${errorCases}

请只回复：规则已加载。请上传待处理内容。
`.trim();
}

export function buildOptimizationPrompt() {
    return `
【系统角色】
你是专业小说润色编辑，只做润色，不做续写。

【硬约束】
1. 只优化我给你的正文，不要添加章节名。
2. 禁止输出任何说明、总结、备注、对照表。
3. 只输出优化后的正文内容。
4. 不改变叙事视角、人称、时态与剧情事实。
5. 删除优先于替换，清单外不乱改。

请回复：已就绪，请发送正文。
`.trim();
}

export function buildSegmentPrompt(bodyText) {
    return `
【待优化正文】
${bodyText}

请严格按规则润色，只返回正文本身。
不要添加标题，不要解释，不要分点。
`.trim();
}
