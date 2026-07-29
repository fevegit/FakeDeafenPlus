/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Feve
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import type { PluginNative, PluginSettingComponentProps } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import {
    ChannelStore,
    MediaEngineStore,
    React,
    SelectedChannelStore,
    showToast,
    Toasts
} from "@webpack/common";
import { t } from "./i18n";

type GatewayPayload = Record<string, unknown>;
type GatewaySend = (op: number, data?: GatewayPayload, ...args: unknown[]) => unknown;

interface GatewaySocket {
    send: GatewaySend;
}

interface GatewayModule {
    getSocket(): GatewaySocket | null | undefined;
}

interface PatchedSocket {
    original: GatewaySend;
    wrapped: GatewaySend;
}

const logger = new Logger("FakeDeafen+");
const gatewayModule = findByPropsLazy("getSocket") as GatewayModule;
const Native = VencordNative.pluginHelpers["FakeDeafen+"] as PluginNative<typeof import("./native")>;

const BUTTON_ID = "vc-fake-deafen-button";
const SLOT_ID = "vc-fake-deafen-slot";
const STYLE_ID = "vc-fake-deafen-style";
const TOOLTIP_ID = "vc-fake-deafen-tooltip";
const patchedSockets = new Map<GatewaySocket, PatchedSocket>();

let active = false;
let activeChannelId: string | null = null;
let accountPanelObserver: MutationObserver | null = null;
let pendingButtonFrame = 0;
let audioContext: AudioContext | null = null;
let hotkeyGeneration = 0;
let hotkeyRecording = false;

const DEFAULT_HOTKEY = "Control+Shift+Q";

function getAudioContext(): AudioContext | null {
    try {
        audioContext ??= new AudioContext();
        return audioContext;
    } catch (error) {
        logger.error("No se pudo inicializar el sonido de FakeDeafen+:", error);
        return null;
    }
}

function playToggleSound(enabled: boolean) {
    if (!settings.store.playSound) return;

    const context = getAudioContext();
    if (!context) return;

    void context.resume().then(() => {
        const now = context.currentTime;
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(enabled ? 520 : 690, now);
        oscillator.frequency.exponentialRampToValueAtTime(
            enabled ? 760 : 430,
            now + 0.13
        );

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.055, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.start(now);
        oscillator.stop(now + 0.19);
    }).catch(error => {
        logger.error("No se pudo reproducir el sonido de FakeDeafen+:", error);
    });
}

function scheduleButtonUpdate() {
    if (pendingButtonFrame) return;

    pendingButtonFrame = requestAnimationFrame(() => {
        pendingButtonFrame = 0;
        updateButton();
    });
}

interface HotkeyRegistrationResult {
    ok: boolean;
    version: number;
    error?: string;
}

function localizeHotkeyError(error?: string): string {
    switch (error) {
        case "HOTKEY_UNAVAILABLE":
            return t(
                "Ese atajo global está ocupado o Windows no permite registrarlo.",
                "That global shortcut is already in use or Windows does not allow it."
            );
        case "HOTKEY_REGISTRATION_FAILED":
            return t(
                "No se pudo registrar el atajo global.",
                "The global shortcut could not be registered."
            );
        default:
            return error || t(
                "El atajo global ya está ocupado por otra aplicación.",
                "The global shortcut is already used by another application."
            );
    }
}

function formatHotkey(accelerator: string): string {
    return accelerator
        .replaceAll("CommandOrControl", "Ctrl")
        .replaceAll("Control", "Ctrl")
        .replaceAll("Super", "Win")
        .split("+")
        .join(" + ");
}

function keyboardEventToAccelerator(event: KeyboardEvent): { value?: string; error?: string; } {
    const code = event.code;
    let primary = "";

    if (/^Key[A-Z]$/.test(code)) {
        primary = code.slice(3);
    } else if (/^Digit[0-9]$/.test(code)) {
        primary = code.slice(5);
    } else if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) {
        primary = code;
    } else {
        const keyMap: Record<string, string> = {
            Space: "Space",
            Enter: "Enter",
            Tab: "Tab",
            Backspace: "Backspace",
            Delete: "Delete",
            Insert: "Insert",
            Home: "Home",
            End: "End",
            PageUp: "PageUp",
            PageDown: "PageDown",
            ArrowUp: "Up",
            ArrowDown: "Down",
            ArrowLeft: "Left",
            ArrowRight: "Right"
        };

        primary = keyMap[code] ?? "";
    }

    if (!primary) {
        return {};
    }

    const parts: string[] = [];

    if (event.ctrlKey) parts.push("Control");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Super");

    const isFunctionKey = /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(primary);
    if (!parts.length && !isFunctionKey) {
        return {
            error: t(
                "Añade Ctrl, Alt, Shift o Win para evitar capturar una tecla normal en todo Windows.",
                "Add Ctrl, Alt, Shift, or Win to avoid capturing a regular key system-wide."
            )
        };
    }

    parts.push(primary);
    return { value: parts.join("+") };
}

async function unregisterGlobalHotkey() {
    hotkeyGeneration++;

    try {
        await Native.unregisterHotkey();
    } catch (error) {
        logger.error("No se pudo desregistrar el atajo global:", error);
    }
}

async function configureGlobalHotkey(notifyOnFailure = true) {
    const generation = ++hotkeyGeneration;

    if (hotkeyRecording || !settings.store.enableKeybind) {
        try {
            await Native.unregisterHotkey();
        } catch (error) {
            logger.error("No se pudo detener el atajo global:", error);
        }
        return;
    }

    const accelerator = settings.store.hotkey || DEFAULT_HOTKEY;
    let registration: HotkeyRegistrationResult;

    try {
        registration = await Native.registerHotkey(accelerator);
    } catch (error) {
        logger.error("No se pudo registrar el atajo global:", error);

        if (notifyOnFailure) {
            showToast(
                t(
                    "No se pudo registrar el atajo global de FakeDeafen+.",
                    "The FakeDeafen+ global shortcut could not be registered."
                ),
                Toasts.Type.FAILURE
            );
        }
        return;
    }

    if (generation !== hotkeyGeneration) {
        return;
    }

    if (!registration.ok) {
        logger.error("El atajo global fue rechazado:", registration.error);

        if (notifyOnFailure) {
            showToast(
                localizeHotkeyError(registration.error),
                Toasts.Type.FAILURE
            );
        }
        return;
    }

    let version = registration.version;

    while (
        generation === hotkeyGeneration
        && settings.store.enableKeybind
        && !hotkeyRecording
    ) {
        let nextVersion: number;

        try {
            nextVersion = await Native.waitForHotkey(version);
        } catch (error) {
            logger.error("Falló la espera del atajo global:", error);
            return;
        }

        if (nextVersion < 0 || generation !== hotkeyGeneration) {
            return;
        }

        version = nextVersion;
        toggleActive();
    }
}

function scheduleGlobalHotkeyUpdate() {
    window.setTimeout(() => {
        void configureGlobalHotkey();
    }, 0);
}

function HotkeyRecorder({ setValue }: PluginSettingComponentProps) {
    const { hotkey } = settings.use(["hotkey"]);
    const [recording, setRecording] = React.useState(false);
    const [error, setError] = React.useState("");

    React.useEffect(() => {
        if (!recording) return;

        let disposed = false;

        const onKeyDown = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();

            if (event.code === "Escape") {
                setError("");
                setRecording(false);
                return;
            }

            const result = keyboardEventToAccelerator(event);

            if (result.error) {
                setError(result.error);
                return;
            }

            if (!result.value) {
                return;
            }

            setValue(result.value);
            setError("");
            setRecording(false);
        };

        hotkeyRecording = true;

        void unregisterGlobalHotkey().finally(() => {
            if (!disposed) {
                window.addEventListener("keydown", onKeyDown, true);
            }
        });

        return () => {
            disposed = true;
            window.removeEventListener("keydown", onKeyDown, true);
            hotkeyRecording = false;

            window.setTimeout(() => {
                void configureGlobalHotkey(false);
            }, 0);
        };
    }, [recording]);

    const currentHotkey = typeof hotkey === "string" && hotkey
        ? hotkey
        : DEFAULT_HOTKEY;

    const buttonStyle: React.CSSProperties = {
        minWidth: "210px",
        height: "36px",
        padding: "0 12px",
        border: "1px solid var(--input-border, transparent)",
        borderRadius: "4px",
        background: recording
            ? "var(--button-danger-background, #da373c)"
            : "var(--input-background, var(--background-tertiary))",
        color: recording
            ? "var(--white-500, white)"
            : "var(--text-normal)",
        fontWeight: 500,
        cursor: "pointer",
        textAlign: "left"
    };

    return (
        <div style={{ padding: "8px 0 4px" }}>
            <div style={{ color: "var(--header-primary)", fontWeight: 600, marginBottom: "4px" }}>
                {t("Atajo global", "Global shortcut")}
            </div>

            <div style={{ color: "var(--text-muted)", fontSize: "13px", marginBottom: "10px" }}>
                {t(
                    "Funciona incluso cuando Discord no tiene el foco.",
                    "Works even when Discord is not focused."
                )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <div
                    style={{
                        minWidth: "150px",
                        height: "36px",
                        padding: "0 12px",
                        border: "1px solid var(--input-border, transparent)",
                        borderRadius: "4px",
                        background: "var(--input-background, var(--background-tertiary))",
                        color: "var(--text-normal)",
                        display: "flex",
                        alignItems: "center",
                        fontWeight: 500
                    }}
                >
                    {recording
                        ? t("Pulsa la combinación…", "Press the key combination…")
                        : formatHotkey(currentHotkey)}
                </div>

                <button
                    type="button"
                    style={{
                        ...buttonStyle,
                        minWidth: "154px",
                        textAlign: "center"
                    }}
                    onClick={() => {
                        setError("");
                        setRecording(value => !value);
                    }}
                >
                    {recording
                        ? t("Cancelar grabación", "Cancel recording")
                        : t("Grabar combinación", "Record shortcut")}
                </button>

                <button
                    type="button"
                    disabled={recording || currentHotkey === DEFAULT_HOTKEY}
                    onClick={() => {
                        setValue(DEFAULT_HOTKEY);
                        setError("");
                    }}
                    style={{
                        height: "36px",
                        padding: "0 12px",
                        border: 0,
                        borderRadius: "4px",
                        background: "var(--button-secondary-background)",
                        color: "var(--button-secondary-text)",
                        opacity: recording || currentHotkey === DEFAULT_HOTKEY ? 0.5 : 1,
                        cursor: recording || currentHotkey === DEFAULT_HOTKEY ? "not-allowed" : "pointer"
                    }}
                >
                    {t("Restablecer", "Reset")}
                </button>
            </div>

            {recording && !error && (
                <div style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "8px" }}>
                    {t("Esc cancela la grabación.", "Esc cancels recording.")}
                </div>
            )}

            {error && (
                <div style={{ color: "var(--text-danger)", fontSize: "13px", marginTop: "8px" }}>
                    {error}
                </div>
            )}
        </div>
    );
}

export const settings = definePluginSettings({
    playSound: {
        type: OptionType.BOOLEAN,
        description: t(
            "Reproduce un sonido breve al activar o desactivar FakeDeafen+.",
            "Play a short sound when FakeDeafen+ is enabled or disabled."
        ),
        default: true
    },
    showButton: {
        type: OptionType.BOOLEAN,
        description: t(
            "Muestra un botón de FakeDeafen+ junto a los controles de voz.",
            "Show a FakeDeafen+ button next to the voice controls."
        ),
        default: true,
        onChange: scheduleButtonUpdate
    },
    enableKeybind: {
        type: OptionType.BOOLEAN,
        description: t(
            "Activa un atajo global que funciona incluso fuera de Discord.",
            "Enable a global shortcut that also works outside Discord."
        ),
        default: true,
        onChange: scheduleGlobalHotkeyUpdate
    },
    hotkey: {
        type: OptionType.COMPONENT,
        component: HotkeyRecorder,
        default: DEFAULT_HOTKEY,
        onChange: scheduleGlobalHotkeyUpdate
    }
});

function getVoiceChannelId(): string | null {
    const store = SelectedChannelStore as unknown as {
        getVoiceChannelId?: () => string | null;
        getVoiceChannel?: () => { id?: string; } | null;
    };

    return store.getVoiceChannelId?.()
        ?? store.getVoiceChannel?.()?.id
        ?? null;
}

function getActualMute(): boolean {
    const engine = MediaEngineStore as unknown as {
        isMute?: () => boolean;
        isSelfMute?: () => boolean;
    };

    return Boolean(engine?.isMute?.() ?? engine?.isSelfMute?.() ?? false);
}

function getActualDeaf(): boolean {
    const engine = MediaEngineStore as unknown as {
        isDeaf?: () => boolean;
        isSelfDeaf?: () => boolean;
    };

    return Boolean(engine?.isDeaf?.() ?? engine?.isSelfDeaf?.() ?? false);
}

function getSocket(): GatewaySocket | null {
    try {
        const socket = gatewayModule.getSocket?.();
        return socket && typeof socket.send === "function" ? socket : null;
    } catch (error) {
        logger.error("No se pudo obtener el socket de Discord:", error);
        return null;
    }
}

function deactivateForChannelChange() {
    if (!active) return;

    active = false;
    activeChannelId = null;
    scheduleButtonUpdate();
    showToast(
        t(
            "FakeDeafen+ se desactivó al salir o cambiar de canal.",
            "FakeDeafen+ was disabled after leaving or changing channels."
        ),
        Toasts.Type.MESSAGE
    );
}

function patchCurrentSocket(): GatewaySocket | null {
    const socket = getSocket();
    if (!socket) return null;
    if (patchedSockets.has(socket)) return socket;

    const original = socket.send;

    const wrapped: GatewaySend = function (this: GatewaySocket, op, data, ...args) {
        let outgoing = data;

        if (op === 4 && active && outgoing && typeof outgoing === "object") {
            const nextChannelId = typeof outgoing.channel_id === "string"
                ? outgoing.channel_id
                : null;

            if (!nextChannelId || (activeChannelId && nextChannelId !== activeChannelId)) {
                deactivateForChannelChange();
            } else {
                outgoing = { ...outgoing };

                outgoing.self_mute = true;
                outgoing.self_deaf = true;
            }
        }

        return original.apply(this, [op, outgoing, ...args]);
    };

    try {
        socket.send = wrapped;
        patchedSockets.set(socket, { original, wrapped });
        return socket;
    } catch (error) {
        logger.error("No se pudo interceptar el socket de Discord:", error);
        return null;
    }
}

function restoreSockets() {
    for (const [socket, patch] of patchedSockets) {
        try {
            if (socket.send === patch.wrapped) {
                socket.send = patch.original;
            }
        } catch (error) {
            logger.error("No se pudo restaurar un socket:", error);
        }
    }

    patchedSockets.clear();
}

function refreshVoiceState(useFakeState: boolean): boolean {
    const channelId = getVoiceChannelId();
    if (!channelId) return false;

    const socket = patchCurrentSocket();
    if (!socket) return false;

    const channel = ChannelStore.getChannel(channelId);

    const payload: GatewayPayload = {
        guild_id: channel?.guild_id ?? null,
        channel_id: channelId,
        // Discord represents a deafened user as both muted and deafened.
        // This is a single FakeDeafen+ mode, not a separate Fake Mute feature.
        self_mute: useFakeState ? true : getActualMute(),
        self_deaf: useFakeState ? true : getActualDeaf(),
        self_video: false,
        flags: 0
    };

    try {
        socket.send(4, payload);
        return true;
    } catch (error) {
        logger.error("No se pudo enviar el estado de voz:", error);
        return false;
    }
}

function setActive(next: boolean, silent = false): boolean {
    if (next === active) {
        scheduleButtonUpdate();
        return active;
    }

    if (next) {
        const channelId = getVoiceChannelId();
        if (!channelId) {
            if (!silent) {
                showToast(
                    t(
                        "Entra primero en un canal o llamada de voz.",
                        "Join a voice channel or call first."
                    ),
                    Toasts.Type.FAILURE
                );
            }
            return false;
        }

        if (!patchCurrentSocket()) {
            if (!silent) {
                showToast(
                    t(
                        "FakeDeafen+ no pudo acceder al socket de Discord.",
                        "FakeDeafen+ could not access Discord's socket."
                    ),
                    Toasts.Type.FAILURE
                );
            }
            return false;
        }

        active = true;
        activeChannelId = channelId;

        if (!refreshVoiceState(true)) {
            active = false;
            activeChannelId = null;

            if (!silent) {
                showToast(
                    t(
                        "No se pudo activar FakeDeafen+.",
                        "FakeDeafen+ could not be enabled."
                    ),
                    Toasts.Type.FAILURE
                );
            }
            scheduleButtonUpdate();
            return false;
        }
    } else {
        active = false;
        activeChannelId = null;
        refreshVoiceState(false);
    }

    scheduleButtonUpdate();

    if (!silent) {
        playToggleSound(active);
        showToast(
            active
                ? t("FakeDeafen+ activado.", "FakeDeafen+ enabled.")
                : t("FakeDeafen+ desactivado.", "FakeDeafen+ disabled."),
            active ? Toasts.Type.SUCCESS : Toasts.Type.MESSAGE
        );
    }

    return active;
}

function toggleActive() {
    setActive(!active);
}

function isVisibleBottomLeftButton(button: HTMLButtonElement): boolean {
    const rect = button.getBoundingClientRect();

    return rect.width > 0
        && rect.height > 0
        && rect.bottom > window.innerHeight * 0.62
        && rect.left < Math.max(520, window.innerWidth * 0.38);
}

function findMuteButton(): HTMLButtonElement | null {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button[aria-label]"));
    const muteLabel = /(?:^|\b)(mute|unmute|silenciar|activar sonido|quitar silencio)(?:\b|$)/i;

    return buttons.find(button => {
        const label = button.getAttribute("aria-label") ?? "";
        return muteLabel.test(label) && isVisibleBottomLeftButton(button);
    }) ?? null;
}

interface ControlInsertionPoint {
    container: HTMLElement;
    anchor: HTMLElement;
}

function installButtonStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        #${SLOT_ID} {
            display: flex;
            flex: 0 0 auto;
            align-items: center;
            justify-content: center;
            margin-right: 2px;
        }

        #${BUTTON_ID} {
            box-sizing: border-box;
            width: 32px;
            min-width: 32px;
            height: 32px;
            padding: 0;
            margin: 0;
            border: 0;
            border-radius: 6px;
            outline: none;
            background-color: transparent;
            color: var(--interactive-normal, #b5bac1) !important;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition:
                background-color 120ms ease,
                color 120ms ease;
        }

        #${BUTTON_ID} svg,
        #${BUTTON_ID} path {
            pointer-events: none;
        }

        #${BUTTON_ID}:hover,
        #${BUTTON_ID}:focus-visible {
            background-color: var(--background-modifier-hover, rgba(78, 80, 88, 0.32));
            color: var(--interactive-hover, #dbdee1) !important;
        }

        #${BUTTON_ID}:active {
            background-color: var(--background-modifier-active, rgba(78, 80, 88, 0.48));
        }

        #${BUTTON_ID}[data-active="true"] {
            color: var(--status-danger, #f23f42) !important;
            background-color: color-mix(
                in srgb,
                var(--status-danger, #f23f42) 14%,
                transparent
            );
        }

        #${BUTTON_ID}[data-active="true"]:hover,
        #${BUTTON_ID}[data-active="true"]:focus-visible {
            color: var(--status-danger, #f23f42) !important;
            background-color: color-mix(
                in srgb,
                var(--status-danger, #f23f42) 22%,
                transparent
            );
        }

        #${TOOLTIP_ID} {
            position: fixed;
            z-index: 10000;
            max-width: 220px;
            padding: 8px 10px;
            border: 1px solid var(
                --border-subtle,
                var(--border-normal, rgba(255, 255, 255, 0.08))
            );
            border-radius: 5px;
            background: var(
                --bg-surface-overlay,
                var(--background-floating, #232428)
            );
            color: var(--text-default, var(--text-normal, #f2f3f5));
            box-shadow: var(--elevation-high, 0 8px 16px rgba(0, 0, 0, 0.24));
            font-size: 14px;
            font-weight: 500;
            line-height: 18px;
            white-space: nowrap;
            pointer-events: none;
            opacity: 0;
            transform: translate(-50%, 4px);
            transition:
                opacity 80ms ease,
                transform 80ms ease;
        }

        #${TOOLTIP_ID}[data-visible="true"] {
            opacity: 1;
            transform: translate(-50%, 0);
        }

        #${TOOLTIP_ID}::before,
        #${TOOLTIP_ID}::after {
            content: "";
            position: absolute;
            left: 50%;
            width: 0;
            height: 0;
            border-style: solid;
            border-color: transparent;
            transform: translateX(-50%);
        }

        #${TOOLTIP_ID}::before {
            top: 100%;
            border-width: 6px;
            border-top-color: var(
                --border-subtle,
                var(--border-normal, rgba(255, 255, 255, 0.08))
            );
        }

        #${TOOLTIP_ID}::after {
            top: calc(100% - 1px);
            border-width: 5px;
            border-top-color: var(
                --bg-surface-overlay,
                var(--background-floating, #232428)
            );
        }
    `;

    document.head.appendChild(style);
}

function uninstallButtonStyles() {
    document.getElementById(STYLE_ID)?.remove();
}

function findControlInsertionPoint(reference: HTMLButtonElement): ControlInsertionPoint | null {
    const separateControlLabel = /(deafen|undeafen|ensordecer|dejar de ensordecer|headphones|user settings|ajustes de usuario)/i;

    let branch: HTMLElement = reference;

    for (let depth = 0; depth < 6; depth++) {
        const parent = branch.parentElement;
        if (!parent) break;

        const hasSeparateControl = Array.from(
            parent.querySelectorAll<HTMLButtonElement>("button[aria-label]")
        ).some(button => {
            if (button === reference || branch.contains(button)) return false;
            if (!isVisibleBottomLeftButton(button)) return false;

            const label = button.getAttribute("aria-label") ?? "";
            return separateControlLabel.test(label);
        });

        if (hasSeparateControl) {
            return { container: parent, anchor: branch };
        }

        branch = parent;
    }

    const fallback = reference.parentElement;
    return fallback ? { container: fallback, anchor: reference } : null;
}

function buttonIcon(): string {
    return `
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor"
                d="M12 3a5 5 0 0 0-5 5v3.17A3 3 0 0 0 5 14v1a3 3 0 0 0 3 3h1v-6H8V8a4 4 0 0 1 8 0v4h-1v6h1a3 3 0 0 0 3-3v-1a3 3 0 0 0-2-2.83V8a5 5 0 0 0-5-5Z"/>
            <path fill="currentColor"
                d="m4.7 3.3 16 16-1.4 1.4-16-16 1.4-1.4Z"/>
        </svg>`;
}

function hideTooltip() {
    document.getElementById(TOOLTIP_ID)?.remove();
}

function showTooltip(button: HTMLButtonElement) {
    hideTooltip();

    const tooltip = document.createElement("div");
    tooltip.id = TOOLTIP_ID;
    tooltip.setAttribute("role", "tooltip");
    tooltip.textContent = "Fake Deafen";

    document.body.appendChild(tooltip);

    const buttonRect = button.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const desiredLeft = buttonRect.left + buttonRect.width / 2;
    const halfWidth = tooltipRect.width / 2;
    const safeLeft = Math.min(
        window.innerWidth - halfWidth - 8,
        Math.max(halfWidth + 8, desiredLeft)
    );

    tooltip.style.left = `${safeLeft}px`;
    tooltip.style.top = `${Math.max(8, buttonRect.top - tooltipRect.height - 10)}px`;

    requestAnimationFrame(() => {
        if (tooltip.isConnected) {
            tooltip.dataset.visible = "true";
        }
    });
}

function createButtonSlot(): HTMLDivElement {
    const slot = document.createElement("div");
    slot.id = SLOT_ID;

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.innerHTML = buttonIcon();
    button.addEventListener("mouseenter", () => showTooltip(button));
    button.addEventListener("mouseleave", hideTooltip);
    button.addEventListener("focus", () => showTooltip(button));
    button.addEventListener("blur", hideTooltip);
    button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        hideTooltip();
        toggleActive();
    });

    slot.appendChild(button);
    return slot;
}

function removeButton() {
    hideTooltip();
    document.getElementById(SLOT_ID)?.remove();
    document.getElementById(BUTTON_ID)?.remove();
}

function updateButton() {
    if (!settings.store.showButton) {
        removeButton();
        return;
    }

    installButtonStyles();

    const reference = findMuteButton();
    if (!reference) {
        removeButton();
        return;
    }

    const insertionPoint = findControlInsertionPoint(reference);
    if (!insertionPoint) return;

    let slot = document.getElementById(SLOT_ID) as HTMLDivElement | null;

    const isCorrectlyPlaced = slot
        && slot.parentElement === insertionPoint.container
        && slot.nextElementSibling === insertionPoint.anchor;

    if (!isCorrectlyPlaced) {
        slot?.remove();
        slot = createButtonSlot();

        // FakeDeafen+ queda como un control independiente justo a la izquierda
        // del grupo de mute, así el hover no puede propagarse al botón de mute.
        insertionPoint.container.insertBefore(slot, insertionPoint.anchor);
    }

    const button = slot.querySelector<HTMLButtonElement>(`#${BUTTON_ID}`);
    if (!button) return;

    button.setAttribute("aria-label", "Fake Deafen");
    button.setAttribute("aria-pressed", String(active));
    button.dataset.active = String(active);
    button.removeAttribute("title");
}

function installButtonObserver() {
    if (accountPanelObserver || !document.body) return;

    accountPanelObserver = new MutationObserver(scheduleButtonUpdate);
    accountPanelObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    scheduleButtonUpdate();
}

function uninstallButtonObserver() {
    accountPanelObserver?.disconnect();
    accountPanelObserver = null;

    if (pendingButtonFrame) {
        cancelAnimationFrame(pendingButtonFrame);
        pendingButtonFrame = 0;
    }

    removeButton();
    uninstallButtonStyles();
}

export default definePlugin({
    name: "FakeDeafen+",
    description: t(
        "Permite aparecer ensordecido mientras sigues hablando y escuchando.",
        "Appear deafened while continuing to speak and listen."
    ),
    authors: [{ name: "Feve", id: 0n }],
    tags: ["Voice", "Privacy", "Shortcuts"],
    settings,
    requiresRestart: false,

    toolboxActions: {
        [t("Alternar FakeDeafen+", "Toggle FakeDeafen+")]: toggleActive
    },

    flux: {
        CONNECTION_OPEN() {
            patchCurrentSocket();

            if (active) {
                activeChannelId = getVoiceChannelId();
                refreshVoiceState(true);
            }
        }
    },

    start() {
        active = false;
        activeChannelId = null;

        patchCurrentSocket();
        void configureGlobalHotkey();
        installButtonObserver();
    },

    stop() {
        if (active) {
            active = false;
            activeChannelId = null;
            refreshVoiceState(false);
        }

        void unregisterGlobalHotkey();
        uninstallButtonObserver();
        restoreSockets();

        if (audioContext) {
            void audioContext.close();
            audioContext = null;
        }
    }
});
