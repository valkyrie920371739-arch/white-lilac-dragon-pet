#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const PROJECT_NAME = 'white-lilac-dragon-pet';
const API_VERSION = '2026-03-10';
const WORKFLOW = '.github/workflows/pages.yml';
const MAX_WAIT_MS = 30 * 60 * 1000;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const progress = { pushed: false, repositoryUrl: null, runUrl: null };
const childEnv = {
  ...process.env,
  GH_HOST: 'github.com',
  GH_PROMPT_DISABLED: '1',
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  LC_ALL: 'C',
  NO_COLOR: '1',
};
delete childEnv.GH_DEBUG;
delete childEnv.GH_FORCE_TTY;

function help() {
  console.log(`白紫龙娘 · GitHub Pages 一键部署

先安装 Git、Node.js 24+ 和 GitHub CLI，并执行：
  gh auth login --hostname github.com
  gh auth setup-git

在本项目根目录运行：
  npm run deploy -- --repo OWNER/REPO --create --public
  npm run deploy -- --repo OWNER/REPO --create --private
  npm run deploy -- --repo OWNER/REPO

参数：
  --repo OWNER/REPO  必填，使用你实际选择的 GitHub.com 仓库
  --create           创建新仓库，必须同时明确 --public 或 --private
  --public           新仓库公开
  --private          新仓库私有；Pages 需相应付费计划，网站不因此私密
  --help, -h         显示帮助，不执行任何操作

脚本会检查、构建、提交项目，正常推送 main，配置 Pages 并等待本次部署。
已有非空仓库必须是本项目的现有 clone，默认分支和本地分支均为 main。
origin 不匹配、历史不兼容、权限或部署失败时停止；不执行强制推送。
部署最多等待 30 分钟；GitHub 网站的实际访问地址由 API 返回。
详细说明见 docs/DEPLOYMENT.md。`);
}

function options(args) {
  if (args.includes('--help') || args.includes('-h')) return { help: true };
  const result = { repo: null, create: false, visibility: null };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--repo' || flag.startsWith('--repo=')) {
      if (result.repo !== null) throw new Error('--repo 只能指定一次。');
      result.repo = flag === '--repo' ? args[++index] : flag.slice('--repo='.length);
    } else if (flag === '--create') {
      if (result.create) throw new Error('--create 只能指定一次。');
      result.create = true;
    } else if (flag === '--public' || flag === '--private') {
      if (result.visibility) throw new Error('--public 与 --private 必须且只能选择一个。');
      result.visibility = flag.slice(2);
    } else {
      throw new Error(`未知参数：${flag}。使用 --help 查看用法。`);
    }
  }
  if (typeof result.repo !== 'string' ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/.test(result.repo) ||
      ['.', '..'].includes(result.repo.split('/')[1])) {
    throw new Error('请显式提供 --repo OWNER/REPO，使用实际账户或组织名与仓库名，不填写网址。');
  }
  if (result.create && !result.visibility) {
    throw new Error('创建仓库必须明确选择 --public 或 --private；脚本不会代选可见性。');
  }
  if (!result.create && result.visibility) {
    throw new Error('--public / --private 只用于 --create；脚本不会改变已有仓库的可见性。');
  }
  return result;
}

function invoke(command, args, { input, inherit = false } = {}) {
  return spawnSync(command, args, {
    cwd: root,
    env: childEnv,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 8 * 1024 * 1024,
    stdio: inherit ? 'inherit' : 'pipe',
    input,
  });
}

function detail(result) {
  return String(result.stderr || result.error?.message || '').trim().slice(0, 1800);
}

function must(command, args, description, settings = {}) {
  const result = invoke(command, args, settings);
  if (result.error || result.status !== 0) {
    const extra = settings.inherit ? '' : detail(result);
    throw new Error(`${description}${extra ? `\n${extra}` : ''}`);
  }
  return String(result.stdout || '').trim();
}

function git(args, description = 'Git 操作失败。', settings = {}) {
  return must('git', args, description, settings);
}

function api(method, endpoint, { body, allow = [] } = {}) {
  const args = [
    'api', endpoint, '--hostname', 'github.com', '--method', method, '--include',
    '--header', 'Accept: application/vnd.github+json',
    '--header', `X-GitHub-Api-Version: ${API_VERSION}`,
  ];
  if (body !== undefined) args.push('--input', '-');
  const result = invoke('gh', args, { input: body === undefined ? undefined : JSON.stringify(body) });
  const output = String(result.stdout || '').replace(/\r\n/g, '\n');
  const match = /^HTTP\/\S+\s+(\d{3})[^\n]*\n/.exec(output);
  const separator = output.indexOf('\n\n');
  if (result.error || !match || separator < 0) {
    throw new Error(`无法取得 GitHub API 的有效响应：${method} ${endpoint}\n${detail(result)}`);
  }
  const status = Number(match[1]);
  const raw = output.slice(separator + 2).trim();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); }
    catch { throw new Error(`GitHub API 返回了无法解析的 JSON：${method} ${endpoint}（HTTP ${status}）。`); }
  }
  const acceptedError = allow.includes(status);
  if (!acceptedError && (status < 200 || status >= 300 || result.status !== 0)) {
    const message = typeof data?.message === 'string' ? data.message.slice(0, 1000) : detail(result);
    throw new Error(`GitHub API 失败：${method} ${endpoint}（HTTP ${status}）。${message ? `\n${message}` : ''}`);
  }
  return { status, data };
}

function webUrl(value, label) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return value;
  } catch {
    throw new Error(`GitHub 未返回有效的${label}，不能确认对应网址。`);
  }
}

function remoteRepository(value) {
  let path;
  const scp = /^git@github\.com:([^\s]+)$/i.exec(value);
  if (scp) path = scp[1];
  else {
    let url;
    try { url = new URL(value); } catch { return null; }
    if (url.hostname.toLowerCase() !== 'github.com' || url.port || url.search || url.hash || url.password) return null;
    if (url.protocol === 'https:' && !url.username) path = url.pathname.slice(1);
    else if (url.protocol === 'ssh:' && url.username === 'git') path = url.pathname.slice(1);
    else return null;
  }
  return path.replace(/\.git$/, '').replace(/\/$/, '');
}

function sameRepository(actual, expected) {
  return typeof actual === 'string' && actual.toLowerCase() === expected.toLowerCase();
}

function checkOrigin(repo) {
  const remotes = git(['remote']).split(/\r?\n/).filter(Boolean);
  if (!remotes.includes('origin')) {
    if (remotes.length) throw new Error('本地已配置其他 remote，但没有 origin。请先确认目标仓库并手动配置 origin。');
    return false;
  }
  for (const push of [false, true]) {
    const args = ['remote', 'get-url', ...(push ? ['--push'] : []), '--all', 'origin'];
    const urls = git(args).split(/\r?\n/).filter(Boolean);
    if (urls.length !== 1 || !sameRepository(remoteRepository(urls[0]), repo)) {
      throw new Error('origin 的读取或推送地址与 --repo 不一致，或配置了多个地址。脚本已停止；不会改写 origin 或推送到其他仓库。');
    }
  }
  const mirror = invoke('git', ['config', '--bool', '--get', 'remote.origin.mirror']);
  if (mirror.status === 0 && mirror.stdout.trim() === 'true') throw new Error('origin 启用了 mirror 模式，请先改为普通项目 remote。');
  if (mirror.error || ![0, 1].includes(mirror.status)) throw new Error('无法检查 origin 的 mirror 配置。');
  return true;
}

function localRepository() {
  for (const variable of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) {
    if (process.env[variable]) throw new Error(`请先移除 ${variable} 环境变量，再从项目根目录运行，避免操作另一个 Git 仓库。`);
  }
  const result = invoke('git', ['rev-parse', '--show-toplevel']);
  if (result.status !== 0) {
    if (existsSync(resolve(root, '.git')) || !String(result.stderr).includes('not a git repository')) {
      throw new Error(`无法确认本地 Git 仓库边界。\n${detail(result)}`);
    }
    return false;
  }
  if (realpathSync(result.stdout.trim()) !== realpathSync(root)) {
    throw new Error('本项目位于另一个 Git 仓库的子目录中。请把完整项目放到独立目录或使用本项目自己的 clone，然后重新运行。');
  }
  return true;
}

function checkLocalState() {
  const branch = invoke('git', ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (branch.status !== 0 || branch.stdout.trim() !== 'main') {
    throw new Error('本地必须位于 main 分支。请先自行处理分支或 detached HEAD，脚本不会改名、切换或重置已有分支。');
  }
  for (const state of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG']) {
    const path = git(['rev-parse', '--git-path', state]);
    if (existsSync(isAbsolute(path) ? path : resolve(root, path))) {
      throw new Error('本地存在尚未完成的合并、变基或其他 Git 操作，请先处理完毕。');
    }
  }
  if (git(['ls-files', '--unmerged'])) throw new Error('本地存在未解决的冲突，请先处理。');
  for (const path of ['dist/index.html', 'white-lilac-dragon-pet-release.zip']) {
    const ignored = invoke('git', ['check-ignore', '--quiet', '--no-index', '--', path]);
    if (ignored.status !== 0) throw new Error('.gitignore 必须排除 dist/ 与 *.zip，避免提交构建输出和发布压缩包。');
  }
  const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
  if (tracked.some(path => path.startsWith('dist/') || /\.zip$/i.test(path) || path.startsWith('node_modules/') || /(^|\/)\.env(?:\.|$)/.test(path) && !path.endsWith('.env.example'))) {
    throw new Error('Git 已跟踪构建输出、ZIP、node_modules 或环境变量文件。请先检查并自行移除这些受跟踪内容；.gitignore 不会取消已有跟踪。');
  }
  for (const identity of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
    const result = invoke('git', ['var', identity]);
    if (result.status !== 0) throw new Error('Git 提交身份尚未配置。请先在本项目配置 git config user.name 与 git config user.email，然后重新运行。');
  }
}

function repositoryInfo(repo, { allowMissing = false } = {}) {
  const response = api('GET', `repos/${repo}`, { allow: allowMissing ? [404] : [] });
  if (response.status === 404) return null;
  const info = response.data;
  if (!sameRepository(info?.full_name, repo)) throw new Error('GitHub 返回的真实仓库与 --repo 不一致，请检查仓库是否已改名或转移。');
  if (info.archived || info.disabled) throw new Error('目标仓库已归档或被禁用，不能用于本次部署。');
  if (!info.permissions?.push) throw new Error('当前账号没有目标仓库的写入权限。');
  if (!info.permissions?.admin && !info.permissions?.maintain) {
    throw new Error('无法确认当前账号具备管理 Pages 的仓库权限。请使用管理员或维护者账号，并确认 token 对该仓库具有所需权限。');
  }
  progress.repositoryUrl = webUrl(info.html_url, '仓库地址');
  return info;
}

function npmRun(name) {
  if (process.env.npm_execpath) {
    must(process.execPath, [process.env.npm_execpath, 'run', name], `npm run ${name} 失败，未开始远程部署。`, { inherit: true });
  } else if (process.platform !== 'win32') {
    must('npm', ['run', name], `npm run ${name} 失败，未开始远程部署。`, { inherit: true });
  } else {
    throw new Error('请通过 npm run deploy -- … 运行，以便在 Windows 上安全调用 npm。');
  }
}

function inspectRemoteHistory(info, repo, hadOrigin) {
  const source = hadOrigin ? 'origin' : info.clone_url;
  if (!hadOrigin && !sameRepository(remoteRepository(source), repo)) throw new Error('GitHub 未返回与目标仓库匹配的 clone 地址。');
  const refs = git(['ls-remote', '--heads', source], '无法读取远程 Git 历史。请检查网络及 Git 认证；使用 HTTPS 时可先运行 gh auth setup-git。');
  if (!refs) return;
  if (!hadOrigin) throw new Error('目标仓库已有历史，而本地没有匹配的 origin。请在该项目的现有 clone 中运行，或选择空仓库，避免覆盖其他项目。');
  if (!refs.split(/\r?\n/).some(line => line.endsWith('\trefs/heads/main'))) throw new Error('已有远程仓库不存在 main 分支，请先手动整理仓库分支。');
  const localHead = invoke('git', ['rev-parse', '--verify', 'HEAD']);
  if (localHead.status !== 0) throw new Error('目标仓库已有提交，本地却没有对应历史。请先 clone 目标项目，再放入需要的修改。');
  const remotePackage = api('GET', `repos/${repo}/contents/package.json?ref=main`, { allow: [404] });
  let name;
  if (remotePackage.status === 200 && remotePackage.data?.encoding === 'base64' && remotePackage.data?.type === 'file') {
    try { name = JSON.parse(Buffer.from(remotePackage.data.content, 'base64').toString('utf8')).name; } catch { /* Report the project mismatch below. */ }
  }
  if (name !== PROJECT_NAME) throw new Error('已有远程仓库的 main 不是本项目，已停止部署。请为白紫龙娘选择独立空仓库或它自己的现有仓库。');
  git(['fetch', '--no-tags', 'origin', 'main'], '读取远程 main 失败，未推送。', { inherit: true });
  const compatible = invoke('git', ['merge-base', '--is-ancestor', 'FETCH_HEAD', 'HEAD']);
  if (compatible.status !== 0) throw new Error('远程 main 不是本地历史的祖先，存在未同步提交或不同历史。请先手动整合修改；脚本不会强制推送或自动合并。');
}

function configurePages(repo) {
  const endpoint = `repos/${repo}/pages`;
  let response = api('GET', endpoint, { allow: [404] });
  if (response.status === 404) {
    repositoryInfo(repo);
    console.log('仓库可访问，但 Pages 尚未启用或当前权限/计划不允许访问；尝试启用 Actions 发布。');
    try {
      response = api('POST', endpoint, { body: { build_type: 'workflow' }, allow: [409] });
      if (response.status === 409) console.log('Pages 创建返回冲突，重新读取已有配置。');
      response = api('GET', endpoint);
    } catch (error) {
      throw new Error(`${error.message}\nPages 初始化未完成。请检查仓库计划、组织策略和 token 的 Pages/Administration 权限；脚本不会将私有仓库改为公开。`);
    }
  }
  if (response.data?.build_type !== 'workflow') {
    const changed = api('PUT', endpoint, { body: { build_type: 'workflow' } });
    if (changed.status !== 204) throw new Error('修改 Pages 配置未返回预期的 HTTP 204，请查看仓库 Settings → Pages。');
    response = api('GET', endpoint);
  }
  if (response.data?.build_type !== 'workflow') throw new Error('读回的 Pages 发布来源不是 GitHub Actions，未触发部署。');
}

async function dispatchAndWait(repo, expectedSha) {
  const workflowEndpoint = `repos/${repo}/actions/workflows/pages.yml`;
  const registrationDeadline = Date.now() + 60_000;
  let workflow;
  while (true) {
    const response = api('GET', workflowEndpoint, { allow: [404] });
    if (response.status === 200) { workflow = response.data; break; }
    if (Date.now() >= registrationDeadline) throw new Error('GitHub 尚未识别 pages.yml 工作流。请确认 Actions 可用、工作流已存在于默认 main 分支，再重新运行。');
    console.log('等待 GitHub 识别刚推送的工作流…');
    await delay(5000);
  }
  if (workflow?.state !== 'active' || workflow?.path !== WORKFLOW) throw new Error('pages.yml 工作流未启用或路径不符合预期，请检查仓库的 Actions 设置。');
  const dispatched = api('POST', `${workflowEndpoint}/dispatches`, { body: { ref: 'main' } });
  if (dispatched.status === 204) {
    throw new Error('GitHub 已接受手动触发，但返回了旧版 HTTP 204，未提供本次运行编号，无法可靠确认部署。请在 Actions 页面查看，不要把此消息视为部署成功。');
  }
  const runId = dispatched.data?.workflow_run_id;
  if (dispatched.status !== 200 || !Number.isSafeInteger(runId) || runId <= 0) throw new Error('GitHub 未返回有效的 workflow_run_id，无法确认本次部署结果。');
  progress.runUrl = webUrl(dispatched.data.html_url, '工作流运行地址');
  console.log(`本次部署记录：${progress.runUrl}`);
  console.log('等待本次运行完成（最多 30 分钟；需要环境审批时请在 GitHub 中处理）。');
  const deadline = Date.now() + MAX_WAIT_MS;
  const states = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);
  while (Date.now() < deadline) {
    const run = api('GET', `repos/${repo}/actions/runs/${runId}`).data;
    if (run?.id !== runId || run.event !== 'workflow_dispatch' || run.head_branch !== 'main' || run.head_sha !== expectedSha || run.workflow_id !== workflow.id) {
      throw new Error('GitHub 运行记录与本次预期提交不一致，可能有新的提交同时进入 main。未确认本次版本部署成功，请查看实际运行记录。');
    }
    if (run.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error(`本次工作流已结束，结果为 ${run.conclusion || 'unknown'}，部署未成功确认。`);
      const jobs = api('GET', `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`).data?.jobs;
      const deployment = Array.isArray(jobs) ? jobs.find(job => job.name === 'Deploy') : null;
      const deployed = deployment?.steps?.find(step => step.name === 'Deploy to GitHub Pages');
      if (deployment?.conclusion !== 'success' || deployed?.conclusion !== 'success') throw new Error('工作流已结束，但未确认 Pages 部署步骤成功，不能报告网站已发布。');
      return;
    }
    if (!states.has(run.status)) throw new Error(`工作流返回未知状态 ${run.status || 'unknown'}，请查看运行记录。`);
    console.log(`[${new Date().toLocaleTimeString()}] ${run.status}`);
    await delay(10_000);
  }
  throw new Error('等待部署超过 30 分钟。GitHub 上的运行可能仍在继续，请打开运行记录确认；本次命令未报告成功。');
}

async function main() {
  const opts = options(process.argv.slice(2));
  if (opts.help) { help(); return; }
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('请安装 Node.js 24 或更新版本后运行。');
  if (realpathSync(process.cwd()) !== realpathSync(root)) throw new Error('请在白紫龙娘项目根目录运行 npm run deploy。');
  const required = ['package.json', '.gitignore', 'index.html', 'assets/pet.json', 'assets/spritesheet.png', WORKFLOW];
  for (const file of required) {
    if (!existsSync(resolve(root, file)) || !statSync(resolve(root, file)).isFile()) throw new Error(`项目缺少必需文件：${file}`);
  }
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  if (pkg.name !== PROJECT_NAME || !pkg.scripts?.check || !pkg.scripts?.build) throw new Error('当前目录不是可识别的白紫龙娘项目，或缺少 check/build 脚本。');
  must('git', ['--version'], '未找到 Git。请安装 Git 并重新打开终端。');
  must('gh', ['--version'], '未找到 GitHub CLI。请从 https://cli.github.com 安装 gh，然后执行 gh auth login --hostname github.com。');
  const initialized = localRepository();
  const hadOrigin = initialized ? checkOrigin(opts.repo) : false;
  if (initialized) checkLocalState();
  const auth = invoke('gh', ['auth', 'status', '--active', '--hostname', 'github.com']);
  if (auth.error || auth.status !== 0) throw new Error('GitHub.com 尚未登录或当前认证已失效。请执行 gh auth login --hostname github.com，然后执行 gh auth setup-git，再重新运行本命令。');
  const user = api('GET', 'user').data;
  if (typeof user?.login !== 'string' || !user.login) throw new Error('无法确认当前 GitHub 登录身份。');
  console.log(`当前 GitHub 账号：${user.login}\n目标仓库：${opts.repo}`);
  console.log('GitHub Pages 通常对互联网公开；私有来源仓库本身不会让网页私密。');
  let info = repositoryInfo(opts.repo, { allowMissing: true });
  if (info && opts.create) throw new Error('目标仓库已经存在。请去掉 --create 及可见性参数后重试；脚本不会修改已有仓库的可见性。');
  if (!info && !opts.create) throw new Error('目标仓库不存在或当前账号没有访问权限。请确认实际仓库与账号；只有创建全新仓库时才使用 --create 和显式可见性参数。');
  if (info && info.default_branch !== 'main') throw new Error('已有远程仓库的默认分支不是 main。请先自行处理默认分支；脚本不会修改已有仓库的默认分支。');
  console.log('检查并构建项目…');
  npmRun('check');
  npmRun('build');
  if (!initialized) git(['init', '-b', 'main'], '无法为本项目初始化独立的 main 仓库。', { inherit: true });
  checkLocalState();
  if (info) inspectRemoteHistory(info, opts.repo, hadOrigin);
  git(['add', '--all', '--', '.'], '暂存项目失败。');
  git(['ls-files', '--error-unmatch', '--', ...required], '必需项目文件被忽略，无法生成完整部署提交。');
  checkLocalState();
  const diff = invoke('git', ['diff', '--cached', '--quiet', '--exit-code']);
  if (diff.status === 1) {
    git(['diff', '--cached', '--stat'], '无法读取待提交文件。', { inherit: true });
    git(['commit', '-m', 'Prepare white lilac dragon pet for deployment'], 'Git 提交失败，请处理提交错误后重试。', { inherit: true });
  } else if (diff.error || diff.status !== 0) throw new Error('无法检查待提交更改。');
  if (git(['status', '--porcelain'])) throw new Error('提交后工作目录仍有更改，可能存在同时编辑。请先保存并整理更改，再重新运行。');
  const expectedSha = git(['rev-parse', '--verify', 'HEAD'], '项目尚无可推送提交。');
  let created = false;
  if (!info) {
    console.log(`创建${opts.visibility === 'private' ? '私有' : '公开'}仓库 ${opts.repo}…`);
    must('gh', ['repo', 'create', opts.repo, `--${opts.visibility}`], '创建仓库失败。仓库可能已存在或当前账号无创建权限；脚本没有改动其他仓库。', { inherit: true });
    created = true;
    info = repositoryInfo(opts.repo);
    if (Boolean(info.private) !== (opts.visibility === 'private')) throw new Error('新仓库返回的可见性与明确选择不一致，已停止推送。');
  }
  if (!hadOrigin) {
    if (!sameRepository(remoteRepository(info.clone_url), opts.repo)) throw new Error('GitHub 返回的 clone 地址不符合目标仓库，未配置 origin。');
    git(['remote', 'add', 'origin', info.clone_url], '设置项目 origin 失败。');
  }
  checkOrigin(opts.repo);
  git(['-c', 'push.followTags=false', 'push', '--set-upstream', 'origin', 'refs/heads/main:refs/heads/main'], '正常推送失败。请检查远程历史、分支规则和 Git 认证；脚本不会强制推送。', { inherit: true });
  progress.pushed = true;
  info = repositoryInfo(opts.repo);
  if (created && info.default_branch !== 'main') {
    api('PATCH', `repos/${opts.repo}`, { body: { default_branch: 'main' } });
    info = repositoryInfo(opts.repo);
  }
  if (info.default_branch !== 'main') throw new Error('推送后远程默认分支不是 main，无法可靠手动运行工作流。');
  const pushedRef = api('GET', `repos/${opts.repo}/git/ref/heads/main`).data;
  if (pushedRef?.object?.sha !== expectedSha) throw new Error('远程 main 与刚推送的提交不一致，可能有并发更新。请先核对远程提交。');
  console.log('推送完成，配置 GitHub Pages…');
  configurePages(opts.repo);
  await dispatchAndWait(opts.repo, expectedSha);
  const pages = api('GET', `repos/${opts.repo}/pages`).data;
  const siteUrl = webUrl(pages?.html_url, 'Pages 网站地址');
  console.log(`\nGitHub Actions 已确认本次 Pages 部署成功。\n仓库：${progress.repositoryUrl}\n运行：${progress.runUrl}\n网站：${siteUrl}`);
}

process.once('SIGINT', () => {
  console.error('\n本地操作已中止。GitHub 上已触发的运行可能继续，请查看仓库的 Actions 页面。');
  if (progress.runUrl) console.error(`运行：${progress.runUrl}`);
  process.exit(130);
});

main().catch(error => {
  console.error(`\n部署未完成：${error.message}`);
  if (progress.pushed) console.error('代码已正常推送；本次命令尚未确认发布成功。');
  if (progress.repositoryUrl) console.error(`仓库：${progress.repositoryUrl}`);
  if (progress.runUrl) console.error(`运行：${progress.runUrl}`);
  process.exitCode = 1;
});
