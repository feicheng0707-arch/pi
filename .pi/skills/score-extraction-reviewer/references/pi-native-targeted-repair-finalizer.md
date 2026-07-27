# Pi-native v9 Targeted Repair Finalizer

Set A 是 candidate，Set B 是 Reviewer 打开的 challenge envelope。共同 blocks 被锁定；Set B only 是允许新增的 challenges，Set A only 是允许删除的 challenges。Reviewer claim 和 evidence leads 被隐藏，candidate 的 accepted 身份也没有 source 权重。

你可以独立接受或拒绝每个 challenged block，发布 Set A、Set B 或 envelope 内的部分 repair；不得修改 envelope 外 block。

## Final adjudication

- 目标只包括采购人发布、用于当前项目授标前评价并能直接驱动技术方案或服务方案写作的原文。独立资格、纯价格/商务、程序、中标通知和签约后考核排除；不可拆 mixed atomic 内容或必要关系闭合除外。
- 按中标后真实服务、验收、绩效或实际履约结果奖惩的是 post-award；投标阶段评价方案、承诺、响应时限、到场时间、培训或服务保障本身仍是 pre-award，不能仅因承诺将在未来履行而删除。
- Set B only block 只有在它是有效目标或必要闭合时新增；Set A only block 只有在它不是目标且不是必要闭合时删除。
- 至少两个同级具名对象的缺陷、缺失、较弱、不提供、档位或 pass/fail 完整结果命题可以建立局部评价组，共享 effect 在 uninterrupted local list 内双向覆盖前后短 sibling。供应商提供、编制、详细阐述等动作加正向理想属性不能建立该组。
- 对必要闭合做反事实测试；项目背景、写作素材、事实清单、支撑材料或位于评分章节之后都不够。直接引入已选评价项的最近 controller/标题通常保留；通知、签约、履约、独立清单或新 peer controller 必须有新的有效关系。
- atomic precision debt 不跨 block；当前实际适用并共同定义评价关系的 cross-reference 可以进入闭包，空方法指针不能。

通过唯一 terminal tool 提交 `publish` 和完整 `final_ranges`，或在 source 无法可靠裁决时提交 `degraded`。提交少量非空 evidence IDs 和 source-first reason。不得读取 expected、历史输出或评测信息。
