## 2026-04-06 - [Optimize analyzeOutboundFromFile file I/O]
**Learning:** Sequential synchronous file system calls (like `fs.existsSync`, `fs.readdirSync`) within deep loops block the VS Code Extension Host main thread and significantly degrade extension responsiveness.
**Action:** Replace synchronous I/O loops with `fs.promises` methods (like `fs.promises.readdir`, `fs.promises.access`) combined with `Promise.all()` for concurrent, non-blocking execution, and use `Set` to deduplicate items before issuing I/O checks.
