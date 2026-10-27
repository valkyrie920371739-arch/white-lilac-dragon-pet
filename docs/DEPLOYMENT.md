# GitHub Pages 自动部署

项目提供 `.github/workflows/pages.yml`。它先检查项目、构建 `dist/`，再把构建结果部署到 GitHub Pages。更新 `main` 分支会自动发布；也可以在 GitHub 的 Actions 页面手动运行。部署使用 GitHub 自动提供的令牌，不需要填写个人访问令牌或云服务密钥。

构建还会生成 `dist/downloads/white-lilac-dragon-pet.zip` 桌面宠物包。网页中的安装链接使用本项目 GitHub Pages 网站的 HTTPS 图集地址，并显式传入 `spriteVersionNumber=2`。如果派生到其他仓库，需要同时更新 `index.html` 的安装链接、README 中的站点地址及 `tests/install.test.mjs` 的预期地址。`npm run check` 会检查安装链接与图集清单是否一致。

## 一键配置与部署

本地一键脚本位于 `scripts/deploy.mjs`。请先安装 **Git、Node.js 24 或更新版本、[GitHub CLI](https://cli.github.com)**，解压项目并在项目根目录打开终端。然后登录自己的 GitHub.com 账号并配置 Git 认证：

```bash
gh auth login --hostname github.com
gh auth setup-git
```

Git 提交还需要配置自己的 `user.name` 和 `user.email`。已配置过的用户无需重复设置；脚本不会替你猜测提交身份，也不会读取或打印原始 token。

将下面的 `OWNER/REPO` 替换为自己实际选择的账户或组织名与仓库名。创建**公开新仓库**并发布：

```bash
npm run deploy -- --repo OWNER/REPO --create --public
```

如果你明确需要**私有来源仓库**，并且 GitHub 计划允许从该仓库发布 Pages，则使用：

```bash
npm run deploy -- --repo OWNER/REPO --create --private
```

私有来源仓库并不意味着网站私密，具体条件见下方“仓库计划与网站可见性”。脚本要求创建时明确选择可见性；不会自动将私有仓库改成公开。

部署到已有的空仓库，或更新本项目已经关联的仓库：

```bash
npm run deploy -- --repo OWNER/REPO
```

查看帮助不会初始化 Git、创建仓库或触发部署：

```bash
npm run deploy -- --help
```

脚本会按顺序检查项目、GitHub 登录和仓库权限，执行本地检查与构建，再提交实际项目、正常推送 `main`、启用或调整 Pages 为 Actions 来源，并手动触发 `pages.yml`。对于这次脚本创建的新仓库，会确保默认分支为 `main`；已有仓库的默认分支不会被修改。

如果解压目录尚未初始化 Git，脚本会在该项目目录创建独立的 `main` 仓库。如果项目在另一个仓库的子目录中、已有本地分支或远程默认分支不是 `main`、`origin` 不匹配、已有远程属于其他项目，或本地历史没有包含远程 `main`，脚本会停止并提示处理方法。它不会强制推送、自动合并或覆盖另一套历史。`dist/`、ZIP 和其他被忽略的文件不会被加入新提交；已被 Git 跟踪的此类内容需要先自行整理。

部署结果以当前 API 返回的**本次运行编号**为准，最多等待 30 分钟。脚本会验证运行对应的提交、工作流与发布步骤均成功，再打印真实的仓库、运行记录和网站链接。认证、检查、推送、API 或部署失败都会以非零状态退出；已经推送的提交和已经触发的运行不会自动回滚。若所在组织要求环境审批，需要在运行页面完成审批。

脚本调用当前 GitHub.com REST API `2026-03-10`。若服务仍返回旧版 dispatch 的 `204` 空响应，脚本会明确报告无法取得本次运行编号，避免把“已触发”当作“已发布”。

## 通过 GitHub 网页首次配置

1. 把完整项目放入自己的 GitHub 仓库，并将主分支命名为 `main`。要包含 `.github/workflows/pages.yml`；只上传网页文件不会安装自动部署工作流。
2. 打开仓库 **Settings → Pages → Build and deployment**，将 **Source** 设为 **GitHub Actions**。已有工作流时，无需再选择或提交 GitHub 推荐的工作流模板。修改发布来源需要仓库的管理员或维护者权限。
3. 打开仓库 **Actions → Deploy pet to GitHub Pages → Run workflow**，选择 `main`，点击 **Run workflow**。工作流文件应已存在于仓库的默认分支，才能看到手动运行入口。
4. 等待 **Check and build** 和 **Deploy** 都成功。在此次运行的部署环境链接或 **Settings → Pages → Visit site** 打开实际网站。网站地址由 GitHub 返回，项目没有预先写死账户名、仓库名或域名。

如果最初推送发生在启用 Pages 之前，第一次运行可能在读取 Pages 配置时失败。完成第 2 步后重新运行即可。工作流不会自行变更仓库可见性或创建 Pages 站点。

## 后续发布

- **自动发布：** 将修改提交并推送到 `main`。检查或构建失败时，部署不会执行。
- **手动发布：** 在同一个 **Run workflow** 入口选择 `main`。这会重新检查、构建和发布当前版本。
- **并发更新：** Pages 发布使用同一个并发组，正在进行的发布不会被新的提交取消。
- **发布内容：** 只上传 `dist/`；源码、工作流及开发文档不会因为存在于仓库中就自动出现在发布产物里。公开仓库中的文件仍可从 GitHub 仓库页面访问。

## 仓库计划与网站可见性

选择仓库可见性前，请确认自己希望网站被谁访问：

| 账户或组织计划 | Pages 来源仓库 | 网站访问范围 |
| --- | --- | --- |
| GitHub Free / GitHub Free for organizations | 公开仓库 | 互联网公开 |
| GitHub Pro / GitHub Team | 可使用公开或私有仓库 | 通常仍为互联网公开；私有仓库本身不提供网站访问限制 |
| GitHub Enterprise Cloud 组织 | 可使用公开、私有或适用的内部仓库 | 组织的私有或内部**项目仓库**可以配置访问控制；需以组织实际设置为准 |

普通私有仓库部署到 Pages 后，网页和发布到网站上的资源仍可能对所有人可见。网站私密访问控制有单独的 Enterprise Cloud 条件，并不适用于个人 Pro 仓库或组织主页。使用 Enterprise Managed Users 的组织只能向企业成员私密发布。需要限制访问时，应先由仓库管理员确认 Pages 可见性和组织策略。

## 构建及权限约定

构建使用 Node.js **24 LTS**，执行：

```bash
npm run check
npm run build
```

项目使用 Node.js 内置功能，没有需要安装的 npm 依赖，因此工作流不运行 `npm install`，也不启用依赖缓存。如果将来增加依赖，应一并提交锁文件，并在检查前加入对应的依赖安装步骤。

构建结果应包含 `dist/index.html`。站内资源路径应适配项目 Pages 的仓库子路径。部署不会注入账户名、仓库名或 `base_path`；项目网页使用相对资源路径处理这些情况。

工作流将所有 GitHub 官方 Actions 固定到已核实版本的完整提交 SHA：

| Action | 对应版本 |
| --- | --- |
| `actions/checkout` | `v7.0.1` |
| `actions/setup-node` | `v7.1.0` |
| `actions/configure-pages` | `v6.0.0` |
| `actions/upload-pages-artifact` | `v5.0.0` |
| `actions/deploy-pages` | `v5.0.1` |

构建任务只有 `contents: read`；部署任务只有 `pages: write` 和 `id-token: write`。`configure-pages` 在部署任务中读取已启用的 Pages 配置，`enablement: false` 禁止它尝试开启站点。部署环境名为 `github-pages`，访问地址直接使用部署 Action 返回的 `page_url`。如组织要求环境审批，应由指定审核人完成审批。

## 常见问题

| 现象 | 检查事项 |
| --- | --- |
| 没有 **Run workflow** 按钮 | 确认工作流已经提交到默认分支，GitHub Actions 未被组织或仓库禁用，并且自己具有运行工作流所需的写入权限。 |
| 读取 Pages 配置失败或返回 404 | 检查 **Settings → Pages → Source** 是否为 **GitHub Actions**，以及当前计划是否允许该仓库可见性使用 Pages。 |
| Deploy 等待审批 | 打开 `github-pages` 环境的部署请求，按仓库或组织既有审批规则处理。 |
| 权限或 OIDC 报错 | 确认部署任务的 `pages: write`、`id-token: write` 未被删除，组织允许这些官方 Actions，环境的分支规则允许 `main`。 |
| 构建成功但网站 404 | 检查上传产物根目录是否含 `index.html`，并从部署返回的真实链接访问。自定义域名还需正确的域名与 DNS 配置。 |

本地检查只能验证项目和配置文件，真实的 Pages 发布结果需要以 GitHub Actions 中的运行记录及网站访问结果为准。

## 官方参考

以下部署流程和版本于 2026-10-26 核对：

- [GitHub：配置 Pages 发布来源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [GitHub：使用自定义 Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub：手动运行工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [GitHub REST API：获取、创建和修改 Pages 站点](https://docs.github.com/en/rest/pages/pages)
- [GitHub CLI：创建仓库](https://cli.github.com/manual/gh_repo_create)
- [GitHub CLI：手动运行工作流](https://cli.github.com/manual/gh_workflow_run)
- [GitHub CLI：登录状态与活跃账号](https://cli.github.com/manual/gh_auth_status)
- [GitHub REST API：手动触发工作流及返回的运行编号](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
- [GitHub REST API：读取单次工作流运行](https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run)
- [GitHub REST API：设置新仓库的默认分支](https://docs.github.com/en/rest/repos/repos#update-a-repository)
- [GitHub：创建 Pages 站点及入口文件要求](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)
- [GitHub：Pages 计划与限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [GitHub Enterprise Cloud：更改 Pages 网站可见性](https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site)
- [Node.js：官方版本状态](https://nodejs.org/en/about/previous-releases)
- [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1)
- [setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0)
- [configure-pages v6.0.0](https://github.com/actions/configure-pages/releases/tag/v6.0.0)
- [upload-pages-artifact v5.0.0](https://github.com/actions/upload-pages-artifact/releases/tag/v5.0.0)
- [deploy-pages v5.0.1](https://github.com/actions/deploy-pages/releases/tag/v5.0.1)
