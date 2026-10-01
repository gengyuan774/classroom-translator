# 课堂译记 · 公开版

英语课堂实时转写、中文翻译、PPTX/PDF/DOCX/TXT/Markdown 参考资料、课后总结与 HTML/Markdown 导出。

每位访客使用自己的 OpenAI API Key。密钥只在当前页面内存中保存，通过同源服务转发给固定的 OpenAI 接口。实时音频使用临时凭据直接连接 OpenAI。课堂和资料文字保存在当前浏览器的 IndexedDB，清除浏览器数据会丢失记录，请及时导出。无跨设备同步。

资料读取文字层，图片、扫描件和图表不做视觉识别。每份 20 MB、每课 10 份。旧 PPT/DOC 需转换格式。

开发：`npm ci`、`npm run build`、`npm test`。测试使用模拟响应，不消耗 OpenAI 额度；实际账户权限、余额及麦克风环境需要使用者连接验证。

部署输出为 Cloudflare-compatible Worker：`dist/server/index.js`，内嵌浏览器静态资源。无共享密钥或服务器端课堂存储。
