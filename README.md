# 可爱的gpt龙娘

把白发紫瞳、白紫服装与菱形鳞尾的自定义形象放进一个可互动的网页。保留最新的动画图集，使用轻量的原生 HTML、CSS 与 JavaScript 播放。

![可爱的gpt龙娘](assets/preview.png)

这是独立网页：打开部署后的链接即可互动。它不会修改 ChatGPT 客户端里的虚拟形象，也不需要 ChatGPT API、账户登录或服务密钥。

## 能做什么

| 操作 | 角色回应 |
| --- | --- |
| 单击角色 | 挥手打招呼 |
| 快速双击角色 | 跳跃 |
| 按住并拖动 | 随拖动方向向左或向右飞行；松开后回到待机 |
| 在舞台内移动鼠标 | 待机时按 16 个方向看向指针 |
| 点击动作按钮 | 播放待机、左右飞行、挥手、跳跃、受挫、等待、思考、检查等 9 种状态 |
| 暂停动画 | 暂停逐帧播放 |
| 减少动态 | 用静态姿势展示动作；默认跟随系统设置 |
| 回到中央 | 重置位置并回到待机 |

角色获得键盘焦点后，可用方向键移动、`Enter` 打招呼、`Space` 跳跃、`Home` 回到中央、`Esc` 回到待机。手机端支持轻点、快速双点和拖动。

单击会等待约 300 毫秒，以区分双击。挥手、跳跃和受挫播放一次后回到待机；其他动作持续播放，点击“待机”可恢复鼠标跟随。切换到其他标签页时会暂停动画时钟。

## 本地打开

安装 Node.js 24 或更新版本后，在项目目录运行：

```bash
npm start
```

打开终端输出的地址，默认是 `http://127.0.0.1:4173/`。没有 npm 依赖需要安装。

请通过本地服务访问；直接双击 `index.html` 的 `file://` 方式无法可靠加载模块和资源清单。

## 一条命令部署到 GitHub Pages

先安装 Git 与 [GitHub CLI](https://cli.github.com/)，并在自己的终端完成 GitHub 登录：

```bash
gh auth login
gh auth setup-git
```

将下面的 `OWNER/REPO` 替换为你确定的 GitHub 账户与新仓库名称。以下命令会**创建公开仓库并公开发布网页**：

```bash
npm run deploy -- --repo OWNER/REPO --create --public
```

已有空仓库时使用：

```bash
npm run deploy -- --repo OWNER/REPO
```

部署脚本会检查与构建项目、核对本地 Git 仓库及远程目标、提交并正常推送、配置 Pages、触发部署并核验运行结果。它使用本机 GitHub CLI 的登录状态，不会让你在源码或网页里填写令牌。若 Git 尚未设置提交身份，请先按终端提示配置自己的名字与邮箱。

创建私有仓库可改用 `--create --private`，但是否支持 Pages 取决于 GitHub 计划；**私有来源仓库不代表网页私密**。完整的首次配置、计划要求、权限与故障排查见 [部署说明](docs/DEPLOYMENT.md)。

### 后续自动更新与手动一键部署

- 提交并推送修改到 `main`，GitHub Actions 会检查、构建并自动发布。
- 在仓库 **Actions → Deploy pet to GitHub Pages → Run workflow** 可手动重新部署。
- 工作流只发布 `dist/` 内的网页和资源。自动部署使用 GitHub 提供的令牌，无需另存个人访问令牌。
- 网站地址以成功运行返回的实际地址为准。仓库默认分支应为 `main`。

## 检查与构建

```bash
npm run check
npm run build
npm run preview
```

`check` 校验图集尺寸、RGBA 格式、文件 SHA-256、动作帧数与方向清单，并检查 JavaScript 语法及动画逻辑。`build` 将发布文件复制到 `dist/`。

也可以模拟项目 Pages 的子路径：

```bash
npm run preview -- --base=/demo/ --port=4173
```

再打开 `http://127.0.0.1:4173/demo/`。网页和清单资源均使用相对路径，无需写入 GitHub 账户名、仓库名或域名。

## 文件结构

| 路径 | 用途 |
| --- | --- |
| `index.html` / `styles.css` | 中文界面与响应式布局 |
| `src/app.js` | Canvas 播放器、鼠标、触摸和键盘交互 |
| `src/animation.js` | 帧时序、视线方向与边界计算 |
| `assets/pet.json` | 动作、逐帧时长及 16 个视线方向 |
| `assets/spritesheet.png` | 1536 × 2288 的透明图集，共 73 个有效帧 |
| `assets/preview.png` | 形象静态预览 |
| `assets/interaction-preview.mp4` | 四种互动动作的视频预览 |
| `scripts/` | 本地服务、资源检查、构建和首次部署脚本 |
| `tests/` | 动画时间、方向及拖动边界测试 |
| `.github/workflows/pages.yml` | 推送触发与手动触发的自动部署工作流 |
| `docs/ASSETS.md` | 图集说明和资源来源 |
| `docs/DEPLOYMENT.md` | GitHub Pages 部署说明 |

## 保存与修改

网页仅在浏览器本地保存“跟随鼠标”和“减少动态”两项偏好，不发送聊天内容，也不调用外部分析服务。

替换形象时，需要同步更新图集与 `assets/pet.json` 的尺寸、帧布局和校验值，再运行检查。不要只替换图片而沿用不匹配的清单。开发资料和原始工作档案不属于网站发布内容。

项目目前没有指定统一的开源许可证，也未替角色素材授予额外的再分发或商业许可。发布前可按自己的意愿补充代码与素材的授权说明。

