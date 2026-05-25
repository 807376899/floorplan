# floorplan

实验室布局维护系统，支持匿名浏览、登录写入、服务端持久化、管理员导入草稿发布与快照恢复。

## 当前能力

- 服务端使用 Node 内置 `node:sqlite` 持久化正式数据。
- 匿名用户可直接查看当前正式布局。
- `editor` 和 `admin` 登录后可在线修改当前数据；保存后刷新页面即可看到最新结果。
- `editor` 和 `admin` 都可以新增方案；只有 `admin` 可以删除非锁定方案。
- `admin` 上传 `.xlsx` / `.json` 数据包时，先生成导入草稿，再决定发布或丢弃。
- 每次发布导入草稿前会自动生成“发布前快照”；系统首次启动会建立“初始基线快照”。
- `admin` 可从快照恢复当前正式数据。

## 数据包说明

模板工作簿包含以下 sheet：

- `buildings`
- `floor_segments`
- `spaces`
- `labs`
- `plans`
- `plan_assignments`

部署版仍按“单个完整数据包”导入，不做局部 merge。

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

这些环境变量只在首次初始化数据库、`users` 表为空时生效；已有 `data/app.db` 后不会覆盖现有账号。

如果需要在已有数据库中修改密码或新增账号，使用用户管理脚本：

```powershell
npm run user -- admin "新管理员密码" admin
npm run user -- editor "新编辑密码" editor
npm run user -- zhangsan "编辑账号密码" editor
```

第三个参数只能是 `admin` 或 `editor`。账号不存在时会创建；账号已存在时会更新密码、角色并重新启用该账号。修改后建议重启服务，并让相关用户重新登录。

如果 Windows PowerShell 提示禁止运行 `npm.ps1`，可改用 `npm.cmd run user -- ...`，或直接使用 `node scripts/manage-user.js ...`。

## 运行时数据目录

服务端会在仓库下创建 `data/`：

- `data/app.db`：SQLite 数据库
- `data/uploads/`：导入草稿归档
- `data/backups/`：数据库备份文件

这些内容已加入 `.gitignore`，不要提交到 Git。

## 注意

- `.xlsx` 的导入、Excel 模板下载、Excel 数据包导出依赖 `index.html` 中的 SheetJS CDN 脚本。
- 如果环境无法访问外网 CDN，页面仍可正常浏览，并且可以导入 / 导出 `.json` 数据包，但 `.xlsx` 相关功能会不可用。
