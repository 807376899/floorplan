# floorplan

实验室搬迁规划前端原型。

## 当前能力

- 采用新的数据模型：
  - `buildings`
  - `floor_segments`
  - `spaces`
  - `labs`
  - `plans`
  - `plan_assignments`
- 上传入口简化为一个 Excel 数据包，工作簿内通过多个 sheet 管理数据。
- 左侧并列展示“搬迁前 / 搬迁后”两套缩略图。
- 中间只展示一套主楼层图，点击任一缩略图切换当前方案与楼层。
- 右侧详情区跟随当前主图，展示空间、实验室和方案分配信息。
- 支持在页面内编辑当前数据，并导出整个 Excel 数据包。
- 使用 `localStorage` 做本地持久化，刷新页面后会恢复上次数据。

## 数据包说明

模板工作簿包含以下 sheet：

- `buildings`
- `floor_segments`
- `spaces`
- `labs`
- `plans`
- `plan_assignments`

用户只需要上传这一个 Excel 文件，不需要分别上传多张表。

## 运行

```powershell
python -m http.server 5173
```

然后访问 [http://localhost:5173](http://localhost:5173)。
