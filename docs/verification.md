# 发行验证

- DSH 0.2.0-rc.2 与 0.2.1-alpha.1 原生 Web profile 均成功加载插件，自动注册账号目录中的 10 个模型。
- 原生 OAuth 浏览器授权流程的启动、输入桥接与取消已验证；实际账号通过已有 OAuth 登录验证。
- GPT-6.1 Sol 在原生 DSH 中实际完成 read 文件读取、bash 算术与最终回复，回合正常完成。
- DSH Desktop 0.2.0-rc.2 + OMD 0.8.1 的实际桌面界面显示已登录和 10 个模型；GPT-6.1 Sol 完成真实对话回复。桌面配置可覆盖凭据文件路径，登录必须使用宿主 credentials 服务所指定的存储。
- 登录、完整目录、设置并发保护、取消、退出、请求鉴权和授权码脱敏有针对性回归测试。
- Fast 按会话保存、重建后恢复；其他会话和其他渠道不受影响。开关分别注入 priority 和省略 service_tier，保留思考档位、取消信号及原有 payload hook；适配器刷新与卸载也有验证。
- DSH 0.2.0-rc.2 的原生模型调用在开启 Fast 后实际返回 FAST_OK；模型窗口正确读取最大值 872k，并保留 GPT‑5.5 的 272k。
- 实际 Desktop + OMD 界面完成闪电开启和关闭点击；切到 Kimi 渠道后，闪电完全隐藏。当前草稿保持原样。

历史 DSH 版本需提供原生 authorization、credentials、settings 和 llm 服务。Web、Desktop 共享同一插件；TUI 使用原生 chatgpt 命令。
