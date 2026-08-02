# FakeDeafen+

FakeDeafen+ is a custom Vencord userplugin that makes Discord display you as deafened while you can still hear and speak locally.

## Features

- Independent FakeDeafen+ control next to Discord's voice controls.
- No separate Fake Mute mode.
- Configurable activation and deactivation sounds.
- Configurable global keyboard shortcut.
- The global shortcut works while Discord is unfocused or minimized.
- Theme-aware tooltip and control styling.
- Restores your real voice state when disabled.
- Automatically disables itself when you leave or change voice channels.

## Requirements

Custom Vencord plugins require a Vencord installation built from source.

Read the official Vencord guides before continuing:

- https://docs.vencord.dev/installing/
- https://docs.vencord.dev/installing/custom-plugins/

Install Git, Node.js and pnpm. Verify that they are available:

```text
git --version
node --version
pnpm --version
```

> Already have Vencord built from source? Skip the Vencord clone step and install the plugin inside your existing `src/userplugins` folder.

## Installation

### Windows (PowerShell)

```powershell
Set-Location $HOME

git clone https://github.com/Vendicated/Vencord.git
Set-Location .\Vencord

pnpm install --frozen-lockfile

New-Item -ItemType Directory -Path .\src\userplugins -Force | Out-Null
Set-Location .\src\userplugins

git clone https://github.com/fevegit/FakeDeafenPlus.git fakeDeafen

Set-Location ..\..

pnpm build
pnpm inject
```

After injection:

1. Fully close Discord, including the system tray process.
2. Start Discord again.
3. Open **Settings -> Vencord -> Plugins**.
4. Enable **FakeDeafen+**.

The final plugin path should be:

```text
%USERPROFILE%\Vencord\src\userplugins\fakeDeafen\
```

### Linux (Bash)

```bash
cd "$HOME"

git clone https://github.com/Vendicated/Vencord.git
cd Vencord

pnpm install --frozen-lockfile

mkdir -p src/userplugins
cd src/userplugins

git clone https://github.com/fevegit/FakeDeafenPlus.git fakeDeafen

cd ../..

pnpm build
pnpm inject
```

After injection:

1. Fully close Discord.
2. Start Discord again.
3. Open **Settings -> Vencord -> Plugins**.
4. Enable **FakeDeafen+**.

The final plugin path should be:

```text
$HOME/Vencord/src/userplugins/fakeDeafen/
```

For Vesktop or another non-standard Discord client, follow the official Vencord installation guide for that client and use the same Vencord source tree.

## Updating

### Windows (PowerShell)

```powershell
Set-Location "$HOME\Vencord\src\userplugins\fakeDeafen"
git pull --ff-only

Set-Location "$HOME\Vencord"
pnpm build
pnpm inject
```

### Linux (Bash)

```bash
cd "$HOME/Vencord/src/userplugins/fakeDeafen"
git pull --ff-only

cd "$HOME/Vencord"
pnpm build
pnpm inject
```

Fully restart Discord afterwards.

## Uninstalling

Disable FakeDeafen+ in Vencord before removing its folder.

### Windows (PowerShell)

```powershell
Set-Location "$HOME\Vencord"

Remove-Item -LiteralPath ".\src\userplugins\fakeDeafen" -Recurse -Force

pnpm build
pnpm inject
```

### Linux (Bash)

```bash
cd "$HOME/Vencord"

rm -rf -- "src/userplugins/fakeDeafen"

pnpm build
pnpm inject
```

Fully restart Discord after rebuilding.

## Notes

- This is an unofficial custom userplugin and is not supported by the Vencord team.
- Custom plugins require rebuilding Vencord whenever their source changes.
- Use `src/userplugins`; do not copy the plugin into `src/plugins`.
- The GitHub repository is named `FakeDeafenPlus` because GitHub repository names cannot contain the `+` character.
- This repository contains only plugin source code and public documentation.

<!-- acknowledgements:start -->
## Acknowledgements

FakeDeafen+ was inspired by [FakeVoiceOptions](https://github.com/eightcon/FakeVoiceOptions) by **eightcon**.

I used the original plugin and really liked its core idea, but I felt that the experience was missing a more focused Fake Deafen workflow and deeper integration with Discord. FakeDeafen+ was created as an independent implementation with a dedicated control, a configurable global shortcut, activation sounds and theme-aware UI.

Many thanks to eightcon and the original contributors for their work and for inspiring this project.
<!-- acknowledgements:end -->

## License

GPL-3.0-or-later.
