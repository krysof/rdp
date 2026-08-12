import './style.css';
import '../vendor/IronRDP/web-client/iron-remote-desktop/src/main';
import type {
    IronError,
    NewSessionInfo,
    UserInteraction,
} from '../vendor/IronRDP/web-client/iron-remote-desktop/src/main';
import { IronErrorKind } from '../vendor/IronRDP/web-client/iron-remote-desktop/src/interfaces/Error';
import { ScreenScale } from '../vendor/IronRDP/web-client/iron-remote-desktop/src/enums/ScreenScale';
import {
    Backend,
    displayControl,
    init,
} from '../vendor/IronRDP/web-client/iron-remote-desktop-rdp/src/main';

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnecting';

type SavedSettings = {
    destination: string;
    username: string;
    domain: string;
    scale: ScaleName;
    clipboard: boolean;
};

type ScaleName = 'fit' | 'full' | 'real';

interface IronRemoteDesktopElement extends HTMLElement {
    module: typeof Backend;
}

const form = requiredElement<HTMLFormElement>('connection-form');
const connectView = requiredElement<HTMLElement>('connect-view');
const sessionView = requiredElement<HTMLElement>('session-view');
const sessionStage = requiredElement<HTMLElement>('session-stage');
const desktopMount = requiredElement<HTMLElement>('desktop-mount');
const engineStatus = requiredElement<HTMLElement>('wasm-status');
const connectButton = requiredElement<HTMLButtonElement>('connect-button');
const formError = requiredElement<HTMLElement>('form-error');
const sessionLoading = requiredElement<HTMLElement>('session-loading');
const sessionHost = requiredElement<HTMLElement>('session-host');
const sessionStatus = requiredElement<HTMLElement>('session-status');
const toast = requiredElement<HTMLElement>('toast');
const iwaRequired = requiredElement<HTMLElement>('iwa-required');

const directSocketsAvailable = 'TCPSocket' in globalThis && window.location.protocol === 'isolated-app:';

let userInteraction: UserInteraction | undefined;
let engineReady = false;
let connectionState: ConnectionState = 'idle';
let resizeTimer: number | undefined;
let toastTimer: number | undefined;

restoreSettings();
configureSecretToggles();
configureToolbar();
requiredElement<HTMLButtonElement>('forget-certificates').addEventListener('click', () => {
    try {
        Object.keys(localStorage)
            .filter((key) => key.startsWith('rdp.certificate.'))
            .forEach((key) => localStorage.removeItem(key));
        showToast('已清除证书信任记录', 'success');
    } catch {
        showToast('无法访问本地证书信任记录', 'error');
    }
});

const remoteDesktop = document.createElement('iron-remote-desktop') as IronRemoteDesktopElement;
remoteDesktop.setAttribute('scale', field<HTMLSelectElement>('initial-scale').value);
remoteDesktop.setAttribute('verbose', 'false');
remoteDesktop.setAttribute('flexcenter', 'true');
remoteDesktop.module = Backend;
remoteDesktop.addEventListener('ready', (event) => {
    const detail = (event as CustomEvent<{ irgUserInteraction: UserInteraction }>).detail;
    userInteraction = detail.irgUserInteraction;
    userInteraction.onWarningCallback((message) => showToast(message, 'warning'));
    updateConnectAvailability();
});
desktopMount.append(remoteDesktop);

void initialiseEngine();

form.addEventListener('submit', (event) => {
    event.preventDefault();
    void connect();
});

const resizeObserver = new ResizeObserver(() => {
    if (connectionState !== 'connected' || userInteraction === undefined) {
        return;
    }

    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
        const size = getDesktopSize();
        userInteraction?.resize(size.width, size.height, window.devicePixelRatio);
    }, 350);
});
resizeObserver.observe(sessionStage);

async function initialiseEngine(): Promise<void> {
    if (!directSocketsAvailable) {
        iwaRequired.hidden = false;
        engineStatus.className = 'engine-status error';
        engineStatus.innerHTML = '<i></i>需要 IWA';
        showFormError('当前是普通网页环境。请安装下方的 rdp.swbn；GitHub Pages 版本不具备原始 TCP 权限。');
        return;
    }

    try {
        await init('WARN');
        engineReady = true;
        engineStatus.className = 'engine-status ready';
        engineStatus.innerHTML = '<i></i>IronRDP 已就绪';
        updateConnectAvailability();
    } catch (error) {
        engineStatus.className = 'engine-status error';
        engineStatus.innerHTML = '<i></i>引擎加载失败';
        showFormError(`WebAssembly 初始化失败：${readError(error)}`);
    }
}

async function connect(): Promise<void> {
    if (!engineReady || userInteraction === undefined || connectionState !== 'idle') {
        return;
    }

    clearFormError();

    const values = readConnectionValues();
    const validationError = validate(values.destination, values.trustCertificate);
    if (validationError !== undefined) {
        showFormError(validationError);
        return;
    }

    saveSettings(values);
    connectionState = 'connecting';
    connectButton.disabled = true;
    connectButton.classList.add('working');
    connectButton.querySelector('span')!.textContent = '正在连接…';
    sessionHost.textContent = values.destination;
    sessionStatus.textContent = '正在协商安全会话…';
    sessionLoading.hidden = false;
    remoteDesktop.setAttribute('scale', values.scale);
    field<HTMLSelectElement>('session-scale').value = values.scale;
    showSessionView();

    await nextPaint();

    try {
        userInteraction.setEnableClipboard(values.clipboard);
        userInteraction.setEnableAutoClipboard(values.clipboard);

        const config = userInteraction
            .configBuilder()
            .withUsername(values.username)
            .withPassword(values.password)
            .withDestination(values.destination)
            .withProxyAddress('iwa-direct://local')
            .withServerDomain(values.domain)
            .withAuthToken('iwa-direct')
            .withDesktopSize(getDesktopSize())
            .withExtension(displayControl(true))
            .build();

        const newSession = await userInteraction.connect(config);
        connectionState = 'connected';
        sessionStatus.textContent = `${newSession.initialDesktopSize.width} × ${newSession.initialDesktopSize.height} · 已连接`;
        sessionLoading.hidden = true;
        userInteraction.setVisibility(true);
        showToast('远程桌面连接成功', 'success');
        void monitorSession(newSession);
    } catch (error) {
        restoreAfterTermination();
        showFormError(describeConnectionError(error));
        showToast('连接失败', 'error');
    }
}

async function monitorSession(session: NewSessionInfo): Promise<void> {
    try {
        const termination = await session.run();
        if (connectionState !== 'disconnecting') {
            showToast(`远程会话已结束：${termination.reason()}`, 'warning');
        }
    } catch (error) {
        showToast(`会话异常结束：${readError(error)}`, 'error');
    } finally {
        restoreAfterTermination();
    }
}

function configureToolbar(): void {
    requiredElement<HTMLSelectElement>('session-scale').addEventListener('change', (event) => {
        const scale = (event.currentTarget as HTMLSelectElement).value as ScaleName;
        userInteraction?.setScale(toScreenScale(scale));
    });

    requiredElement<HTMLButtonElement>('send-meta').addEventListener('click', () => {
        userInteraction?.metaKey();
        showToast('已发送 Windows 键', 'success');
    });

    requiredElement<HTMLButtonElement>('send-cad').addEventListener('click', () => {
        userInteraction?.ctrlAltDel();
        showToast('已发送 Ctrl + Alt + Delete', 'success');
    });

    requiredElement<HTMLButtonElement>('fullscreen').addEventListener('click', async () => {
        try {
            if (document.fullscreenElement === sessionStage) {
                await document.exitFullscreen();
            } else {
                await sessionStage.requestFullscreen();
            }
        } catch (error) {
            showToast(`无法切换全屏：${readError(error)}`, 'error');
        }
    });

    requiredElement<HTMLButtonElement>('disconnect').addEventListener('click', () => {
        if (connectionState === 'idle' || connectionState === 'disconnecting') {
            return;
        }
        connectionState = 'disconnecting';
        sessionStatus.textContent = '正在断开…';
        userInteraction?.shutdown();
    });
}

function configureSecretToggles(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-reveal]').forEach((button) => {
        button.addEventListener('click', () => {
            const input = field<HTMLInputElement>(button.dataset.reveal!);
            const shouldReveal = input.type === 'password';
            input.type = shouldReveal ? 'text' : 'password';
            button.textContent = shouldReveal ? '隐藏' : '显示';
        });
    });
}

function readConnectionValues() {
    return {
        destination: field<HTMLInputElement>('destination').value.trim(),
        username: field<HTMLInputElement>('username').value.trim(),
        domain: field<HTMLInputElement>('domain').value.trim(),
        password: field<HTMLInputElement>('password').value,
        clipboard: field<HTMLInputElement>('clipboard').checked,
        trustCertificate: field<HTMLInputElement>('trust-certificate').checked,
        scale: field<HTMLSelectElement>('initial-scale').value as ScaleName,
    };
}

function validate(destination: string, trustCertificate: boolean): string | undefined {
    if (destination === '') {
        return '请填写目标主机。';
    }
    if (!/^\[?[\w.:%-]+\]?(?::\d+)?$/.test(destination)) {
        return '目标主机格式无效，请使用主机名或 IP，可附加端口（例如 10.0.0.8:3389）。';
    }
    if (!trustCertificate) {
        return '连接前请确认你信任目标主机提供的 RDP 证书。';
    }

    return undefined;
}

function getDesktopSize(): { width: number; height: number } {
    const bounds = sessionStage.getBoundingClientRect();
    return {
        width: Math.round(clamp(bounds.width || 1280, 640, 4096)),
        height: Math.round(clamp(bounds.height || 720, 480, 2160)),
    };
}

function toScreenScale(scale: ScaleName): ScreenScale {
    switch (scale) {
        case 'full':
            return ScreenScale.Full;
        case 'real':
            return ScreenScale.Real;
        default:
            return ScreenScale.Fit;
    }
}

function showSessionView(): void {
    connectView.hidden = true;
    sessionView.hidden = false;
    document.body.classList.add('session-active');
    window.scrollTo({ top: 0 });
}

function restoreAfterTermination(): void {
    if (connectionState === 'idle') {
        return;
    }

    connectionState = 'idle';
    userInteraction?.setVisibility(false);
    sessionView.hidden = true;
    connectView.hidden = false;
    document.body.classList.remove('session-active');
    sessionLoading.hidden = false;
    connectButton.classList.remove('working');
    connectButton.querySelector('span')!.textContent = '连接远程桌面';
    field<HTMLInputElement>('password').value = '';
    updateConnectAvailability();
}

function updateConnectAvailability(): void {
    connectButton.disabled = !engineReady || userInteraction === undefined || connectionState !== 'idle';
}

function saveSettings(values: ReturnType<typeof readConnectionValues>): void {
    const settings: SavedSettings = {
        destination: values.destination,
        username: values.username,
        domain: values.domain,
        scale: values.scale,
        clipboard: values.clipboard,
    };

    try {
        localStorage.setItem('rdp.settings', JSON.stringify(settings));
    } catch {
        // Storage may be blocked; a connection should still work.
    }
}

function restoreSettings(): void {
    try {
        const raw = localStorage.getItem('rdp.settings');
        if (raw !== null) {
            const saved = JSON.parse(raw) as Partial<SavedSettings>;
            setIfString('destination', saved.destination);
            setIfString('username', saved.username);
            setIfString('domain', saved.domain);
            if (saved.scale === 'fit' || saved.scale === 'real' || saved.scale === 'full') {
                field<HTMLSelectElement>('initial-scale').value = saved.scale;
            }
            if (typeof saved.clipboard === 'boolean') {
                field<HTMLInputElement>('clipboard').checked = saved.clipboard;
            }
        }
    } catch {
        localStorage.removeItem('rdp.settings');
    }

    const query = new URLSearchParams(window.location.search);
    for (const name of ['destination', 'username', 'domain'] as const) {
        const value = query.get(name);
        if (value !== null) {
            field<HTMLInputElement>(name).value = value;
        }
    }
}

function setIfString(id: string, value: unknown): void {
    if (typeof value === 'string') {
        field<HTMLInputElement>(id).value = value;
    }
}

function describeConnectionError(error: unknown): string {
    if (!isIronError(error)) {
        return `连接失败：${readError(error)}`;
    }

    switch (error.kind()) {
        case IronErrorKind.WrongPassword:
        case IronErrorKind.LogonFailure:
            return 'Windows 登录失败，请检查用户名、域和密码。';
        case IronErrorKind.AccessDenied:
            return '目标主机拒绝了访问，请确认账户具备远程桌面权限。';
        case IronErrorKind.ProxyConnect:
            return '无法打开 Direct Socket，请检查 IWA 权限、目标地址和网络访问。';
        case IronErrorKind.NegotiationFailure:
            return 'RDP 安全协商失败，请检查目标主机的 RDP/NLA 配置。';
        case IronErrorKind.RDCleanPath: {
            const details = error.rdcleanpathDetails();
            const code = details?.httpStatusCode !== undefined ? `（HTTP ${details.httpStatusCode}）` : '';
            return `RDP 连接失败${code}，请检查目标地址与主机配置。`;
        }
        default:
            return `IronRDP 连接失败：${error.backtrace()}`;
    }
}

function isIronError(error: unknown): error is IronError {
    return (
        typeof error === 'object' &&
        error !== null &&
        typeof (error as IronError).kind === 'function' &&
        typeof (error as IronError).backtrace === 'function'
    );
}

function readError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function showFormError(message: string): void {
    formError.textContent = message;
    formError.hidden = false;
    formError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearFormError(): void {
    formError.hidden = true;
    formError.textContent = '';
}

function showToast(message: string, kind: 'success' | 'warning' | 'error'): void {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = `toast ${kind}`;
    toast.hidden = false;
    toastTimer = window.setTimeout(() => {
        toast.hidden = true;
    }, 4200);
}

function field<T extends HTMLInputElement | HTMLSelectElement>(id: string): T {
    return requiredElement<T>(id);
}

function requiredElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (element === null) {
        throw new Error(`Missing required element #${id}`);
    }
    return element as T;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function nextPaint(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
