# 今日清单 · TodoDesk

一个纯本地的 Windows 桌面待办工具。桌面浮窗随手记录，完整面板管理任务、历史和工作日报。

## 使用

- 首次安装可从 [GitHub Releases](https://github.com/AnsoNeko/TodoDesk/releases/latest) 获取 Windows x64 安装包。此前已安装旧构建的用户可覆盖安装，原有数据会保留。
- TodoDesk 启动后自动检查更新，发现新版就在应用内下载并校验。下载完成后，从「设置 → 软件更新」选择「重启安装」。更新前请保存日报草稿。
- 主界面支持快速添加普通任务。通过“新建任务”可用日历选开始日期，并设置精确到分钟的开始和截止时间。今天的任务默认创建时开始、当天 23:59 截止；选未来日期时默认该日 00:00 开始、23:59 截止。
- 未来任务显示在“计划任务”，可在开始日期到来前改期或移除；到了开始日期自动进入今日清单。每日重复任务沿用设定的时间安排。
- 数字可以直接输入，或使用加减按钮调整。按 Enter 或离开输入框保存；计数达到目标不会自动勾选完成。
- 一次性任务未完成会继续出现在下一天；普通每日重复任务每天重新生成，每日计数归零，累计计数保留总数。
- 历史页面按日期查看当天快照。历史任务只读；每日总结可以生成、编辑、保存、复制。编辑日报后需要点击“保存修改”。在页面或日期间切换会保留本次会话内的编辑草稿，退出程序前请保存。
- 浮窗默认置顶，可通过图钉、设置或托盘菜单切换。标题栏可以拖动，窗口边缘可以调整尺寸。
- 关闭窗口会隐藏到系统托盘。双击托盘图标显示浮窗；右键菜单可打开面板或退出应用。

## 开发

推荐 Node.js 24 LTS、npm 11，Windows x64。

```powershell
npm ci
npm run dev
```

React 界面支持开发热更新；修改主进程或 preload 后重新启动开发命令。

```powershell
npm run typecheck
npm test
npm run build
npm run test:desktop
npm run package:win
```

`npm start` 启动已构建的桌面应用。`npm run test:desktop` 使用真实 Electron 和隔离数据目录完成界面流程验证，不需要安装浏览器。截图及结构化结果保存在 `artifacts/`。

`npm run test:install` 会安装当前用户的 TodoDesk 至 `%LOCALAPPDATA%\Programs\TodoDesk`，创建应用快捷方式，运行安装后的完整桌面测试，并覆盖安装相同版本后验证数据保留。此命令会实际安装应用，应在 Windows 验收环境运行；测试数据保存在项目的独立 `artifacts/installed-data-*` 目录，不混入日常任务。

## 数据与实现

- Electron 主进程拥有唯一数据源；两个 React 窗口通过受限、类型明确的 preload 接口操作数据。渲染进程隔离、沙箱开启，无 Node.js 访问权限。软件更新由主进程访问 GitHub，清单数据保存在本地。
- 数据默认保存在 `%APPDATA%\TodoDesk\tododesk.json`，可以从设置打开实际目录。窗口位置、主题和置顶设置一起保存；不会写入安装目录。
- 每次更改串行执行，写入临时文件并同步后替换主文件，`.bak` 保存上一份有效数据。保存失败不提交内存状态；主文件损坏时从有效备份恢复并保留 `.corrupt-*` 原件，双损坏或不兼容版本时明确报错，不清空文件。
- schemaVersion 当前为 1。更高版本数据会被拒绝打开，不会降级覆盖。JSON 结构由 `shared/model.ts` 定义并在加载和保存时校验。
- 每个实际使用日期和已选定的计划日期有独立任务快照；跨日不补造漏用日期的记录。计数调整保存带日期的差额，日报根据当天净变化生成；历史快照和已保存总结不随之后的任务编辑变化。
- 每 15 秒、窗口重新获得焦点、电脑休眠恢复和每次数据操作时检查本地日期。仅依赖系统本地日期，无后台服务器。
- 自动化验收可用 `TODODESK_DATA_DIR` 指定独立数据目录；普通使用无需设置。

## 打包

Electron＋React＋TypeScript＋Vite，electron-builder 输出当前用户 NSIS 安装包，支持选择目录，无需管理员权限。图标通过 `scripts/create-icon.cjs` 生成，包含 16、32、48、256 像素 ICO。主进程依赖已打入 bundle，安装后的应用不依赖开发环境。

```powershell
npm run package:win
```

每次发布先递增 `package.json` 和锁文件版本，再打包。将同次生成的 `TodoDesk-Setup-<版本>-x64.exe`、`.exe.blockmap` 和 `latest.yml` 上传到对应的 `v<版本>` GitHub Release，校验附件后发布为 Latest。

如果下载 Electron 或打包工具遇到网络问题，可在当前 PowerShell 会话设置镜像后重试：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
npm run package:win
```

当前安装包没有代码签名证书，Windows 可能显示未识别发布者提示。内置下载使用 GitHub Release 的更新清单校验安装包 SHA-512。

验证结果及未执行的实体设备场景见 [VALIDATION.md](VALIDATION.md)。
