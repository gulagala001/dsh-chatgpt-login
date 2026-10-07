# DSH ChatGPT Login

> **已停止维护。请改用 [V1ki/dsh-plugin-subscriptions](https://github.com/V1ki/dsh-plugin-subscriptions)。**
> 登录、模型发现及 Fast 等功能已有社区实现，本项目退役以避免重复维护。下文仅保留旧版本说明。

**登录 ChatGPT，渠道和全部可用模型自动出现。**

独立 DSH 小插件，适用于原生 DSH Web、Desktop、TUI 和装有 OMD 的 DSH。

## 安装

```sh
dsh plugin --profile web add https://github.com/gulagala001/dsh-chatgpt-login/releases/download/v0.2.0/dsh-chatgpt-login-0.2.0.tgz
```

TUI 将 `web` 改为 `tui`。桌面版在「插件 → 安装插件」中输入同一发行包地址。安装后重启 DSH。

## 使用

打开 **设置 → 模型**，滚动到模型列表底部的 **ChatGPT** 卡片，点击 **登录 ChatGPT**，在浏览器完成授权。已登录时显示账号模型数量和「退出登录」。

登录后自动添加 ChatGPT 渠道，并读取账号的完整可用模型目录。模型选择使用 DSH 原生选择器。退出登录会清除 DSH 登录记录和该渠道。

Web / Desktop 的模型选择器旁有小闪电：选用 ChatGPT 渠道时点击点亮即开启 Fast，再点熄灭关闭。设置按会话保存，互不影响，下一次请求生效；其他渠道完全隐藏小闪电。Pro 和思考强度独立于 Fast。兼容 OMD 的模型面板。

上下文优先读取目录中的最大可用窗口，例如 GPT‑6.1‑Sol 为 872k；无最大值时回退到基础窗口。

TUI 使用 `/chatgpt login`；远程环境可用 `/chatgpt login device_code`。`/chatgpt status` 查看状态，`/chatgpt logout` 退出。浏览器未自动返回时可用 `/chatgpt answer <授权码或回调地址>`；敏感命令输入不记录到会话事件。

## 说明

复用 DSH 的原生 OAuth、令牌刷新和模型适配器。无需 API Key。凭据保存在宿主凭据服务，令牌不返回前端、不写日志。账号实际模型权限与额度由 OpenAI 决定。

已验证的版本见 [兼容性与验证](docs/verification.md)。历史版本需具备 DSH 的原生授权和凭据服务。

## 开发

```sh
npm ci
npm test
npm run build
npm pack
```

MIT License.
