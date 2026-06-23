# floorplan

实验室布局维护系统。系统支持匿名浏览、登录用户创建和维护自己的方案副本、公开方案匿名展示、服务端 SQLite 持久化、管理员导入数据包、用户管理、快照恢复和数据修复。

## 当前能力

- 服务端使用 Node 内置 `node:sqlite` 持久化数据，默认运行在 `http://localhost:5173`。
- 未登录用户只有浏览权限，只能查看共享基线和已公开的方案副本；界面不会显示“上传数据包”，后端上传接口也只允许 `admin` 调用。
- `editor` 可以创建、编辑、公开、私有化、删除自己创建的方案副本，但不能上传数据包或管理用户。
- `admin` 可以维护共享基线、上传 `.xlsx` / `.json` 数据包、管理导入草稿、管理用户、管理快照和执行维护操作。
- 不同用户可以创建相同名称的方案副本。系统通过副本 ID 区分：自己的副本显示 `我的副本 · 方案名 · #ID`，公开后显示 `我的副本 · 方案名 · 公开 #ID`；匿名公开视图显示 `公开副本 · 方案名 · 公开 #ID`，不展示创建者身份。
- `admin` 查看他人副本时显示 `用户名 的副本 · 方案名 · #ID` 或 `用户名 的副本 · 方案名 · 公开 #ID`，不会误标为“我的副本”。
- 同一副本保存时使用副本级 `revision` 做冲突检测，避免旧页面覆盖新修改。
- 每次发布导入草稿前会自动生成发布前快照；系统首次启动会建立初始基线快照。

## 权限模型

- `viewer`：未登录访客，只读。可查看共享基线和公开方案副本。
- `editor`：登录编辑用户。可创建、编辑、公开、私有化、删除自己创建的方案副本。
- `admin`：管理员。拥有 `editor` 能力，并可上传数据包、管理导入草稿、管理用户、管理快照和执行维护操作。

多人可以同时在线编辑各自创建的方案副本。当前实现不提供多人实时共同编辑同一个副本；如果同一个副本被多个页面同时保存，后保存的一方会收到版本冲突提示。

## 用户管理

`admin` 登录后可以点击“管理用户”打开弹窗表格：

- 查看用户 ID、用户名、角色、启用状态和创建时间。
- 通过表单创建 `admin` 或 `editor` 用户。
- 通过行内按钮禁用用户。禁用是软删除：用户记录保留，账号不能再登录，现有登录 session 会被撤销。
- 当前登录的管理员不能在界面中禁用自己。

禁用用户不会删除该用户创建的历史方案副本；已经公开的副本保持公开状态，但匿名视图仍不会展示创建者身份。

## 数据包说明

模板工作簿包含以下 sheet：

- `buildings`
- `floor_segments`
- `spaces`
- `labs`
- `plans`
- `plan_assignments`

导入仍按“单个完整数据包”发布，由管理员审核导入草稿后替换共享基线。用户个人方案副本保存在独立的 `plan_copies` 表中，不会因为普通用户保存副本而覆盖共享基线。

## 运行

```powershell
npm start
```

或：

```powershell
node server.js
```

访问 [http://localhost:5173](http://localhost:5173)。

## 测试

```powershell
npm.cmd test
```

测试使用 Node 内置 `node:test` runner，不需要额外安装依赖。PowerShell 如果阻止 `npm.ps1`，请使用 `npm.cmd test`。

## Docker 部署到新服务器

适合以后把项目部署到一台新的 Windows 或 Linux 服务器。服务器需要能访问 Docker Hub，首次构建会拉取 `node:24-bookworm-slim` 镜像。

### 1. 安装 Docker

- Windows 服务器：安装 Docker Desktop，并确认 Linux engine 可以启动。
- Linux 服务器：安装 Docker Engine 和 Docker Compose plugin。

安装完成后验证：

```bash
docker version
docker compose version
```

### 2. 获取代码

```bash
git clone <your-repo-url> floorplan
cd floorplan
```

如果服务器没有 Git，也可以把整个项目目录复制到服务器，但要包含这些文件和目录：

- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- `server.js`
- `app.js`
- `index.html`
- `styles.css`
- `js/`
- `server/`
- `scripts/`
- `sample-floors.csv`
- `sample-rooms.csv`

### 3. 修改默认账号密码

首次启动会自动创建默认账号。上线前建议先编辑 `docker-compose.yml`，把下面几个环境变量改成强密码：

```yaml
FLOORPLAN_ADMIN_USER: "admin"
FLOORPLAN_ADMIN_PASSWORD: "change-this-admin-password"
FLOORPLAN_EDITOR_USER: "editor"
FLOORPLAN_EDITOR_PASSWORD: "change-this-editor-password"
```

这些变量只在第一次初始化数据库、`users` 表为空时生效。如果已经生成过数据库，后续修改密码请用系统里的用户管理功能，或使用 `scripts/manage-user.js`。

### 4. 构建并启动

```bash
docker compose up -d --build
```

查看运行状态：

```bash
docker compose ps
docker compose logs -f
```

默认访问地址：

```text
http://服务器IP:5173
```

如果服务器有防火墙或云安全组，需要放行 TCP `5173` 端口。

### 5. 数据持久化

`docker-compose.yml` 会把运行数据保存到 Docker volume：

```text
floorplan_floorplan-data
```

里面包含：

- `app.db`：SQLite 数据库。
- `uploads/`：导入草稿归档。
- `backups/`：数据库备份。

升级代码时直接重新构建即可，volume 不会被删除：

```bash
git pull
docker compose up -d --build
```

不要使用 `docker compose down -v`，除非确认要删除全部运行数据。

### 6. 迁移到另一台服务器

在旧服务器导出数据卷：

```bash
docker run --rm -v floorplan_floorplan-data:/data -v "$PWD":/backup alpine tar czf /backup/floorplan-data.tar.gz -C /data .
```

把 `floorplan-data.tar.gz` 复制到新服务器项目目录后导入：

```bash
docker volume create floorplan_floorplan-data
docker run --rm -v floorplan_floorplan-data:/data -v "$PWD":/backup alpine sh -c "cd /data && tar xzf /backup/floorplan-data.tar.gz"
docker compose up -d --build
```

### 7. 常用维护命令

```bash
docker compose restart
docker compose logs -f
docker compose down
docker compose up -d --build
```

## 无 Docker 简易部署

如果新服务器没有安装 Docker，也可以直接从 GitHub 拉代码后用 Node 运行。这个项目没有第三方 npm 依赖，主要要求是 Node 版本必须支持内置 `node:sqlite`。

推荐做法是先按下面的清单检查服务器环境，缺什么再补什么，而不是把运行环境文件提交到仓库。密码、端口等敏感配置应该保存在服务器环境变量或服务器自己的启动脚本里，不要提交到 Git。

### 1. 环境检查清单

Windows PowerShell：

```powershell
git --version
node --version
node -e "require('node:sqlite'); console.log('node:sqlite ok')"
```

Linux shell：

```bash
git --version
node --version
node -e "require('node:sqlite'); console.log('node:sqlite ok')"
```

需要满足：

- `git --version` 能正常输出版本。
- `node --version` 建议为 Node 24 或更新版本。
- `node -e "require('node:sqlite')"` 能输出 `node:sqlite ok`。

如果缺 Git，就先安装 Git。如果缺 Node/npm，或 `node:sqlite` 检查失败，就安装 Node 24 或更新版本。npm 会随 Node 一起安装，不需要单独安装。

### 2. 安装 Node/npm

Windows 服务器推荐用 winget 安装 Node.js LTS：

```powershell
winget install OpenJS.NodeJS.LTS --scope machine --accept-package-agreements --accept-source-agreements
```

安装后重新打开一个 PowerShell 或 CMD，再验证：

```powershell
node --version
npm.cmd --version
node -e "require('node:sqlite'); console.log('node:sqlite ok')"
```

如果 PowerShell 执行 `npm` 时提示 `npm.ps1 cannot be loaded because running scripts is disabled`，改用 `npm.cmd`：

```powershell
npm.cmd start
```

Linux 服务器可以用 NodeSource 安装 Node 24：

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
```

验证：

```bash
node --version
npm --version
node -e "require('node:sqlite'); console.log('node:sqlite ok')"
```

如果服务器不能访问外网，就先在其他机器下载 Node 24 或更新版本的离线安装包，再复制到服务器安装。无论哪种方式，最终都要通过上面的三条验证命令后再运行项目。

### 3. 从 GitHub 拉代码

```bash
git clone <your-repo-url> floorplan
cd floorplan
```

拉下来后确认关键文件存在：

```bash
ls server.js app.js index.html styles.css
ls server js scripts
```

Windows PowerShell 可用：

```powershell
Get-ChildItem server.js, app.js, index.html, styles.css
Get-ChildItem server, js, scripts
```

### 4. 配置账号和端口

首次启动会自动初始化数据库和默认账号。上线前建议先设置环境变量。

Windows PowerShell 当前窗口临时设置：

```powershell
$env:PORT = "5173"
$env:FLOORPLAN_ADMIN_USER = "admin"
$env:FLOORPLAN_ADMIN_PASSWORD = "change-this-admin-password"
$env:FLOORPLAN_EDITOR_USER = "editor"
$env:FLOORPLAN_EDITOR_PASSWORD = "change-this-editor-password"
```

Linux 当前 shell 临时设置：

```bash
export PORT=5173
export FLOORPLAN_ADMIN_USER=admin
export FLOORPLAN_ADMIN_PASSWORD='change-this-admin-password'
export FLOORPLAN_EDITOR_USER=editor
export FLOORPLAN_EDITOR_PASSWORD='change-this-editor-password'
```

这些变量只在第一次初始化数据库、`users` 表为空时生效。生成 `data/app.db` 后，后续改环境变量不会覆盖已有账号。

### 5. 直接启动

Windows 或 Linux 都可以：

```bash
node server.js
```

访问：

```text
http://服务器IP:5173
```

如果服务器有防火墙或云安全组，需要放行 TCP `5173` 端口。

### 6. 后台运行

Linux 简易后台运行：

```bash
nohup node server.js > server.log 2> server.err.log &
```

查看日志：

```bash
tail -f server.log server.err.log
```

Windows 可以先用前台方式确认服务正常；长期运行建议改成 Windows 服务、计划任务，或直接使用 Docker 部署。

### 7. 无 Docker 模式的数据目录

直接运行时，数据保存在项目目录下的 `data/`：

- `data/app.db`：SQLite 数据库。
- `data/uploads/`：导入草稿归档。
- `data/backups/`：数据库备份。

迁移服务器时，把项目代码更新到新服务器后，再复制旧服务器的 `data/` 目录即可。不要把 `data/` 提交到 Git。

### 8. 更新代码

```bash
git pull
node server.js
```

如果服务已经在后台运行，更新后需要停止旧进程再重新启动。

## 默认账号

首次启动会自动创建两个账号，可通过环境变量覆盖：

- `admin / admin123456`
- `editor / editor123456`

可选环境变量：

- `FLOORPLAN_ADMIN_USER`
- `FLOORPLAN_ADMIN_PASSWORD`
- `FLOORPLAN_EDITOR_USER`
- `FLOORPLAN_EDITOR_PASSWORD`

这些环境变量只在首次初始化数据库、`users` 表为空时生效。已有 `data/app.db` 后不会覆盖现有账号。

如果需要在已有数据库中修改密码或新增账号，可以使用用户管理脚本：

```powershell
npm run user -- admin "新管理员密码" admin
npm run user -- editor "新编辑密码" editor
npm run user -- zhangsan "编辑账号密码" editor
```

第三个参数只能是 `admin` 或 `editor`。账号不存在时会创建；账号已存在时会更新密码、角色并重新启用该账号。修改后建议重启服务，并让相关用户重新登录。

如果 Windows PowerShell 提示禁止运行 `npm.ps1`，可改用：

```powershell
npm.cmd run user -- zhangsan "编辑账号密码" editor
```

或直接使用：

```powershell
node scripts/manage-user.js zhangsan "编辑账号密码" editor
```

## 运行时数据目录

服务端会在仓库下创建 `data/`：

- `data/app.db`：SQLite 数据库。
- `data/uploads/`：导入草稿归档。
- `data/backups/`：数据库备份文件。

这些内容已加入 `.gitignore`，不要提交到 Git。

## 注意

- `.xlsx` 导入、Excel 模板下载和 Excel 数据包导出依赖 `index.html` 中的 SheetJS CDN 脚本。
- 如果环境无法访问外网 CDN，页面仍可正常浏览，并且可以导入 / 导出 `.json` 数据包，但 `.xlsx` 相关功能会不可用。
- 方案副本只复制方案和方案分配关系；楼栋、楼层、空间和实验室等基线结构仍由管理员统一维护。
