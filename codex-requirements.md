# Codex Requirements

本文件记录当前任务中不可破坏的长期需求。每轮迭代开始前必须重新读取本文件，并据此校验实现方向。

## 迭代规则

- 每轮迭代前，必须读取 `codex-requirements.md`。
- 每轮迭代结束后，必须读取 `acceptance-checklist.md` 并按清单检查。
- 不得在未确认符合本文档要求的情况下，删除、弱化或绕过下列权限、界面和交互约束。

## 用户权限

系统有三类用户：

- 游客：
  - 只读。
- editor：
  - 可读。
  - 可新增方案副本。
  - 可修改自己创建且非基线的方案副本。
  - 可删除自己创建且非基线的方案副本。
  - 可选择是否公开自己创建且非基线的方案副本。
- admin：
  - 拥有 editor 的所有权限。
  - 可新增方案副本。
  - 可删除、修改、公开或设为私有自己创建的方案副本。
  - 可导入初始基线方案。
  - 可修改基线方案。
  - 可将任意可管理方案设置为不可被非 admin 修改的基线方案。
  - 可创建新用户。
  - 可禁用用户。

## 界面展示

- 系统有单方案模式和对比模式。
- 登录系统默认使用单方案模式。
- 单方案模式默认显示最新基线方案。
- 切换到对比模式后，用户可在缩略图中选择并对比两套方案。
- 对比模式必须提供方案差异对比面板，随左右方案选择自动刷新，按学院、空间、实验室和面积展示两套方案变化；该面板为只读，不新增数据库表，不比较座位数变化。
- 方案差异对比面板默认折叠；展开第一层后显示学院统计，空间变化和实验室变化仍分别保持二级折叠。学院统计必须展示左右方案中每个学院拥有的场地数量和面积，并显示数量差和面积差。

## 房间详情

在主图中点击某个房间时，详细信息栏必须显示该实验室的详细信息：

- 实验室名称
- 地点
- 前后门牌
- 所属学院
- 所属专业
- 负责人
- 房间尺寸
- 面积
- 网段
- 座位数
- 电脑数量
- 当空间没有当前方案下 `assigned` 实验室时，详细信息栏必须显示“未规划”卡片而不是空白；规划操作在业务编辑的实验室信息区完成，系统自动生成实验室名称为“未规划实验室+门牌号”的占位实验室，其他实验室信息为空。
- 已有实验室的详细信息栏不得展示“分配状态”和“生效时间”；改建操作在业务编辑的实验室信息区完成，点击后原实验室与空间解绑，原分配标记为 `Invalid`，并自动为该空间生成同学院的“未规划实验室+门牌号”占位实验室分配。

## 主图显示与缩放

- 主图默认适配显示大小。
- 主图默认显示在中央。
- 主图中的教学楼信息不应随着缩放一起变化。
- 主图中的北边指示不应随着缩放一起变化。
- 主图中的教学楼信息和北边指示必须固定浮在主图可视区域上，不得随着主图内部滚动条滚动而移动。
- 宽屏下当 workspace 中缩略图栏、主图栏、详细信息栏并列时，workspace 高度必须按视口固定，不得因为楼层或缩略图数量变多而变高；多出的楼层/缩略图内容必须在对应内部区域使用滚动条查看。
- 中屏下 workspace 必须显示为两行：缩略图区独占第一行，主图和详细信息栏在第二行并列且高度对齐。
- 窄屏下当 workspace 改为堆叠布局时，workspace 高度必须由缩略图区域高度、主图区域高度和详细信息区域高度自然相加，主图不得被裁切或隐藏。
- 中屏或窄屏下当缩略图区位于 workspace 顶部时，每组缩略图中的 compare-title 必须位于左侧、floor-thumbs 位于右侧，二者横向并列且高度一致；每栋楼的缩略图只能占一行，楼层缩略图数量变多时，compare-title 与 floor-thumbs 必须通过同一个横向滚动条一起滚动，不得换行、固定高度裁切或纵向滚轮隐藏。
- 详细信息栏在宽度足够时，可以将逐行信息改为矩阵排列；宽度不足时必须保持单列，避免文字拥挤或重叠。
- 楼梯标识使用楼层骨架 `floor_segments.element_type = stairs` 表示，并在主图和缩略图中显示楼梯线与“楼梯”标识；楼梯不作为可分配空间参与实验室落位。
- 电梯标识使用楼层骨架 `floor_segments.element_type = elevator` 表示，并在主图和缩略图中显示灰色独立电梯图标；电梯不作为可分配空间参与用途单元落位。

## 2026-06-09 管理方案与多基线

- admin 上传数据包后，包内每个 `plans` 方案都必须生成一个 admin 私有、非基线方案，并立即在 admin 主界面可见。
- 多方案数据包必须全部导入；不得只导入第一个方案或只生成单个方案。
- 未设为基线前，admin 上传生成的方案仅 admin 可见，不影响 viewer/editor 的可见方案范围。
- 顶部入口文案为“管理方案”，不再以“管理导入草稿”作为主要操作入口。
- “管理方案”中必须能列出 admin 上传方案、admin 创建方案、editor 公开方案，并显示来源、创建者/上传者、是否由当前 admin 创建、公开状态和基线状态。
- “管理方案”右侧只提供可视化预览和管理动作，不显示高级数据编辑表格，不允许在该弹窗中编辑方案内容。
- 首次上传数据包后立刻打开“管理方案”时，方案预览必须可见；不得出现空白预览。
- 管理方案预览必须兼容 `plan_code/id/plan_id`、`lab_code/id/lab_id`、`space_code/id/space_id` 等常见导入字段。
- 任何方案内容编辑必须在主界面完成；admin 可以在主界面编辑基线内容。
- admin 可在“管理方案”中重命名、删除方案、将方案设为基线；可以存在多个基线。
- 方案被设为基线后，除 admin 外任何用户都不可修改、删除或切换公开/私有状态。
- 单方案模式默认展示最新设为基线的方案。

## 2026-06-09 高级编辑易用性

- 高级数据编辑默认提供面向业务用户的“业务编辑”入口，不应默认要求用户理解底层数据表之间的编码关系。
- “业务编辑”首要覆盖实验室落位和搬迁：用户在当前楼层选择空间和实验室即可保存，系统自动维护方案、实验室、空间之间的关联字段。
- 方案分配状态只使用 `assigned` 和 `Invalid`：`assigned` 表示实验室在当前方案中占用空间；`Invalid` 表示该实验室在当前方案中的分配已失效或过期。
- 物理空间业务状态由当前方案推导：`assigned` 且生效时间不为空为“已建设”；`assigned` 且生效时间为空为“已规划”；无有效分配或分配为 `Invalid` 为“未规划”；人工设置 `spaces.current_status = unavailable` 时为“不可用”且优先显示。
- 旧数据中的 `pending_move` 必须兼容为 `assigned`，`unplaced` 必须兼容为 `Invalid`。
- 实验室信息不再维护“建设时间”字段；业务逻辑中以方案分配的生效日期判断已规划/已建设状态。
- 业务编辑中不再提供实验室备注入口；保存实验室资料时不得依赖该隐藏字段，也不得因字段缺失清空历史实验室备注。
- “业务编辑”必须围绕当前楼栋、当前楼层、当前空间组织，不得要求业务用户像数据库管理员一样分别维护多个底层表并手动寻找编码关系。
- 数据编辑栏必须清晰区分“切换视图”和“当前视图操作”：业务编辑、教学楼、楼层骨架等入口属于视图切换；新增、保存、应用修改、导出等按钮属于当前视图操作，两类控件必须视觉分组且样式不同，避免误点。
- 点击缩略图或切换楼层后，业务编辑左侧列表必须只显示当前楼栋、当前楼层的空间与落位数据，不得混入其他楼层或全方案所有分配。
- 业务编辑左侧空间列表在大屏下必须与缩略图栏同宽；每张卡片必须显示空间、推导后的物理状态，以及当前方案中的实验室落位摘要。
- 业务编辑模式下，高级数据编辑外层 `dataEditor` 不得出现第三个滚动条；只允许左侧空间列表和右侧编辑表单各自独立滚动。
- 业务编辑右侧必须先简化展示不可改信息：前门牌、后门牌、骨架段和推导后的物理状态；已有空间的前门牌、后门牌、骨架段不可改，新增空间除外。空间信息表单中物理状态位于宽度之后，网段字段宽度与长/宽一致，空间备注宽度为长/宽字段的两倍。
- 业务编辑中可在选中空间上下文内维护可编辑空间资料、实验室资料和落位安排；系统负责同步 `spaces`、`labs`、`plan_assignments` 的底层关系。除教学楼和楼层骨架等结构维护外，物理空间、实验室、方案分配三张原始表的日常编辑能力必须由业务编辑覆盖。
- 业务编辑中“实验室信息”必须位于“空间信息”之前；当选中空间未规划时，实验室信息区只显示 `business-preview business-unplanned-card` 未规划卡片和可用操作，不显示落位实验室下拉或实验室资料表单。
- “规划”和“改建”操作必须位于业务编辑的实验室信息区；详情信息栏不再提供规划和改建按钮。
- 业务编辑中的实验室类型、所属学院、所属专业必须使用下拉单选；所属专业按已选学院联动过滤。admin 必须通过数据编辑中的学院、专业和实验室类型原始表维护基础信息，顶部不再提供重复的“基础信息”独立弹窗入口，editor/viewer 只能使用已启用的基础信息选项。
- 数据编辑中的学院和专业信息仅 admin 可见、可编辑；editor/viewer 不显示学院和专业原始表，也不显示业务编辑中的学院和专业字段。
- 点击“规划”未规划空间时，所属学院必须使用下拉单选，不得再使用自由文本提示框；学院选项来自 admin 维护的基础信息。
- 业务编辑中的落位实验室候选只应显示当前方案中未落位的实验室，以及当前空间已落位的实验室；已落位到其他空间的实验室不得作为可选项出现，也不显示“已隐藏”数量提示。若保存时检测到实验室已被其他空间占用，必须给出明确提示，不得无响应。
- 详情信息栏点击“搬迁实验室”后，目标空间必须使用下拉单选；候选为当前方案下全校范围内 `active` 且无 `assigned` 实验室的未规划空间，标签显示楼栋、楼层、门牌、空间编码和面积。
- 业务编辑中从未规划空间选择实验室后，若当前用户有实验室资料编辑权限，实验室名称、类型、学院、专业、负责人、座位数和电脑数必须立即可编辑；负责人字段宽度与专业字段一致。
- 业务编辑必须支持安全删除实验室：admin 可删除任意非基线方案中未被其他空间或其他方案引用的实验室，editor 可删除自己创建且非基线方案中满足同样安全条件的实验室；删除时同步移除当前方案中的相关落位关系，基线方案和被其他方案引用的实验室不得删除。
- 当存在多个可见方案副本且副本中包含同 ID 的楼栋、楼层骨架、空间或实验室资料时，服务端返回给前端的可见数据必须保证最新/刚保存的副本资料优先显示，不能让旧副本覆盖刚保存的业务编辑结果。
- 保存业务编辑或原始表格后，重新拉取服务端数据必须能读回刚才保存的空间资料、实验室资料和落位安排；不得出现接口已写入但界面被其他副本同 ID 数据覆盖而看起来无法保存的情况。
- 业务编辑必须支持新增空间和删除空间；删除空间在当前非基线方案中移除空间数据，并将当前方案中该空间相关分配标记为 `Invalid`，不得仅标记为不可用。admin 可删除任意非基线方案中的空间，editor 只能删除自己创建且非基线方案中的空间。
- 原始表格能力仅保留为高级结构维护入口；`spaces`、`labs`、`plan_assignments` 原始表不再作为可见编辑入口，业务编辑必须替代这些单表编辑。详情信息栏不再显示“编辑此空间”“编辑此实验室”“查看当前分配”等旧原始表跳转按钮。
- admin 可在教学楼、楼层骨架、学院、专业、实验室类型原始表中删除行；删除教学楼必须级联删除该楼的楼层骨架和空间，删除楼层骨架必须级联删除绑定到该骨架的空间，相关方案分配必须标记为 `Invalid` 且保留实验室资料；被实验室或专业引用的学院、专业和实验室类型仍必须阻止删除，并在当前表格附近明确提示原因，非 admin 不显示删除入口。
- admin 在楼层骨架原始表中修改教学楼编码、楼层编码或走廊段编码时，系统必须按原始骨架身份同步迁移绑定空间，并更新分配引用；若目标骨架键已存在，必须阻止保存并提示冲突，不得把原骨架复制成另一楼层的重复数据。
- 编辑权限仍必须遵守方案权限：editor 只能编辑自己创建且非基线的方案；admin 可编辑基线方案；viewer/游客只读。
- 前端界面应采用清晰的业务工具风格，业务编辑和主要工作区不得使用渐变背景，状态颜色必须明确区分已建设、已规划、未规划、不可用。
- 数据自动编号必须集中配置并可复用：默认校区编码为下沙校区 `01`、绍兴校区 `02`；教学楼编号为 `B` + 校区码 + 两位楼号；空间编号为 `0` + 校区码 + 两位楼号 + 两位楼层 + 前门牌两位 + 后门牌两位；单门空间后门牌为空时后门牌编号必须等于前门牌编号；楼层骨架编号使用 `EW/NS/ST/EV/OT` + 校区码 + 两位楼号 + 两位楼层 + 两位序号；新增用途单元编号使用 `UNIT` + 六位流水。
- 新增记录可自动生成编号；已有记录不得因字段变化静默改号，必须由 admin 显式执行补全/刷新编号后才更新，并同步相关空间、骨架和方案分配引用；导入数据已有编号时默认保留。
- 现有 `labs` 表短期继续作为底层表名和关系字段来源，但业务含义扩展为“用途单元”，可承载实验室、教室、办公室、公共空间等用途；旧 `LAB...` 编号继续兼容，新建用途单元使用 `UNIT...` 编号。
## Numbering and Stable Identity

- Business codes are editable identifiers and must not be used as the only durable row identity. Existing `id` values for buildings, floor segments, spaces, labs, lab types, and plans must be preserved when codes are filled or refreshed.
- Admin post-upload numbering normalization must be supported. It must create a snapshot before writing, normalize the active dataset and all non-deleted plan copies together, and migrate references instead of creating duplicate old/new rows.
- The active dataset save path must defensively strip plan-copy payload rows before persisting. Visible datasets may merge copy-specific buildings, floor segments, spaces, labs, plans, and assignments for display, but those rows must never be written back into `active_dataset`.
- Plan-copy identity must be carried by an explicit copy id (`copy_id`/`copyId`) instead of being inferred only from `plan_code`; plan codes may be normalized to `PLAN...` while the copy remains manageable by admin.
- Building code normalization uses `B` + campus code + two-digit building number, for example `B0109`.
- Plan codes must not contain Chinese text after explicit numbering normalization. Normalized plan codes use global sequential `PLAN000001`, `PLAN000002`, and so on across the active dataset and plan copies.
- Use type codes must not contain Chinese text after explicit numbering normalization. Normalized use type codes use sequential `USE0001`, `USE0002`, and so on.
- Use types are reusable dictionary entries keyed by normalized `type_name`; duplicate rows such as repeated "实验室" or "教室" must be merged instead of treated as separate business entities. The default dictionary keeps `USE0001` for "实验室" and `USE0002` for "教室".
- Admin plan management must include both active dataset plans and non-deleted plan copies. Admin can rename, delete, and baseline either kind through the manage plans UI, while the server must keep at least one manageable plan available.
- When building codes change, all bound floor segment and space `building_code` references must be migrated. Saving after normalization must not leave the old building row visible through stale plan-copy data.

## Admin Correction Usability

- The business editor must not expose a generic "refresh space code on save" checkbox for existing spaces. Existing spaces should show stable door/code summary fields by default, with an admin-only explicit correction action when door text was entered incorrectly.
- Admin door/code correction must allow editing `front_door` and `rear_door`, preview the resulting `space_code`, and refresh the space code only when the correction panel is active. If `rear_door` is blank, the generated code must reuse the last two digits from `front_door`.
- Floor skeleton editing must provide clear creation controls for corridor-adjacent structural elements. Stairs and elevators need dedicated add buttons or equivalent guidance so a new admin can create them without knowing raw `element_type` values.
- Newly added stairs and elevators must use the configured segment code prefixes (`ST` and `EV`) and remain non-assignable skeleton elements.
