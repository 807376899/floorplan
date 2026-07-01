# Codex Requirements

本文件记录当前任务中不可破坏的长期需求。每轮迭代开始前必须重新读取本文件，并据此校验实现方向。

## 迭代规则

- 每轮迭代前，必须读取 `codex-requirements.md`。
- 每轮迭代结束后，必须读取 `acceptance-checklist.md` 并按清单检查。
- 不得在未确认符合本文档要求的情况下，删除、弱化或绕过下列权限、界面和交互约束。

## 本地运行

- 本机直接运行 `npm start` 或 `node server.js` 时，默认端口必须避开 Windows 常见保留端口范围，当前默认使用 `3000`；需要使用其他端口时通过 `PORT` 环境变量显式指定。
- 服务端监听失败时，`EACCES` 和 `EADDRINUSE` 必须输出可执行的端口切换提示，不应只抛出 Node 原始堆栈。

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
- 方案选择、教学楼选择、单方案/对比模式切换、新增方案、公开/私有副本和删除方案应集中在缩略图栏顶部；教学楼下拉框与方案模式同一行，教学楼在左、方案模式在右。
- 新增方案、公开方案和删除方案必须保持为独立按钮，并与“缩略图”标题同一行显示完整按钮文案；缩略图栏不显示“模式”文字标签或“左右方案由各列下拉框控制”提示。
- 每个缩略图列顶部使用对应方案下拉框代替方案信息标签；两个方案下拉框不得相互叠压，方案名称必须完整可读，不得用省略号截断。
- 方案下拉框中，基线方案必须标注“基线”且不显示副本编号；非基线副本在完整名称后显示短编号，公开副本显示为“公开 + 副本编号”（如“公开1”），私有副本只显示副本编号（如“1”），不得显示“公开副本”标签。
- 公开副本在普通方案下拉中保持匿名展示，不显示创建者；自己创建的副本仍标注“我的”，让创建者能区分自己的重名方案和他人可见方案。
- editor/admin 创建方案副本时可自行选择是否公开；公开副本可匿名被其他用户查看。不同用户可创建完全相同名称的方案副本，系统不得进行方案名唯一性校验或自动改名。
- 主界面不得显示楼层下拉框；楼层切换由缩略图承担。
- 主界面不得显示学院高亮下拉框；学院高亮由图例项控制，默认所有学院高亮，点击某学院图例项后该学院在主图和缩略图中同步弱化，并提供圆形多色总开关在正常显示和弱化显示之间切换；总开关 hover 文案分别提示“正常显示”或“弱化显示”。
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
- 当空间没有当前方案下 `assigned` 实验室时，详细信息栏必须显示“未规划”卡片而不是空白；日常规划、实验室资料和空间资料维护逐步由详细信息栏承接，底部数据编辑区不再提供“业务编辑”页面。
- 已有实验室的详细信息栏不得展示“分配状态”和“生效时间”；admin 或 editor 在可编辑且自己可管理的方案中可从详细信息栏内联执行“编辑实验室”和“改建房间”。改建房间保存后，原实验室与空间解绑，原分配标记为 `Invalid`，并为该空间创建和绑定新的用途单元；新用途单元默认名称为“待改建房间”，改建年月写入当前方案分配的 `effective_from`。
- 未选中房间时，详细信息栏只向有当前方案编辑权限的 admin/editor 显示“新增房间”入口；不得显示编辑实验室、改建房间或更多菜单。

## 主图显示与缩放

- 主图默认适配显示大小。
- 主图默认显示在中央。
- 主图不显示独立虚线边框；放大后只保留背景网格、滚动条和鼠标拖动画布能力，避免缩放内容与装饰边界割裂。
- 主图和缩略图中，当当前方案落位的用途类型为 `教室` 时，该空间必须显示为灰色；其他已落位空间继续按所属学院显示不同颜色，未规划空间保持未规划灰色。
- 主图中的教学楼信息不应随着缩放一起变化。
- 主图中的北边指示不应随着缩放一起变化。
- 主图中的教学楼信息和北边指示必须固定浮在主图可视区域上，不得随着主图内部滚动条滚动而移动。
- 主图放大到需要滚动查看时，必须支持按住主图空白区域拖动画面平移；滚动条仍保留为辅助方式，房间搬迁拖拽不得误触发画布平移。
- 宽屏下当 workspace 中缩略图栏、主图栏、详细信息栏并列时，workspace 高度必须按视口固定，不得因为楼层或缩略图数量变多而变高；多出的楼层/缩略图内容必须在对应内部区域使用滚动条查看。
- 中屏下 workspace 必须显示为两行：缩略图区独占第一行，主图和详细信息栏在第二行并列且高度对齐。
- 窄屏下当 workspace 改为堆叠布局时，workspace 高度必须由缩略图区域高度、主图区域高度和详细信息区域高度自然相加，主图不得被裁切或隐藏。
- 中屏或窄屏下当缩略图区位于 workspace 顶部时，每组缩略图中的 compare-title 必须位于左侧、floor-thumbs 位于右侧，二者横向并列且高度一致；每栋楼的缩略图只能占一行，楼层缩略图数量变多时，compare-title 与 floor-thumbs 必须通过同一个横向滚动条一起滚动，不得换行、固定高度裁切或纵向滚轮隐藏。
- 单个楼层缩略图必须完整适配在预览框内，不得在缩略图内部出现鼠标滚轮或内部滚动条；需要滚动时只能由缩略图列表容器承担。
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
- admin 可在“管理方案”中重命名、删除方案、将方案设为基线，也可取消基线设置；可以存在多个基线。
- 方案被设为基线后，除 admin 外任何用户都不可修改、删除或切换公开/私有状态。
- 单方案模式默认展示最新设为基线的方案。

## 2026-06-09 高级编辑易用性

- 高级数据编辑区不再提供“业务编辑”入口；默认进入第一个可见原始维护表，工具栏只对当前原始维护表执行“新增行 / 应用修改 / 导出当前表”。
- 物理空间、实验室资料和方案分配的日常编辑应优先由详细信息栏和主图/待安置区交互承接，不要求业务用户手动编辑 `spaces`、`labs`、`plan_assignments` 三张底层表。
- 主图搬迁和新建待定场地交互应统一使用“待安置区”：可编辑方案中，用户可将已落位实验室拖入待安置区，系统立即保存为 `Invalid`、空 `space_code`，并记录 `previous_space_code`，来源空间显示为无归属未规划空间。
- 待安置区只表示当前方案中已保存但未落位的实验室队列，不参与未保存变更拦截；有内容时仍可切楼层、切方案、点击其他空间查看详情。
- 详细信息栏底部不得显示固定待安置 Dock；待安置区通过右侧检查器的“详细信息 / 待安置区”切换进入。
- 详细信息栏不得提供“加入待安置区”按钮；已落位实验室进入待安置区只能通过拖入右侧栏完成，避免和直接拖放逻辑形成重复入口。
- 待安置区必须提供“新增”入口，可新增计划新建但尚未确定场地的用途单元；新增时名称必填，学院、座位数和电脑数可选，保存后以已保存未落位条目进入待安置区。
- 待安置区条目必须提供“归位”操作，也支持拖回原空间：自动保存回 `previous_space_code` 对应原空间并从待安置区移除；若原空间不可用或已被其他 `assigned` 分配占用，必须阻止归位并给出明确提示。
- 从待安置区拖到目标未规划空间时必须立即保存为 `assigned` 到目标空间，保存成功后该条目从待安置区移除；尚未落位的实验室必须继续作为待安置条目保留或自动重建。
- 待安置区不得撑高 workspace、主图、缩略图或详情栏；待安置实验室数量增加时只在右侧检查器内部滚动。
- 待安置区中的实验室卡片必须使用所属学院颜色，展示实验室名称、学院、来源空间和座位数；从待安置区拖到目标空间时，只允许落位到当前方案下 `active` 且无 `assigned` 占用的空间，原空间作为可归位目标单独高亮。
- 当用户拖动主图中的实验室时，整个详细信息栏都必须作为待安置区投放目标；拖动进入详细信息栏时，右侧检查器自动切换为待安置区视图。
- 详细信息栏必须提供“详细信息 / 待安置区”手动切换；切到待安置区后不应遮挡主图或缩略图，待安置列表在右侧栏内部滚动。
- 同一楼层内，用户可将主图中已落位实验室直接拖到另一个当前方案下 `active` 且无 `assigned` 占用的未规划空间；系统即时保存落位，来源空间显示为未规划，跨楼层/跨楼栋仍通过待安置区完成。
- 待安置区条目去重必须使用当前方案和用途单元的稳定身份，不得仅依赖可能随副本保存或编号规范化变化的 `plan_assignments.id`。
- 主图房间 hover 或键盘 focus 时必须显示轻量实验室详情浮层；已落位空间显示实验室、学院、专业、负责人、座位、电脑、门牌和面积，未规划空间显示未规划、门牌、面积和网段；拖拽搬迁或画布平移时不显示该浮层。
- 方案分配状态只使用 `assigned` 和 `Invalid`：`assigned` 表示实验室在当前方案中占用空间；`Invalid` 表示该实验室在当前方案中的分配已失效或过期。
- 物理空间业务状态由当前方案推导：`assigned` 且生效时间不为空为“已建设”；`assigned` 且生效时间为空为“已规划”；无有效分配或分配为 `Invalid` 为“未规划”；人工设置 `spaces.current_status = unavailable` 时为“不可用”且优先显示。
- 旧数据中的 `pending_move` 必须兼容为 `assigned`，`unplaced` 必须兼容为 `Invalid`。
- 实验室信息不再维护“建设时间”字段；业务逻辑中以方案分配的生效日期判断已规划/已建设状态。
- 详情栏不得提供实验室备注入口；保存实验室资料时不得依赖该隐藏字段，也不得因字段缺失清空历史实验室备注。
- 详情栏日常编辑必须围绕当前楼栋、当前楼层、当前空间组织，不得要求业务用户像数据库管理员一样分别维护多个底层表并手动寻找编码关系。
- 数据编辑栏必须清晰区分“切换视图”和“当前视图操作”：教学楼、楼层骨架、学院、专业、用途类型、方案等入口属于视图切换；新增行、应用修改、导出当前表等按钮属于当前视图操作。
- admin 或 editor 在可编辑且自己可管理的方案中可在详情信息栏内联编辑已有实验室资料、改建当前房间、新增房间，以及通过“更多”操作面板编辑或删除当前空间资料。详情栏按钮必须位于详细信息卡片下方但独立于详情卡片滚动区；点击“更多”后，操作内容必须在按钮区原位展开，不得通过详情滚动轮或浮层菜单查看；点击 `.detail-more-wrap` 外任意位置或按 `Esc` 必须关闭该面板。详情栏编辑房间和新增房间可维护门牌、骨架、所在侧、偏移、长宽、面积、网段和物理状态；门牌修改必须预览并迁移空间编码引用，已有房间长宽不得被清空，长宽有效时面积按长宽乘积计算。“更多”操作面板中的合并房间和拆分房间入口在功能实现前必须保持禁用并标注暂未开放；“删除房间”从当前方案视角删除物理房间并将当前方案相关分配标记为 `Invalid`，不得删除实验室资料。
- 详情栏“编辑实验室”和“改建房间”表单必须显示当前房间门牌、楼栋楼层和空间编码，避免误编辑；所属学院和所属专业必须使用下拉单选，专业按已选学院联动过滤，并保留历史专业值避免打开表单后被清空。详情栏编辑保存成功后才关闭表单；保存失败时必须回滚数据、保留表单和用户已填内容并显示错误。详情栏“新增房间”只创建未规划物理房间，不同步创建用途单元或方案分配；没有可绑定走廊骨架或无法生成空间编码时必须阻止保存并提示。
- 详情栏实验室表单中的实验室类型、所属学院、所属专业必须使用下拉单选；所属专业按已选学院联动过滤。admin 必须通过数据编辑中的学院、专业和实验室类型原始表维护基础信息，顶部不再提供重复的“基础信息”独立弹窗入口，editor/viewer 只能使用已启用的基础信息选项。
- 数据编辑中的学院和专业信息仅 admin 可见、可编辑；editor/viewer 不显示学院和专业原始表。
- 点击“规划”未规划空间时，所属学院必须使用下拉单选，不得再使用自由文本提示框；学院选项来自 admin 维护的基础信息。
- 落位实验室候选只应显示当前方案中未落位的实验室，以及当前空间已落位的实验室；已落位到其他空间的实验室不得作为可选项出现，也不显示“已隐藏”数量提示。若保存时检测到实验室已被其他空间占用，必须给出明确提示，不得无响应。
- 详情信息栏点击“搬迁实验室”后，目标空间必须使用下拉单选；候选为当前方案下全校范围内 `active` 且无 `assigned` 实验室的未规划空间，标签显示楼栋、楼层、门牌、空间编码和面积。
- 从未规划空间选择实验室后，若当前用户有实验室资料编辑权限，实验室名称、类型、学院、专业、负责人、座位数和电脑数必须立即可编辑；负责人字段宽度与专业字段一致。
- 详情栏后续必须支持安全删除实验室：admin 可删除任意非基线方案中未被其他空间或其他方案引用的实验室，editor 可删除自己创建且非基线方案中满足同样安全条件的实验室；删除时同步移除当前方案中的相关落位关系，基线方案和被其他方案引用的实验室不得删除。
- 当存在多个可见方案副本且副本中包含同 ID 的楼栋、楼层骨架、空间或实验室资料时，服务端返回给前端的可见数据必须保证最新/刚保存的副本资料优先显示，不能让旧副本覆盖刚保存的详情栏编辑结果。
- 保存详情栏编辑或原始表格后，重新拉取服务端数据必须能读回刚才保存的空间资料、实验室资料和落位安排；不得出现接口已写入但界面被其他副本同 ID 数据覆盖而看起来无法保存的情况。
- 详情栏保存实验室或空间资料时，必须优先按当前方案副本的 `copy_id` 定位目标行；多个可见副本存在相同 `id` 或业务编码时，不得更新到其他副本的同名行，也不得让服务端保存过滤掉本次修改后仍提示成功。
- 详情栏必须支持新增房间和删除房间；删除房间在当前非基线方案中移除空间数据，并将当前方案中该空间相关分配标记为 `Invalid`，不得仅标记为不可用。admin 可删除任意非基线方案中的空间，editor 只能删除自己创建且非基线方案中的空间。
- 方案副本删除空间产生的删除标记必须带方案作用域；某个副本的历史删除标记不得隐藏其他副本或基线中新建的同编号、同门牌空间。旧副本 payload 中无作用域的删除标记在服务端读取和再次保存时必须按所属副本解释。
- 原始表格能力仅保留为高级结构和字典维护入口；`spaces`、`labs`、`plan_assignments` 原始表不再作为可见编辑入口，详情栏日常编辑必须替代这些单表编辑。详情信息栏不再显示“编辑此空间”“编辑此实验室”“查看当前分配”等旧原始表跳转按钮。
- admin 可在教学楼、楼层骨架、学院、专业、实验室类型原始表中删除行；删除教学楼必须级联删除该楼的楼层骨架和空间，删除楼层骨架必须级联删除绑定到该骨架的空间，相关方案分配必须标记为 `Invalid` 且保留实验室资料；被实验室或专业引用的学院、专业和实验室类型仍必须阻止删除，并在当前表格附近明确提示原因，非 admin 不显示删除入口。
- admin 在楼层骨架原始表中修改教学楼编码、楼层编码或走廊段编码时，系统必须按原始骨架身份同步迁移绑定空间，并更新分配引用；若目标骨架键已存在，必须阻止保存并提示冲突，不得把原骨架复制成另一楼层的重复数据。
- 编辑权限仍必须遵守方案权限：editor 只能编辑自己创建且非基线的方案；admin 可编辑基线方案；viewer/游客只读。
- 前端界面应采用清晰的业务工具风格，详情栏日常编辑和主要工作区不得使用渐变背景，状态颜色必须明确区分已建设、已规划、未规划、不可用。
- 数据自动编号必须集中配置并可复用：默认校区编码为下沙校区 `01`、绍兴校区 `02`；教学楼编号为 `B` + 校区码 + 两位楼号；空间编号为 `0` + 校区码 + 两位楼号 + 两位楼层 + 前门牌两位 + 后门牌两位；单门空间后门牌为空时后门牌编号必须等于前门牌编号；楼层骨架编号使用 `EW/NS/ST/EV/OT` + 校区码 + 两位楼号 + 两位楼层 + 两位序号；新增用途单元编号使用 `UNIT` + 六位流水。
- 教学楼数据必须支持 `sort_order` 排列顺序字段，admin 可在数据编辑中的教学楼表维护；顶部教学楼检索先按下沙校区、绍兴校区分组，再按校区内 `sort_order` 排列，并在选项中标注校区。
- 新增记录可自动生成编号；已有记录不得因字段变化静默改号，必须由 admin 显式执行补全/刷新编号后才更新，并同步相关空间、骨架和方案分配引用；导入数据已有编号时默认保留。
- 现有 `labs` 表短期继续作为底层表名和关系字段来源，但业务含义扩展为“用途单元”，可承载实验室、教室、办公室、公共空间等用途；旧 `LAB...` 编号继续兼容，新建用途单元使用 `UNIT...` 编号。
- `outputs/lab-info-import` 导入模板生成时，杭州口径等同下沙校区；下沙校区空间必须按门牌号从东到西逐渐变大生成排列位置；同一教学楼、楼层、前后门牌完全相同的源表记录只生成一个物理空间，额外用途单元保留但不得生成重复房间；Sheet2 仅补充已匹配实训室信息，不得单独生成源表不存在的空间。
- `outputs/lab-info-import` 中 Sheet2 的房间号和实训室编号只能在实训室名称等关键信息精确匹配时覆盖主表生成值；若主表中同楼同层不同前后门牌生成了相同编码，未精确匹配 Sheet2 的记录必须使用完整门牌生成唯一空间编码，并同步更新用途单元和方案分配。
## Numbering and Stable Identity

- Business codes are editable identifiers and must not be used as the only durable row identity. Existing `id` values for buildings, floor segments, spaces, labs, lab types, and plans must be preserved when codes are filled or refreshed.
- Admin post-upload numbering normalization must be supported. It must create a snapshot before writing, normalize the active dataset and all non-deleted plan copies together, and migrate references instead of creating duplicate old/new rows.
- The active dataset save path must defensively strip plan-copy payload rows before persisting. Visible datasets may merge copy-specific buildings, floor segments, spaces, labs, plans, and assignments for display, but those rows must never be written back into `active_dataset`.
- Visible datasets must compact duplicate structural rows by semantic identity before returning to the frontend. Spaces with the same building, floor, and physical door range, including stale single-door rows whose rear door equals the front door, must display once, and assignments that referenced the discarded space id/code must be migrated to the retained visible row.
- Plan-copy identity must be carried by an explicit copy id (`copy_id`/`copyId`) instead of being inferred only from `plan_code`; plan codes may be normalized to `PLAN...` while the copy remains manageable by admin.
- Building code normalization uses `B` + campus code + two-digit building number, for example `B0109`.
- Plan codes must not contain Chinese text after explicit numbering normalization. Normalized plan codes use global sequential `PLAN000001`, `PLAN000002`, and so on across the active dataset and plan copies.
- Use type codes must not contain Chinese text after explicit numbering normalization. Normalized use type codes use sequential `USE0001`, `USE0002`, and so on.
- Use types are reusable dictionary entries keyed by normalized `type_name`; duplicate rows such as repeated "实验室" or "教室" must be merged instead of treated as separate business entities. The default dictionary keeps `USE0001` for "实验室" and `USE0002` for "教室".
- Admin plan management must include both active dataset plans and non-deleted plan copies. Admin can rename, delete, and baseline either kind through the manage plans UI, while the server must keep at least one manageable plan available.
- When building codes change, all bound floor segment and space `building_code` references must be migrated. Saving after normalization must not leave the old building row visible through stale plan-copy data.

## Hybrid Relational Storage

- Core business entities must gradually move to relational tables. `buildings`, `floor_segments`, `colleges`, `majors`, `lab_types`, `spaces`, `labs`, `plans`, `plan_space_overrides`, `plan_lab_overrides`, `plan_assignments`, and `plan_deleted_spaces` are the target source-of-truth tables; JSON remains for import drafts, snapshots, compatibility export, projection, and rollback.
- The frontend API may continue returning the existing `dataset` JSON shape, but service code must project that shape from relational/global data where available instead of treating every plan-copy JSON payload as a separate authoritative copy of all reference rows.
- `/api/bootstrap`, `/api/dataset/active`, and save responses that send a visible dataset must read through the relational projection path once relational rows are available. Legacy `active_dataset.dataset_json` and `plan_copies.dataset_json` may be synchronized into relational tables as fallback for old deployments, but must not remain the read-interface authority after synchronization.
- Relational projection must enforce the same plan visibility rules as the old visible dataset builder: visitors see public and baseline plans, editor users also see their own private non-deleted plans, and admin users see all non-deleted plans.
- Relation-only data must be sufficient to render the existing frontend dataset shape, including buildings, floor skeletons, spaces, use units, dictionaries, plans, assignments, and plan-scoped deleted-space tombstones, even when legacy business JSON is empty.
- 详情栏日常编辑必须使用动作级写接口而不是从前端回传整包可见 dataset 覆盖保存。`editLab`、`renovateRoom`、`createSpace`、`editSpace` 和 `deleteSpace` 在服务端优先写关系表，成功后通过关系表投影返回可见 dataset。
- 详情栏写入 copy 方案时，新建或修改的空间与用途单元必须写入当前方案的 override 表；新建 copy 房间不得写入全局 `spaces` 基准表。删除房间必须写入当前方案 tombstone 并只使当前方案相关分配变为 `Invalid`。
- 详情栏动作保存成功后可同步 legacy JSON 快照用于兼容、导出或回滚；保存失败或 revision 冲突时不得更新关系表或 legacy JSON 快照。
- 主图规划未规划空间、加入待安置区、待安置区归位、待安置区落位、同层直接搬迁和新增待安置用途单元必须使用动作级分配写接口。`planSpace`、`moveToBasket`、`returnFromBasket`、`placeBasketItem`、`directMove` 和 `createUnplacedUnit` 在服务端优先写 `plan_assignments` 与当前方案用途单元 override，成功后通过关系表投影刷新前端；不得通过前端回传整包可见 dataset 或批量 assignment 覆盖来作为这些交互的权威保存路径。
- 分配动作写入 copy 方案时，新建待安置用途单元必须写入当前方案的 `plan_lab_overrides`，不得写入全局 `labs` 基准表；搬迁、归位和待安置状态只影响当前方案的 `plan_assignments`，不得污染其他副本或基线。
- 高级原始维护表中的 `buildings`、`floor_segments`、`colleges`、`majors` 和 `lab_types` 必须通过动作级 raw-maintenance API 保存。服务端应先写关系表并通过关系表投影返回可见 dataset；前端不得把整包可见 dataset 当作这些全局基础表的权威保存载荷。
- 高级原始维护表删除教学楼或楼层骨架时，服务端必须在关系表事务中级联删除相关骨架或空间，并将受影响方案分配标记为 `Invalid`；删除学院、专业或用途类型时，若仍被实验室、专业或用途单元引用，必须阻止保存且不得更新 legacy JSON 快照。
- Teaching buildings, floor skeletons, colleges, majors, and use types are global shared reference data. They must not be duplicated per plan copy in the visible raw editor; admin seeing multiple visible plans must still see one row for the same `building_code` and one row for the same floor skeleton semantic key.
- Saving the active dataset from raw global maintenance must immediately synchronize `buildings`, `floor_segments`, `colleges`, `majors`, and `lab_types` into relational tables; the system must not wait for a later read path to backfill those rows.
- Plan copies only express differences for spaces, use units, assignments, and deletion tombstones. Deleting a room in one plan copy must record plan-scoped deletion metadata and must not delete the global physical-space baseline or hide the same room in other plans.
- Plan-scoped deleted-space rows must mirror the current saved copy payload. When a detail action or create-room flow clears a copy tombstone, `plan_deleted_spaces` for that plan must remove the stale tombstone instead of preserving an old hide rule.
- Relational schema and service logic must remain SQLite-compatible for current local deployment while avoiding SQLite-only JSON-query business logic so the schema can later move to PostgreSQL.

## Admin Correction Usability

- Detail editing must not expose a generic "refresh space code on save" checkbox for existing spaces. Existing spaces should show stable door/code summary fields by default, with an admin-only explicit correction action when door text was entered incorrectly.
- Admin door/code correction must allow editing `front_door` and `rear_door`, preview the resulting `space_code`, and refresh the space code only when the correction panel is active. If `rear_door` is blank, the generated code must reuse the last two digits from `front_door`.
- Floor skeleton editing must provide clear creation controls for corridor-adjacent structural elements. Stairs and elevators need dedicated add buttons or equivalent guidance so a new admin can create them without knowing raw `element_type` values.
- Newly added stairs and elevators must use the configured segment code prefixes (`ST` and `EV`) and remain non-assignable skeleton elements.

## Thumbnail Scroll Stability

- Selecting a space or lab in the main floorplan may update the main-map selection state and details panel, but must not rebuild an unchanged thumbnail list.
- Re-rendering the app after a main-map room selection must preserve the `.compare-columns` scroll position so the thumbnail list does not jump upward, including when the user has scrolled to the bottom.

## Display Colors and Structure Icons

- College dictionary rows carry an editable `color` value in `#RRGGBB` format. Missing or duplicate college colors must be initialized to distinct colors during dataset normalization.
- The same college semantic identity (`college_code` first, otherwise `college_name`) must use one canonical color across visitor/editor/admin, visible plans, and copy-scoped dictionary rows. Different colleges must keep distinct colors.
- Room fills and legend swatches must use the admin-maintained college color mapping for assigned non-classroom spaces. Classroom spaces remain gray even when assigned to a college.
- Admin raw data editing must expose the college `color` field as a visual color picker in the colleges table.
- Elevator floor skeletons (`floor_segments.element_type = elevator`) must render as box elevator car icons, not escalator or directional-arrow icons, in the main floorplan and thumbnails.
