# AI 食材菜单规划器（MVP）

一个基于 AI 的“食材 -> 一周菜单规划”应用。  
通过识别用户已有食材，自动生成每日两餐的合理菜单，减少浪费、降低决策成本。

## 一、产品定位

- 目标：让用户快速从“我有什么食材”到“接下来吃什么”。
- 核心价值：
- 减少决策成本
- 减少食材浪费
- 提高做饭效率

## 二、核心用户场景

### 场景 1：刚买完菜

- 用户拍购物清单 / 超市小票，或手动输入食材
- 系统自动生成未来 2~5 天菜单

### 场景 2：打开冰箱不知道吃什么

- 用户拍一张冰箱照片
- 系统识别食材并生成菜单

### 场景 3：随手拍一道菜

- 用户拍现成菜
- 系统推测食材并纳入菜单规划

## 三、核心功能模块

### 1. 食材输入模块（Input）

支持三种方式：

- 购物清单识别（图片：小票/清单）
- 食材图片识别（冰箱/食材照片）
- 手动输入（自然语言解析）

输出统一为食材结构数组。

### 2. 食材标准化模块

功能：

- 同义词统一（如：番茄 -> 西红柿）
- 去噪（去掉“特价”“有机”等修饰）
- 过滤低置信度识别结果

统一结构：

```ts
interface Ingredient {
  name: string;
  quantity: number | null;
}
```

### 3. 菜谱生成模块（AI）

输入当前食材列表，输出候选菜列表（建议 20~30 个）：

```ts
interface Recipe {
  name: string;
  type: "dish" | "noodle";
  ingredients?: string[];
}
```

### 4. 菜单规划模块（Planner，核心）

输入：

- 食材列表
- 候选菜列表
- 目标天数（2~5）

输出：

```ts
interface DayPlan {
  day: number;
  lunch: {
    staple: "rice" | "noodle";
    dishes: string[];
    noodle?: string;
  };
  dinner: {
    staple: "rice";
    dishes: string[];
  };
}
```

### 5. 用户交互模块（关键 UX）

- 食材确认：删除误识别、修改名称
- 菜单调整：替换某道菜、重新生成

## 四、菜单规划规则（当前 v1）

### 1) 每天午餐与晚餐配置

- 午餐：
- `70%` 概率为 `1 个 rice + 2 个 dish`
- `30%` 概率为 `1 个 noodle`
- 晚餐：
- 固定 `1 个 rice + 2 个 dish`
- rice和noodle为主食, 不需要提供, 默认无限量

### 2) 菜品不足时的处理

- 当菜品不足以支撑目标 2~5 天时，不做占位补齐。
- 按实际可供给能力返回可生成的天数（可能少于请求天数）。

### 3) 优化目标

- 优先使用已有食材
- 菜品不重复
- 食材使用尽量均匀（不一天用光）

## 五、系统架构

前端（Web / 小程序）  
-> API（Vercel）  
-> AI（Doubao / 火山方舟）  
-> Planner（本地逻辑）  
-> 数据库（Postgres）

当前 API 规划：

- `POST /recognize`：图片（小票/食材图）-> 食材（调用 Doubao，并与现有食材合并）
- `POST /recipes/generate`：食材 -> 候选菜（调用 Doubao）
- `POST /plan`：食材 + 候选菜 -> 多天菜单
- `GET/POST /state`：读写本地状态文件（食材、候选菜、菜单）
- `POST /plan/replace`：替换某道菜并局部重排（后续）

## 环境变量

- `ARK_API_KEY`：火山方舟 API Key（用于 `/api/recognize`）
- `DOUBAO_MODEL`：Doubao 模型/推理接入点 ID（默认可用于 `/api/recognize` 与 `/api/recipes/generate`）
- `DOUBAO_CHAT_MODEL`：可选，专用于 `/api/recipes/generate`，未设置时回退 `DOUBAO_MODEL`
- `ARK_BASE_URL`：可选，默认 `https://ark.cn-beijing.volces.com/api/v3`
- `RECIPE_TIMEOUT_MS`：可选，候选菜生成接口超时（毫秒），默认 `12000`
- `STATE_FILE_PATH`：可选，本地状态文件路径，默认 `/tmp/menu-planner-state.json`

## 本地状态持久化

- 页面会在打开时自动读取 `/api/state` 并展示已保存的食材、候选菜、菜单。
- 食材编辑、候选菜增删、菜单生成后会自动保存到状态文件。

## 候选菜白名单

- 已内置 100 道家常菜白名单：`/src/recipeWhitelist.ts`
- `/api/recipes/generate` 会对模型输出做白名单过滤，只保留白名单菜名。

## 六、数据结构设计

```ts
interface Ingredient {
  name: string;
  quantity: number | null;
}

interface Recipe {
  name: string;
  type: "dish" | "noodle";
  ingredients?: string[];
}

interface PlanResult {
  plan: DayPlan[];
}
```

## 七、MVP 范围（第一版必须做）

### 必做

- 图片识别食材（先做 1 种输入方式）
- 手动编辑食材
- AI 生成候选菜
- 规则版 Planner
- ~~输出 2~3 天菜单（若菜不足则按实际返回）~~

### 暂不做

- 营养计算
- 精确重量计算
- 复杂算法优化
- 个性化推荐

## 八、迭代路线

### V2（产品可用）

- 库存系统（关键）
- 食材数量跟踪
- 每道菜消耗食材
- 避免超用

### V3（体验提升）

- 菜品不重复优化
- 食材优先级（快坏先用）
- 用户偏好学习

### V4（差异化）

- 自动生成购物清单
- 成本优化（便宜优先）
- 外卖 vs 做饭对比

## 九、关键难点与解决方案

### 1) 图像识别不准确

- 用户确认机制
- 置信度过滤

### 2) AI 输出不稳定

- JSON Schema / zod 校验
- fallback 策略

### 3) Planner 过于简单

- 后续引入库存系统 + scoring

## 十、产品壁垒

本产品的核心壁垒不是 AI 本身，而是“约束下的食材分配算法（planner）”，包括：

- 食材分配
- 菜单优化
- 用户习惯建模
