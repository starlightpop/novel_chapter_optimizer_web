# 小说单章优化系统（网页串行版）

## 原稿和优化稿放哪里（仅项目内）
固定使用项目内工作区：
- 原稿：`D:\AAA~test\novel_chapter_optimizer_web\workspace\<小说目录>\00_原稿\`
- 优化稿：`D:\AAA~test\novel_chapter_optimizer_web\workspace\<小说目录>\01_优化稿\`

已预建目录：
- `D:\AAA~test\novel_chapter_optimizer_web\workspace\示例小说\00_原稿`
- `D:\AAA~test\novel_chapter_optimizer_web\workspace\示例小说\01_优化稿`
- `D:\AAA~test\novel_chapter_optimizer_web\workspace\新小说放这里\00_原稿`
- `D:\AAA~test\novel_chapter_optimizer_web\workspace\新小说放这里\01_优化稿`

## 必须满足
- 原稿文件可随意命名（`.md` / `.txt`）
- 文件前面要有章节标题，例如：`第1章 血夜托孤`
- 系统会自动识别章节标题并重命名原稿文件

## 使用
```bash
cd D:\AAA~test\novel_chapter_optimizer_web
npm install
npm run start
```

运行后：
1. 自动同步 `D:\AAA~test\ds_ai_optimize\rules` 到本项目 `rules/`
2. 自动扫描本项目 `workspace/` 下的小说目录
3. 你选择编号后开始串行逐章优化

## 系统行为
- 只发送正文给 DeepSeek，标题不发送
- 上一章完成并保存后才发送下一章
- 只输出单章 `.ai.md`，不合并全书
- 若前20行有多个标题，采用首个并写 WARN 日志
- 未变化章节自动跳过（`data/chapter_state.json`）
