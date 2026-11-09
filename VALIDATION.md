# TodoDesk 1.0.0 验收记录

验收日期：2026-10-29。环境：Windows x64、Node.js 24.19.0、npm 11.17.0、Electron 45.1.0。

## 已通过

- TypeScript 严格检查，包含未使用变量与参数检查；Vite 生产构建及 Electron 主进程、preload 打包。
- `npm test`：15 项业务和文件存储测试全部通过。覆盖完成与撤销、未完成顺延、每日重复、跨午夜和多日未使用、每日归零与累计保留、手动完成、并发加减、直接改值和净变化、日报覆盖保护、历史快照、保存失败回滚、重启读取、备份恢复、版本拒绝和窗口工作区约束。
- 真实 Electron 桌面流程通过。覆盖快速添加、创建/编辑/移除/每日重复、浮窗与主面板同步、加减和直接输入、达标不自动完成、日报生成/编辑/保存/复制、重新生成确认的取消、只读历史、深浅色同步、原生 always-on-top 状态、窗口调整尺寸、125% 页面缩放布局、窗口离屏恢复、隐藏和恢复、重复启动恢复原实例、渲染进程隔离及重启后数据保留。
- 开发模式实际启动并成功加载 React 界面，连接本地主进程；开发服务器排除验收数据和构建目录的文件监听，避免 Windows 缓存文件锁定问题。
- NSIS 当前用户安装成功，无需管理员权限；安装后的 EXE 完整执行桌面流程，未出现页面异常或失败的资源请求。
- 相同版本覆盖安装成功。安装前后的独立用户数据文件 SHA-256 一致；覆盖安装后重新启动，任务、累计数值、主题和已编辑日报均保留。
- 已安装的应用以日常默认数据目录启动，初始清单为空；自动化测试数据保留在项目独立目录中。

## 证据与产物

- 安装器：`release/TodoDesk Setup 1.0.0.exe`
- 大小：121,313,435 字节，约 115.7 MiB。
- SHA-256：`bbab93b51ff845b9edeea35c48365e4c4822e6fa68e1abcabd3b9ffac55a83db`
- 免安装目录：`release/win-unpacked/`，启动其中 `TodoDesk.exe`，不要单独移动该 EXE。
- 实际安装位置：`%LOCALAPPDATA%\Programs\TodoDesk\TodoDesk.exe`
- 结构化验收：`artifacts/desktop-smoke.json`、`artifacts/installed-smoke.json`、`artifacts/installation-smoke.json`。
- 截图：`artifacts/01-empty.png` 至 `artifacts/07-scale-125.png`，其中 `02-today.png`、`03-floating.png`、`04-report.png` 分别展示任务面板、桌面浮窗和日报。

## 未完成的实机检查与限制

- 原生鼠标拖动未取得有效的自动化验收结果；托盘图标的真实鼠标双击、右键菜单及菜单退出未完成人工验收。Windows Computer Use 检查被用户停止后，已停止后续电脑操作。程序化移动、尺寸调整、置顶、隐藏恢复及应用退出流程已通过。
- 未实际拔插显示器、切换 Windows 系统缩放比例，未让电脑真实休眠恢复或等待到午夜；相关日期业务逻辑和离屏位置恢复已经测试。125% 验证使用 Electron 页面缩放，不等同于切换系统 DPI。
- 覆盖安装验证为 1.0.0 到同一版本，尚无旧版本可执行跨版本迁移验收。
- 安装包没有代码签名证书，Windows 可能提示未识别发布者。正常执行了 EXE 图标及资源编辑，没有启用禁用资源编辑的降级选项。
- 日报编辑草稿仅在当前进程会话保留，退出前应点击“保存修改”。任务与计数每次操作自动保存。

## 复验命令

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run test:desktop
npm run package:win
npm run test:install
```

最后一条命令会实际安装或覆盖安装当前用户的 TodoDesk。安装验收仍使用独立测试数据，不影响默认日常清单。
