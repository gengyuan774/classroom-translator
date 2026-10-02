# 课堂译记 · 公开版

英语课堂实时转写、中文翻译、PPTX/PDF/DOCX/TXT/Markdown 参考资料、课后总结与 HTML/Markdown 导出。

支持会员码和个人 API Key 两种连接方式。会员码由服务器验证，通过 HttpOnly、Secure、SameSite=Strict 的 7 天会话 Cookie 授权。会员共享 API Key 只保存在服务器环境中。个人 API Key 只在当前页面内存中保存，通过同源服务转发给固定的 OpenAI 接口。实时音频使用临时凭据直接连接 OpenAI。课堂和资料文字保存在当前浏览器的 IndexedDB，清除浏览器数据会丢失记录，请及时导出。无跨设备同步。

资料读取文字层，图片、扫描件和图表不做视觉识别。每份 20 MB、每课 10 份。旧 PPT/DOC 需转换格式。

开发：`npm ci`、`npm run build`、`npm test`。测试使用模拟响应，不消耗 OpenAI 额度；实际账户权限、余额及麦克风环境需要使用者连接验证。

部署输出为 Cloudflare-compatible Worker：`dist/server/index.js`，内嵌浏览器静态资源。D1 仅保存会员会话摘要和用量计数，不保存课堂内容、密码明文或 API Key。

服务器秘密配置：`MEMBER_CODE`、随机的 `MEMBER_SESSION_SECRET` 和 `OPENAI_API_KEY`。修改会员码或会话秘密会使既有会话失效，退出时立即删除服务器会话。未配置共享 API Key 时可以验证会员码，但页面明确提示服务尚未开通，不会调用 OpenAI。

共享服务默认限制：每个网络地址每 10 分钟最多 15 次登录尝试、每分钟 60 次文字请求和 3 次实时连接申请。所有会员合计每天最多 3000 次文字请求、12 次实时连接凭据、500 万输入字符；按 UTC 日重置。管理员可用 `MEMBER_DAILY_TEXT_LIMIT`、`MEMBER_DAILY_REALTIME_LIMIT`、`MEMBER_DAILY_CHARACTER_LIMIT` 调整。计数由数据库原子更新；限制失败时不调用共享 API。这些是请求上限，并非精确的金额上限。

数据库结构在 `db/schema.ts`，执行 `npx drizzle-kit generate` 生成迁移。发布时应用已保存的 `drizzle` 迁移。测试包含真实 SQLite 计数和模拟 OpenAI 调用，无真实费用。
