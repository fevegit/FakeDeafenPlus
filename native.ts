/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Feve
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, globalShortcut } from "electron";
import type { IpcMainInvokeEvent } from "electron";

interface HotkeyRegistrationResult {
    ok: boolean;
    version: number;
    error?: string;
}

type Waiter = (version: number) => void;

let registeredAccelerator: string | null = null;
let activationVersion = 0;
let quitHookInstalled = false;

const waiters = new Set<Waiter>();

function releaseWaiters(version: number) {
    const pending = Array.from(waiters);
    waiters.clear();

    for (const resolve of pending) {
        resolve(version);
    }
}

function unregisterCurrent() {
    if (registeredAccelerator) {
        try {
            globalShortcut.unregister(registeredAccelerator);
        } catch { }

        registeredAccelerator = null;
    }

    releaseWaiters(-1);
}

function installQuitHook() {
    if (quitHookInstalled) return;

    quitHookInstalled = true;
    app.once("will-quit", unregisterCurrent);
}

export async function registerHotkey(
    _: IpcMainInvokeEvent,
    accelerator: string
): Promise<HotkeyRegistrationResult> {
    await app.whenReady();
    installQuitHook();
    unregisterCurrent();

    try {
        const ok = globalShortcut.register(accelerator, () => {
            activationVersion++;
            releaseWaiters(activationVersion);
        });

        if (!ok) {
            return {
                ok: false,
                version: activationVersion,
                error: "Ese atajo global está ocupado o Windows no permite registrarlo."
            };
        }

        registeredAccelerator = accelerator;

        return {
            ok: true,
            version: activationVersion
        };
    } catch (error) {
        return {
            ok: false,
            version: activationVersion,
            error: error instanceof Error
                ? error.message
                : "No se pudo registrar el atajo global."
        };
    }
}

export async function unregisterHotkey(_: IpcMainInvokeEvent): Promise<number> {
    await app.whenReady();
    unregisterCurrent();
    return activationVersion;
}

export function waitForHotkey(
    event: IpcMainInvokeEvent,
    afterVersion: number
): Promise<number> {
    if (activationVersion > afterVersion) {
        return Promise.resolve(activationVersion);
    }

    return new Promise(resolve => {
        let settled = false;

        const onDestroyed = () => finish(-1);

        const finish: Waiter = version => {
            if (settled) return;

            settled = true;
            waiters.delete(finish);
            event.sender.removeListener("destroyed", onDestroyed);
            resolve(version);
        };

        waiters.add(finish);
        event.sender.once("destroyed", onDestroyed);
    });
}
