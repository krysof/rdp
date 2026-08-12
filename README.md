# RDP

基于 [IronRDP](https://github.com/Devolutions/IronRDP)、Rust 和 WebAssembly 的 **Isolated Web App (IWA)** RDP 客户端。
它通过 Chrome Direct Sockets 直接连接目标主机的 TCP/3389，不需要 Gateway、中转服务器或原生 helper。

- 下载页：<https://krysof.github.io/rdp/>
- 最新 IWA：<https://github.com/krysof/rdp/releases/latest/download/rdp.swbn>
- Web Bundle ID：`tqzipirnhzpyqykj7yeqoabp4nnhffi6h3y6l7w4uygoth3i5qkqaaic`

## 连接路径

```text
RDP IWA（IronRDP WASM） ⇄ Direct TCP ⇄ TLS / CredSSP ⇄ Windows RDP
```

普通 `https://` 网页不能打开原始 TCP Socket，因此 GitHub Pages 只负责展示和下载。
实际客户端必须从 signed web bundle (`rdp.swbn`) 安装并以 `isolated-app://` 运行。

## 安装

目前最通用的测试安装方式：

1. 使用 Chrome/ChromeOS 120 或更高版本；
2. 打开 `chrome://flags/#enable-isolated-web-app-dev-mode`，启用 IWA Developer Mode 并重启 Chrome；
3. 下载 [`rdp.swbn`](https://github.com/krysof/rdp/releases/latest/download/rdp.swbn)；
4. 打开 `chrome://web-app-internals`；
5. 选择 **Install IWA from Signed Web Bundle**，安装下载的文件；
6. 启动 **RDP**，输入目标地址（例如 `192.168.1.10:3389`）和 Windows 凭据。

Direct Sockets 与私有网络权限由 IWA manifest 声明，Chrome 仍可能在首次使用时要求用户或管理员授权。
生产环境中的企业安装还受 Chrome/ChromeOS IWA 策略和 allowlist 约束。

## 功能

- IronRDP Rust 协议栈编译为 WebAssembly
- IWA `TCPSocket` 原始 TCP 直连，无 Gateway
- Rustls TLS 1.2/1.3 与 CredSSP/NLA
- Canvas 远程画面、键盘、鼠标与滚轮输入
- 动态分辨率、适应/原始/充满缩放、全屏
- Windows 键、`Ctrl + Alt + Delete`、剪贴板同步
- RDP 证书 SHA-256 指纹首次信任（TOFU）；证书变化时拒绝发送凭据
- 桌面和移动端响应式界面

## 安全说明

- 应用是离线签名包；密码只保存在当前进程内存，不写入 `localStorage`，也不经过本站服务器。
- 首次连接会在 TLS 完成、CredSSP 发送凭据之前显示服务器证书 SHA-256 指纹。应通过可信渠道核对指纹。
- 接受后仅保存证书指纹；后续证书变化会终止连接。证书正常轮换时，可在连接页清除已信任指纹后重新核对。
- 这是 TOFU，不等同于由公共 CA 验证。首次连接若不核对指纹，仍可能遭遇中间人攻击。
- 不要用本客户端扫描网络，只连接你被授权管理的 RDP 主机。

## 本地开发

需要 Node.js 24、Rust 1.94.1、`wasm32-unknown-unknown` target 和 `wasm-pack` 0.13.1。

```bash
git clone --recurse-submodules https://github.com/krysof/rdp.git
cd rdp
rustup target add wasm32-unknown-unknown --toolchain 1.94.1
cargo install wasm-pack --version 0.13.1 --locked
npm ci
npm run build
```

仅修改前端时可运行 `npm run build:web`。普通 Vite 页面会显示 IWA 下载提示；Direct Sockets 只能在已安装 IWA 中测试。

### 打包 IWA

使用固定的 Ed25519 或 ECDSA P-256 私钥；更换密钥会改变应用身份：

```bash
openssl genpkey -algorithm Ed25519 -out private_key.pem
IWA_SIGNING_KEY=/absolute/path/private_key.pem npm run package:iwa
npx wbn-sign info rdp.swbn
```

私钥不得提交到仓库。GitHub Release workflow 从加密的 repository secret 还原构建密钥并生成 `rdp.swbn`。

## 代码结构

- `vendor/IronRDP`：固定版本的上游 submodule
- `crates/ironrdp-iwa`：基于上游 `ironrdp-web` 的 IWA Direct Socket/TLS 传输适配
- `src/`：连接界面与 IronRDP Web Component 集成
- `public/.well-known/manifest.webmanifest`：IWA manifest 与权限策略
- `.github/workflows/`：Pages 下载页和 signed web bundle 发布

## License

本仓库的界面与集成代码采用 [MIT](LICENSE) 许可证。复制/修改自 IronRDP 的代码以及 submodule 保留
[Apache-2.0](vendor/IronRDP/LICENSE-APACHE) / [MIT](vendor/IronRDP/LICENSE-MIT) 双许可证。
