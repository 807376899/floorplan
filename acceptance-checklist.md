# Acceptance Checklist

每轮迭代结束后必须读取本文件，并在最终回复前完成或说明无法完成的检查。

## 必查项

- [ ] 已重新读取 `codex-requirements.md`，确认本轮实现没有破坏不可破坏需求。
- [ ] 权限模型覆盖游客、editor、admin 三类用户。
- [ ] 游客只能只读。
- [ ] editor 可读、可新增方案副本、可修改/删除/公开或私有自己创建且非基线的副本。
- [ ] admin 拥有 editor 权限。
- [ ] admin 可导入初始基线方案。
- [ ] admin 可修改基线方案。
- [ ] admin 可将某个方案设置为不可被非 admin 修改的基线方案。
- [ ] admin 可通过明确入口将当前方案设置为不可被非 admin 修改的锁定基线；设置后该方案默认作为最新基线展示。
- [ ] admin 可创建新用户和禁用用户。
- [ ] admin 登录后可正常拉取可见方案数据；旧数据缺少 `colleges`、`majors`、`lab_types` 等数组时不得导致 bootstrap 或登录后刷新报错。
- [ ] 本机直接运行 `npm start` 或 `node server.js` 默认监听 `3000`，遇到 Windows 保留端口或端口占用时输出可执行的端口切换提示。
- [ ] editor/admin 选中自己可管理的副本时，可通过详情栏维护空间、实验室和当前分配相关的日常资料。
- [ ] 详情信息栏不显示“编辑此空间/编辑此实验室/查看当前分配”等旧原始表跳转按钮。
- [ ] 保存副本私有编辑后，不得修改共享基线数据或其他用户副本。
- [ ] 锁定基线方案不可被 editor 修改、删除、公开或私有化。
- [ ] 登录系统默认进入单方案模式。
- [ ] 单方案模式默认显示最新基线方案。
- [ ] 可切换到对比模式。
- [ ] 对比模式可通过缩略图选择并对比两套方案。
- [ ] 缩略图栏顶部集中显示教学楼下拉框、单方案/对比模式切换，以及独立的新增方案、公开方案、删除方案按钮；教学楼在左、方案模式在右，按钮与“缩略图”标题同一行。
- [ ] 缩略图栏不显示“模式”文字标签，也不显示“左右方案由各列下拉框控制”等提示。
- [ ] 每个缩略图列顶部使用对应方案下拉框代替方案信息标签；两个方案下拉框不叠压，方案名称完整可读且不使用省略号截断。
- [ ] 方案下拉框中基线方案显示“基线”且不显示副本编号；非基线副本在完整名称后显示短编号，公开副本显示“公开 + 副本编号”（如“公开1”），私有副本只显示编号（如“1”），且不显示“公开副本”标签。
- [ ] 普通方案下拉中的公开副本匿名展示，不显示创建者；自己的副本显示“我的”。不同用户可创建重名方案副本，创建时不进行方案名唯一性校验或自动改名。
- [ ] 主界面不显示楼层下拉框，楼层切换由缩略图完成。
- [ ] 主界面不显示学院高亮下拉框；所有学院默认高亮，点击学院图例项可在主图和缩略图中同步弱化/恢复该学院，并有圆形多色总开关切换正常显示/弱化显示，hover 文案显示“正常显示”或“弱化显示”。
- [ ] 对比模式显示方案差异对比面板，随左右方案选择刷新，并按学院、空间、实验室和面积展示变化，不显示座位变化。
- [ ] 方案差异对比面板初始折叠；展开第一层后显示学院统计，空间变化和实验室变化仍保持二级折叠。
- [ ] 学院统计展示左右方案中每个学院的场地数量和面积，并显示数量差和面积差。
- [ ] 点击主图中的房间后，详细信息栏显示实验室名称、地点、前后门牌、所属学院、所属专业、负责人、房间尺寸、面积、网段、座位数、电脑数量。
- [ ] 空间没有当前方案下 `assigned` 实验室时，详细信息栏显示“未规划”卡片；日常规划、实验室资料和空间资料维护逐步由详情栏承接。
- [ ] 已有实验室详情不显示“分配状态”和“生效时间”；admin/editor 在可编辑且自己可管理的方案中可从详情栏内联编辑实验室和改建房间，改建保存后旧分配变为 `Invalid`，当前空间绑定新的“待改建房间”用途单元，改建年月写入当前分配的 `effective_from`。
- [ ] 未选中房间时，详情栏只向有当前方案编辑权限的 admin/editor 显示“新增房间”，不显示编辑实验室、改建房间或更多菜单。
- [ ] 主图默认适配显示大小。
- [ ] 主图默认居中显示。
- [ ] 主图不显示独立虚线边框；放大后背景网格和鼠标拖动画布仍正常。
- [ ] 当前方案落位用途类型为 `教室` 的空间在主图和缩略图中显示为灰色；其他已落位空间仍按学院区分颜色，未规划空间保持未规划灰色。
- [ ] 缩放主图时，教学楼信息保持固定显示，不随缩放变化。
- [ ] 缩放主图时，北边指示保持固定显示，不随缩放变化。
- [ ] 放大主图并滚动 `.floorplan` 后，教学楼信息和北边指示仍固定浮在主图可视区域，不随内部滚动条移动。
- [ ] 放大主图后，可按住主图空白区域拖动画面平移；拖拽实验室搬迁时不会触发画布平移。
- [ ] 宽屏三栏并列时，楼层或缩略图数量变多不会撑高 workspace，多余内容在缩略图/对应内部区域滚动查看。
- [ ] 中屏时，缩略图区独占 workspace 第一行，主图和详细信息栏在第二行并列且高度对齐。
- [ ] 窄屏堆叠时，workspace 高度由缩略图区域、主图区域、详细信息区域三段自然相加，主图不会被裁切或隐藏。
- [ ] 中屏或窄屏下缩略图区位于顶部时，每组缩略图的 compare-title 在左、floor-thumbs 在右横向并列且高度一致；每栋楼缩略图只占一行，数量变多时通过同一个横向滚动条一起滚动，不换行、不被固定高度裁切，也不出现纵向滚轮隐藏。
- [ ] 单个楼层缩略图完整适配预览框，缩略图内部没有鼠标滚轮或内部滚动条；需要滚动时只滚动缩略图列表容器。
- [ ] 详细信息栏宽度足够时，行式信息可以矩阵排列；宽度不足时保持单列且文字不重叠。
- [ ] `floor_segments.element_type = stairs` 的楼层骨架在主图和缩略图中显示楼梯标识，且不作为实验室可分配空间。
- [ ] `floor_segments.element_type = elevator` 的楼层骨架在主图和缩略图中显示灰色独立电梯图标，且不作为用途单元可分配空间。
- [ ] 已运行与本轮改动风险匹配的检查或测试；如未运行，必须说明原因。
- [ ] 本轮迭代出现的长期需求已更新到 `codex-requirements.md` 和 `acceptance-checklist.md`。
- [ ] 已将更新同步到 GitHub。

## 2026-06-09 管理方案与多基线验收

- [ ] admin 上传含多个 `plans` 的数据包后，每个方案都生成 admin 私有、非基线方案，并立即在 admin 主界面可见。
- [ ] 未设为基线前，admin 上传生成的方案对 viewer/editor 不可见。
- [ ] 顶部入口显示为“管理方案”。
- [ ] “管理方案”能列出 admin 上传方案、admin 创建方案、editor 公开方案，并显示来源、创建者/上传者、是否当前 admin 创建、公开状态和基线状态。
- [ ] “管理方案”右侧只显示可视化预览和管理动作，不显示高级数据编辑表格或可编辑方案内容的控件。
- [ ] 首次上传数据包后立刻打开“管理方案”，右侧预览显示楼层图，不是空白。
- [ ] 使用 `id/plan_id/lab_id/space_id` 字段的数据包导入后，管理方案预览仍能正确显示。
- [ ] admin 可在“管理方案”中重命名、删除方案、设为基线，也可取消基线设置。
- [ ] 可以存在多个基线；单方案模式默认展示最新设为基线的方案。
- [ ] editor 公开方案被设为基线后，editor 不可修改、删除或切换公开/私有状态。
- [ ] admin 可在主界面编辑基线内容。

## 2026-06-09 高级编辑易用性验收

- [ ] 高级数据编辑不显示“业务编辑”tab，默认进入第一个可见原始维护表。
- [ ] 数据编辑栏将教学楼、楼层骨架、学院、专业、用途类型、方案等视图切换入口与“新增行 / 应用修改 / 导出当前表”等当前视图操作分组展示，视觉样式可明确区分。
- [ ] 详情栏和主图/待安置区交互承接物理空间、实验室资料和方案分配日常编辑，用户不需要手填 `plan_code/lab_code/space_code` 或直接编辑 `spaces/labs/plan_assignments` 原始表。
- [ ] 物理空间状态按当前方案推导：已建设、已规划、未规划、不可用显示正确，且不可用优先。
- [ ] 方案分配状态只提供 `assigned` 和 `Invalid`；旧数据中的 `pending_move/unplaced` 可兼容显示和保存。
- [ ] 实验室信息不再显示、导入、导出或保存“建设时间”字段；已规划/已建设状态仍由方案分配生效日期推导。
- [ ] 详情栏不显示实验室备注入口，保存实验室资料时不依赖 `labNotes` 字段，也不会因字段缺失清空历史实验室备注。
- [ ] 右侧表单先展示前门牌、后门牌、骨架段和物理状态；已有空间的前门牌、后门牌、骨架段不可编辑，新增空间除外。
- [ ] 在详情栏选中空间后，可在同一上下文中维护空间资料和实验室资料，并由系统同步底层关系。
- [ ] 除教学楼和楼层骨架信息维护之外，详情栏日常编辑可替代物理空间、实验室、方案分配三张原始表的日常编辑；这三张原始表不再作为可见编辑入口。
- [ ] admin/editor 在可编辑且自己可管理的方案中可从详情栏内联编辑已有实验室、改建当前房间、新增房间，并可在“更多”面板中编辑或删除当前房间资料。
- [ ] 详情栏操作按钮位于详细信息卡片下方且独立于详情卡片滚动区；编辑实验室和改建房间表单显示当前房间门牌、楼栋楼层和空间编码，所属学院和所属专业使用下拉单选，专业按学院联动过滤。
- [ ] 详情栏“编辑房间”可维护门牌、骨架、所在侧、偏移、长宽、面积、网段和物理状态；修改门牌后空间编码引用同步迁移，已有房间长宽不可清空，长宽有效时面积按乘积计算。
- [ ] 详情栏“新增房间”可维护门牌、骨架、所在侧、偏移、长宽、面积、网段和物理状态；保存后创建未规划物理房间，不创建用途单元或分配；无可绑定走廊骨架或无法生成空间编码时阻止保存并提示。
- [ ] 详情栏“更多”点击后在按钮区原位展开操作面板，不通过详情滚动轮或浮层菜单查看；点击面板外或按 `Esc` 可关闭；合并房间和拆分房间入口在功能实现前保持禁用并标注暂未开放，删除房间入口可从当前方案视角删除空间并将相关分配标记为 `Invalid`，实验室资料保留。
- [ ] admin 通过数据编辑中的学院、专业和实验室类型原始表维护基础信息，顶部不再显示重复的“基础信息”独立弹窗入口；详情栏专业按学院联动过滤，停用项不出现在详情栏下拉候选中。
- [ ] admin 可在教学楼、楼层骨架、学院、专业、实验室类型原始表删除行；删除教学楼级联删除该楼骨架和空间，删除楼层骨架级联删除绑定空间，相关方案分配变为 `Invalid` 且实验室资料保留；非 admin 不显示删除入口，学院/专业/实验室类型被引用时在当前表格附近给出明确阻止提示。
- [ ] admin 修改楼层骨架的教学楼编码、楼层编码或走廊段编码时，绑定空间同步迁移，分配引用刷新；目标骨架键已存在时保存被阻止，不会把原骨架复制成另一楼层的重复数据。
- [ ] 数据编辑中的学院和专业信息只有 admin 可见可编辑；editor/viewer 不显示学院、专业原始表。
- [ ] 点击“规划”未规划空间时，所属学院使用下拉单选，并生成对应学院的“未规划实验室+门牌号”实验室和 `assigned` 分配。
- [ ] 详情栏实验室表单中的类型、学院、专业均为下拉单选；从未规划空间选择实验室后，具备权限的用户可立即编辑实验室资料。
- [ ] 落位实验室候选列表不显示已落位到其他空间的实验室，且不显示“已隐藏”数量提示；若保存时出现重复落位冲突，界面给出明确提示而不是无响应。
- [ ] 详情信息栏点击“搬迁实验室”后，目标空间使用全校未规划空间下拉，且只列出 `active`、无 `assigned` 占用的空间。
- [ ] 可编辑方案中可将多个已落位实验室拖入待安置区；拖入后系统立即保存为 `Invalid`、空 `space_code`、带 `previous_space_code`，来源空间立即显示为无归属未规划空间。
- [ ] 待安置区有条目时不触发未保存提示；切楼层、切方案和点击主图其他空间查看详情仍可正常进行。
- [ ] 详细信息栏底部不显示固定待安置 Dock；待安置区通过右侧检查器的“详细信息 / 待安置区”切换进入。
- [ ] 详细信息栏不显示“加入待安置区”按钮；已落位实验室进入待安置区通过拖入右侧栏完成。
- [ ] 待安置区提供“新增”入口，可新增计划新建但尚未确定场地的用途单元；名称必填，学院、座位数和电脑数可选，保存后作为已保存未落位条目显示。
- [ ] 待安置区不改变 workspace、主图、缩略图或详情栏高度；待安置实验室数量较多时只在右侧检查器内部滚动。
- [ ] 待安置区卡片使用学院颜色，展示实验室名称、学院、来源地点和座位数；长地点使用省略和悬停 title，不显示“已保存”标签。
- [ ] 拖动主图实验室进入详细信息栏任意位置时，右侧自动切换为待安置区，整个详细信息栏都可作为加入待安置区的投放目标。
- [ ] 右侧栏提供“详细信息 / 待安置区”手动切换；待安置区视图不遮挡主图和缩略图，列表只在右侧栏内部滚动。
- [ ] 同一楼层内，可将主图中已落位实验室直接拖到另一个当前方案下 `active` 且无 `assigned` 占用的未规划空间；成功后立即保存落位，来源空间显示为未规划。
- [ ] 反复将同一方案副本中的同一实验室拖入待安置区、归位、再拖入时，不会出现重复待安置卡片。
- [ ] 从待安置区拖到目标空间时，只允许投放到当前方案下 `active` 且无 `assigned` 占用的空间；原空间作为可归位目标单独高亮。
- [ ] 待安置区卡片提供“归位”，也可拖回原位；原空间可用且未被其他 `assigned` 分配占用时自动保存回原空间并移出待安置区，否则给出明确阻止提示。
- [ ] 从待安置区拖到目标未规划空间后立即保存落位，成功后条目从待安置区移除；仍未落位的实验室保持待安置条目，可继续拖到其他未规划空间。
- [ ] 主图房间 hover/focus 时显示轻量详情浮层；已落位空间显示实验室详情，未规划空间显示空间摘要；拖拽搬迁或画布平移时浮层不显示。
- [ ] admin 可删除任意非基线方案中安全可删的实验室，editor 只能删除自己创建且非基线方案中安全可删的实验室；基线方案、被其他空间占用或被其他方案引用的实验室不可删除。
- [ ] 保存详情栏编辑后，主图、详情和原始表格中的方案分配同步更新。
- [ ] 保存详情栏编辑或原始表格后，重新拉取服务端数据能读回刚保存的空间资料、实验室资料和落位安排；多个可见方案副本有同 ID 资料时，最新/刚保存的副本不被旧副本覆盖。
- [ ] 详情栏编辑实验室或房间资料后，保存目标必须是当前方案副本中的同一行；多个可见副本存在相同 `id` 或编码时，不会误改其他副本，也不会因保存过滤导致界面提示成功但刷新后丢失。
- [ ] 目标空间已有 assigned 分配时，普通保存被拦截；勾选替换后原分配自动变为 `Invalid`。
- [ ] 新增空间后可编辑门牌和骨架段；删除空间后该空间从当前非基线方案中移除，不再标记为不可用，且当前方案相关分配变为 `Invalid`。
- [ ] 某个副本删除空间后，其他副本或基线仍可新增同编号、同门牌空间；刷新后不会被该副本历史删除标记隐藏。
- [ ] admin 可删除任意非基线方案中的空间；editor 只能删除自己创建且非基线方案中的空间；基线方案空间不可删除。
- [ ] editor 只能在自己创建且非基线的方案中保存详情栏日常编辑；admin 可保存基线方案详情栏日常编辑。
- [ ] viewer/游客不可保存详情栏日常编辑。
- [ ] 新增教学楼、空间、楼层骨架和用途单元时按配置化编号规则生成编号；单门空间后门牌为空时使用前门牌生成后两位编号。
- [ ] 教学楼表包含 `sort_order` 字段，admin 可在数据编辑中维护；顶部教学楼检索按下沙校区、绍兴校区分组，再按校区内 `sort_order` 排列，并在选项中标注校区。
- [ ] admin 显式执行“补全/刷新编号”后才更新已有教学楼、楼层骨架或用途单元编号；刷新教学楼或楼层骨架编号时相关空间和分配引用同步迁移。
- [ ] 空间只能绑定到走廊骨架；楼梯、电梯和其他骨架不能作为空间落位骨架。
- [ ] `labs` 底层表可作为用途单元承载实验室、教室、办公室、公共空间等类型；旧 `LAB...` 编号兼容，新建用途单元使用 `UNIT...` 编号。
- [ ] 主图放大时，`.floorplan` 和 `.floorplan-stage` 不会在垂直方向无意义撑高；只有真实超出时出现滚动。
- [ ] 详情栏日常编辑和主要工作区不显示渐变背景，状态配色清晰区分已建设、已规划、未规划和不可用。
- [ ] `outputs/lab-info-import` 导入模板中，杭州口径按下沙校区处理；下沙校区同楼同层空间按门牌号从东到西逐渐变大；光大教学楼和金通教学楼没有源表不存在的空间或重复物理空间。
- [ ] `outputs/lab-info-import` 导入模板中，Sheet2 房间号只覆盖精确匹配的主表实训室；同楼同层不同前后门牌不得产生重复 `space_code`，修正后的 `labs` 和 `plan_assignments` 引用同步更新。
## Numbering Acceptance

- [ ] Admin can run explicit numbering normalization after upload; a snapshot is created before the write.
- [ ] Normalization preserves stable row `id` values and migrates building, floor segment, space, and plan assignment references instead of creating duplicate old/new rows.
- [ ] If a building code is normalized, bound floor segments and spaces use the normalized building code after refresh and save.
- [ ] Active plans and all non-deleted plan copies receive globally unique `PLAN000001` style codes with no Chinese text.
- [ ] Use types receive `USE0001` style codes with no Chinese text.
- [ ] Use types are displayed and saved as a reusable dictionary by `type_name`; repeated "实验室" or "教室" rows collapse to one active row each, and duplicate rows can be removed without being blocked by references to the remaining canonical row.
- [ ] Admin manage plans lists both active dataset plans and non-deleted plan copies, and rename/delete/baseline actions target the correct active plan code or copy id.
- [ ] Deleting plans is blocked when it would leave the system with no manageable plan.
- [ ] Reopening visible data after normalization does not show the stale pre-normalization building row from plan-copy payloads.
- [ ] Visible datasets compact duplicate physical spaces from active data and visible plan copies before reaching the frontend, and assignments that pointed at discarded stale space ids/codes are migrated to the retained visible row.
- [ ] Saving active data after viewing a merged copy dataset does not write copy-specific buildings, floor segments, spaces, labs, plans, or assignments into `active_dataset`.
- [ ] Admin manage plans lists every non-deleted plan copy even after its `plan_code` is normalized to `PLAN...`, and delete/rename/baseline actions still target the correct copy id.

## Hybrid Relational Storage Acceptance

- [ ] SQLite initialization creates the relational business tables for buildings, floor skeletons, colleges, majors, use types, spaces, use units, plans, plan overrides, assignments, and plan-scoped deleted spaces.
- [ ] Existing JSON plan-copy data is backfilled or synchronized into relational tables without duplicating the same `building_code` or same floor skeleton semantic key across visible plan copies.
- [ ] `/api/bootstrap` and `/api/dataset/active` continue returning the existing `dataset` JSON shape while projecting global shared reference rows from relational storage when available.
- [ ] `/api/bootstrap`, `/api/dataset/active`, and save responses can return a complete visible dataset from relation-only rows when legacy business JSON is empty.
- [ ] Relational projection preserves plan visibility rules: visitors see public/baseline plans, editor users also see their own private plans, and admin users see every non-deleted plan.
- [ ] Legacy JSON is synchronized into relational tables as fallback on read, but relation rows are the returned visible dataset authority after synchronization.
- [ ] 详情栏编辑实验室、改建房间、新增房间、编辑房间和删除房间通过动作级 API 保存，不从前端回传整包可见 dataset 覆盖保存。
- [ ] 详情栏 copy 方案写入优先更新 `plan_space_overrides`、`plan_lab_overrides`、`plan_assignments` 和 `plan_deleted_spaces`；新增 copy 房间不写入全局 `spaces` 基准表。
- [ ] 详情栏保存成功后由关系表投影刷新可见 dataset；保存失败或 revision 冲突时不更新关系表，也不更新 legacy JSON 快照。
- [ ] Admin viewing multiple plans sees each teaching building only once in the raw teaching-building table, even when several visible plan copies contain that building in legacy JSON payloads.
- [ ] Saving active raw maintenance data immediately updates relational global reference tables for buildings, floor skeletons, colleges, majors, and use types.
- [ ] Spaces, use units, assignments, and deleted-space tombstones remain plan-scoped so editing or deleting a room in one non-baseline copy does not affect other plans.
- [ ] When a copy save clears a deleted-space tombstone, `plan_deleted_spaces` removes the stale tombstone for that copy.

## Admin Correction Acceptance

- [ ] Existing spaces in detail editing show door/code summary fields and no longer show the old "refresh space code on save" checkbox.
- [ ] Admin can open an explicit door/code correction panel, edit `front_door` and `rear_door`, see a live `space_code` preview, and save the corrected code only through that action.
- [ ] When the correction panel leaves `rear_door` blank, the generated space code uses the final two digits from `front_door` for both door positions.
- [ ] Floor skeleton raw editing exposes clear controls for adding stairs and elevators, plus guidance that only corridors can bind spaces.
- [ ] Clicking add elevator creates an editable `floor_segments` row with `element_type = elevator` and an `EV...` segment code without saving until the admin applies changes.

## Thumbnail Scroll Acceptance

- [ ] Scroll the thumbnail list to the bottom, then click several spaces in the main floorplan; the thumbnail list keeps its scroll position and does not jump upward.
- [ ] Repeat the same thumbnail scroll check in compare mode; scroll positions stay stable unless the user changes building, floor, plan, or compare mode.

## Display Color and Structure Acceptance

- [ ] College rows include an editable `color` field, and admin raw editing shows that field as a color picker.
- [ ] Existing and imported college dictionaries with missing or repeated colors normalize to distinct `#RRGGBB` values.
- [ ] Main floorplan rooms and legend swatches use the admin-maintained college colors for assigned non-classroom spaces, while classroom spaces stay gray.
- [ ] Elevator floor skeletons render as box elevator car icons in main and thumbnail views, without escalator or directional-arrow artwork.
