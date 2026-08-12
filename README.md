# RDP

一个运行在浏览器中的 RDP 客户端。RDP 协议、图形解码和输入处理由
[Devolutions/IronRDP](https://github.com/Devolutions/IronRDP) 的 Rust 代码编译为 WebAssembly 后完成。

**在线使用：<https://krysof.github.io/rdp/>**

## 连接方式

```text
浏览器（IronRDP WASM） ⇄ wss:// ⇄ Devolutions Gateway ⇄ TCP/3389 ⇄ Windows
```

浏览器安全模型不允许网页直接打开 TCP Socket，因此静态 GitHub Pages **不能单独直连 3389**。
你需要一台能够访问目标 Windows 主机的
[Devolutions Gateway](https://github.com/Devolutions/devolutions-gateway)，以及由 Gateway provisioner 签发的短期
`ASSOCIATION` / JET token。Gateway 端应启用 IronRDP Web Client 所使用的 RDCleanPath 支持。

连接表单需要：

- Gateway WebSocket 地址，例如 `wss://gateway.example.com/jet/rdp`
- 目标主机，例如 `10.0.0.8:3389`
- Gateway JET token
- Windows 用户名、域（可选）和密码

## 功能

- IronRDP Rust 协议栈编译为 WebAssembly
- Canvas 远程画面、键盘、鼠标与滚轮输入
- 动态分辨率、适应/原始/充满缩放、全屏
- Windows 键和 `Ctrl + Alt + Delete`
- 浏览器剪贴板同步
- 针对凭据、Gateway、令牌和 RDP 协商错误的可读提示
- 桌面和移动端响应式界面

## 安全说明

- 本项目是纯静态站点，没有用于接收凭据的应用服务器。
- 密码和 token 只保存在当前页面内存中，断开后会清空，也不会写入 `localStorage`。
- `localStorage` 只保存 Gateway 地址、目标地址、用户名、域和界面偏好。
- 请只使用可信、启用 TLS 的 `wss://` Gateway，并使用权限最小、有效期短的 token。
- 静态站点托管者仍可更改前端代码；在高安全环境中请审计代码并自行部署。

## 本地开发

需要 Node.js 24、Rust 1.94.1、`wasm32-unknown-unknown` target 和 `wasm-pack` 0.13.1。

```bash
git clone --recurse-submodules https://github.com/krysof/rdp.git
cd rdp
rustup target add wasm32-unknown-unknown --toolchain 1.94.1
cargo install wasm-pack --version 0.13.1 --locked
npm ci
npm run dev       # 已构建 WASM 时启动开发服务器
npm run build     # 重新编译 IronRDP WASM 并生成 dist/
```

首次 `npm run build` 会编译 IronRDP，耗时会明显长于普通前端构建。只修改前端时可运行 `npm run build:web`。

可通过 URL 参数预填非敏感字段：`gateway`、`destination`、`username`、`domain`。密码和 token 刻意不支持 URL 参数。

## 上游代码

IronRDP 以 Git submodule 固定在 `vendor/IronRDP`。更新上游时：

```bash
git -C vendor/IronRDP fetch origin master
git -C vendor/IronRDP checkout <reviewed-commit>
git add vendor/IronRDP
```

请在提交前重新执行完整构建和浏览器测试。

## 部署

推送 `main` 后，[GitHub Actions](.github/workflows/pages.yml) 会：

1. 拉取 IronRDP submodule；
2. 使用 `wasm-pack` 编译 `ironrdp-web`；
3. 使用 Vite 生成静态文件；
4. 部署到 GitHub Pages。

## License

本仓库的界面与集成代码采用 [MIT](LICENSE) 许可证。IronRDP submodule 保留其上游的
[Apache-2.0](vendor/IronRDP/LICENSE-APACHE) / [MIT](vendor/IronRDP/LICENSE-MIT) 双许可证。
