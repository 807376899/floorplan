# floorplan

实验室布局维护系统。系统支持匿名浏览、登录用户创建和维护自己的方案副本、公开方案匿名展示、服务端 SQLite 持久化、管理员导入数据包、快照恢复和数据修复。

## 当前能力

- 服务端使用 Node 内置 `node:sqlite` 持久化数据，默认运行在 `http://localhost:5173`。
- 未登录用户可以浏览共享基线数据，以及所有已公开的方案副本；不能新增、修改或删除任何数据。
- 登录用户可以基于当前方案创建自己的方案副本，编辑该副本中的方案分配和搬迁结果，并选择将副本设为公开或私有。
- 登录用户只能修改或删除自己创建的方案副本；公开后的副本会在匿名浏览视图中展示。
- 同一副本保存时使用副本级 `revision` 做冲突检测，避免旧页面覆盖新修改。
- `admin` 可以维护共享基线数据、上传 `.xlsx` / `.json` 数据包、管理导入草稿、恢复快照和修复中文显示。
- 每次发布导入草稿前会自动生成发布前快照；系统首次启动会建立初始基线快照。

## 权限模型

- `viewer`：未登录访客，只读。可查看共享基线和公开方案副本。
- `editor`：登录用户。可创建、编辑、公开、私有化、删除自己创建的方案副本。
- `admin`：管理员。拥有 `editor` 能力，并可维护共享基线、导入数据包、管理快照和执行维护操作。

多人可以同时在线编辑各自创建的方案副本。当前实现不提供多人实时共同编辑同一个副本；如果同一个副本被多个页面同时保存，后保存的一方会收到版本冲突提示。

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

如果需要在已有数据库中修改密码或新增账号，使用用户管理脚本：

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
